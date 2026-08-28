import {
	getBoundingClientRect,
	getClientRects,
} from "../utils/utils.js";
import {
	buildElementMeasure,
	buildFontSpec,
	fontKey,
	getTextMeasureService,
	measureInlineRunsHeight,
	measurementCapabilities,
	setMeasureLocale,
} from "../utils/textmeasure.js";
import type {
	ElementMeasure,
	FontSpec,
	InlineRun,
} from "../utils/textmeasure.js";
import { getDomOpStats } from "../utils/domops.js";
import type { LayoutCursor, PreparedTextWithSegments } from "@chenglou/pretext";
import {
	child,
	cloneNode,
	findElement,
	hasContent,
	indexOf,
	indexOfTextNodeForOverflow,
	isContainer,
	isElement,
	isText,
	letters,
	needsBreakBefore,
	needsPageBreak,
	needsPreviousBreakAfter,
	nodeAfter,
	nodeBefore,
	parentOf,
	prevValidNode,
	rebuildTree,
	replaceOrAppendElement,
	validNode,
	walk,
	words,
} from "../utils/dom.js";
import BreakToken from "./breaktoken.js";
import RenderResult from "./renderresult.js";
import EventEmitter from "event-emitter";
import Hook from "../utils/hook.js";
import Overflow from "./overflow.js";
import type { ChunkerHooks } from "./chunker.js";
import type { PagedEventEmitter } from "../types/emitter.js";

const MAX_CHARS_PER_BREAK = 1500;

interface WithRefs extends HTMLElement {
	indexOfRefs?: Record<string, HTMLElement>;
}

type LayoutHooks = ChunkerHooks & {
	beforeOverflow?: Hook<any>;
};

/**
 * A rendered element that acts as a CSS multi-column fragmentainer: content
 * flows through its columns and any excess spills into an additional
 * off-page column, which is detected as overflow.
 */
interface FragmentainerMeta {
	count: number;
	gap: number;
	columnWidth: number;
}

/** Tolerance in px for sub-pixel noise when classifying column positions. */
const COLUMN_EPSILON = 1;

/**
 * Tolerance in px for vertical overflow. Content whose bottom edge spills
 * into the bottom margin by up to this amount is accepted rather than
 * extracted as overflow. This absorbs sub-pixel rounding differences and
 * tiny residual fragments that would otherwise chase precision forever.
 */
const OVERFLOW_TOLERANCE = 4;

/**
 * Minimum number of words in a text node before the pretext-predicted break
 * path engages; below this the legacy walker's few rect reads are cheaper.
 */
const PREDICT_MIN_WORDS = 12;

/**
 * Upper bound on characters fed to measurement preparation. Text beyond
 * this prefix falls back to the legacy walker (breaks that far into a node
 * are rare; the node will have been split long before).
 */
const PREDICT_MAX_CHARS = 6000;

/**
 * Wrapping-width reductions tried in order when verification contradicts a
 * prediction; canvas-vs-DOM metric drift is typically within this range.
 */
const PREDICT_WIDTH_SHRINKS_PX = [0, 1, 2];

/**
 * Maximum number of stored prepared originals for continuation reuse.
 */
const CONTINUATION_CACHE_MAX = 512;

interface ContinuationEntry {
	fullText: string;
	fontKey: string;
	prepared: PreparedTextWithSegments;
}

/**
 * Module-level prediction state.
 *
 * Layout instances are created per page and per overflow-restart cycle, so
 * anything meant to live for a whole pagination run must sit here. This is
 * what makes "prepare each text once" hold across an entire document rather
 * than per layout attempt.
 */
const predictFallbackNodes = new WeakSet<Text>();
const continuationPreparedTexts = new Map<string, ContinuationEntry>();

/**
 * Prepared source texts from the eager warm-up pass, keyed by the parent
 * element's data-ref. Populated once per flow when the whole document is
 * known; consulted by textBreak before any lazy preparation.
 */
const eagerPreparedTexts = new Map<
	string,
	Array<{
		childIndex: number;
		fullText: string;
		fontKey: string;
		prepared: PreparedTextWithSegments;
	}>
>();

/** Minimum trimmed length for a text node to qualify for eager preparation. */
const EAGER_MIN_CHARS = 60;

/**
 * Computed-style records for every source element, keyed by data-ref.
 * Captured once per flow while the source is temporarily attached (see
 * prepareTextsEagerly); the column-span segment planner uses them to
 * estimate natural block heights without re-attaching the source.
 */
const elementMeasures = new Map<string, ElementMeasure>();

/**
 * Heights measured by cloning blocks into the off-screen probe host (the
 * fallback for content pretext cannot model, e.g. tables and images),
 * keyed by data-ref plus target width.
 */
const segmentProbeCache = new Map<
	string,
	{ height: number; line: number; marginTop: number; marginBottom: number }
>();

/** Lazily-created hidden host for block height probes. */
let segmentProbeHost: HTMLElement | null = null;

function getSegmentProbeHost(): HTMLElement {
	if (!segmentProbeHost || !segmentProbeHost.isConnected) {
		segmentProbeHost = document.createElement("div");
		segmentProbeHost.setAttribute("data-paged-segment-probe", "");
		segmentProbeHost.style.position = "absolute";
		segmentProbeHost.style.visibility = "hidden";
		segmentProbeHost.style.overflow = "hidden";
		segmentProbeHost.style.height = "1px";
		segmentProbeHost.style.left = "-99999px";
		segmentProbeHost.style.top = "0px";
		document.body.appendChild(segmentProbeHost);
	}
	return segmentProbeHost;
}

/** Diagnostics for the prediction path (counts only; negligible cost). */
export const predictStats = {
	prepareCalls: 0,
	prepareMs: 0,
	reuses: 0,
	predicts: 0,
	predictMs: 0,
	fallbacks: 0,
	quickFits: 0,
	unverified: 0,
	eagerEntries: 0,
	rejects: {} as Record<string, number>,
};

/**
 * Records why a prediction was rejected in favor of the legacy walker.
 */
function rejectPrediction(reason: string): null {
	predictStats.rejects[reason] = (predictStats.rejects[reason] || 0) + 1;
	return null;
}

/**
 * Index of a text node among its parent's direct Text children.
 */
function textNodeIndexInParent(node: Text, parent: Element): number {
	let index = 0;
	for (const child of Array.from(parent.childNodes)) {
		if (child === node) {
			break;
		}
		if (child.nodeType === Node.TEXT_NODE) {
			index++;
		}
	}
	return index;
}

/**
 * Resets per-run prediction caches. Called once per flow so rerunning the
 * previewer on new content never matches stale entries.
 */
export function resetPredictionCaches(): void {
	continuationPreparedTexts.clear();
	eagerPreparedTexts.clear();
	elementMeasures.clear();
	segmentProbeCache.clear();
	predictStats.eagerEntries = 0;
}

export interface OverflowViolation {
	page: string;
	kind: "h-spill" | "v-spill";
	detail: string;
}

/**
 * Audits finished pages for content that ended up outside the space
 * designated for it.
 * * During pagination, spill into hidden columns is the normal overflow
 * signal; once rendering has completed, no such spill may remain. Used to
 * validate unverified (pure-pretext) text breaking after the fact.
 *
 * @param pagesArea - The element containing all rendered pages.
 * @returns One entry per page exhibiting horizontal or vertical spill.
 */
export function validateRenderedPages(
	pagesArea?: HTMLElement | null,
): OverflowViolation[] {
	const violations: OverflowViolation[] = [];
	if (!pagesArea) {
		return violations;
	}
	const pages = pagesArea.querySelectorAll(".paged_page");
	pages.forEach((pg) => {
		const content = pg.querySelector(".paged_page_content") as HTMLElement | null;
		const wrapper = content?.querySelector(
			":scope > div:not(.paged_float_top):not(.paged_float_bottom)",
		) as HTMLElement | null;
		if (!wrapper) {
			return;
		}

		const columns = wrapper.querySelectorAll(
			":scope > .paged_columns > .paged_column",
		);
		const containers = columns.length
			? (Array.from(columns) as HTMLElement[])
			: [wrapper];

		for (const container of containers) {
			if (container.scrollWidth > container.clientWidth + COLUMN_EPSILON) {
				violations.push({
					page: pg.id,
					kind: "h-spill",
					detail: `scrollWidth ${container.scrollWidth} > clientWidth ${container.clientWidth}`,
				});
			}
			if (container.scrollHeight > container.clientHeight + OVERFLOW_TOLERANCE) {
				violations.push({
					page: pg.id,
					kind: "v-spill",
					detail: `scrollHeight ${container.scrollHeight} > clientHeight ${container.clientHeight}`,
				});
			}
		}
	});
	return violations;
}

/**
 * Re-balances the final fragments of fragmented multicol blocks.
 *
 * While paginating, a multicol block that spans pages is constrained to
 * `height: <remaining>; column-fill: auto` so the browser fragments it.
 * Its last fragment, however, fits without a constraint — and an
 * unconstrained multicol container balances its columns per CSS Multi-col,
 * which is what `column-fill: balance` asks for on final pages. This pass
 * releases those constraints where doing so does not re-introduce overflow,
 * giving balanced last pages for free.
 *
 * Called automatically after a flow completes; safe to call again.
 *
 * @param pagesArea - The element containing all rendered pages.
 * @returns The number of fragments that were re-balanced.
 */
export function rebalanceMulticolFinals(
	pagesArea?: HTMLElement | null,
): number {
	if (!pagesArea) {
		return 0;
	}
	let rebalanced = 0;
	const constrained = pagesArea.querySelectorAll<HTMLElement>(
		"[data-paged-fragmentainer-constrained]",
	);
	constrained.forEach((el) => {
		const savedHeight = el.style.height;
		const savedFill = el.style.columnFill;
		// Unconstrained multicol balances once our forced `column-fill:
		// auto` is lifted too.
		el.style.height = "auto";
		el.style.columnFill = "";
		// Verify nothing now spills past the fragmentainer or its page.
		el.getBoundingClientRect();
		const spills =
			el.scrollWidth > el.clientWidth + COLUMN_EPSILON ||
			el.scrollHeight > el.clientHeight + COLUMN_EPSILON ||
			el.getBoundingClientRect().bottom >
				(el.closest(".paged_page_content")?.getBoundingClientRect()
					.bottom ??
					el.getBoundingClientRect().bottom) +
					COLUMN_EPSILON;
		if (spills) {
			el.style.height = savedHeight;
			el.style.columnFill = savedFill;
		} else {
			delete el.dataset.pagedFragmentainerConstrained;
			rebalanced++;
		}
	});
	return rebalanced;
}

/**
 * Re-balances the final row of root-level manual columns.
 *
 * Manual columns are filled sequentially by the layout engine. On a page
 * whose content ends early — the document's last page, or a page that ends
 * a part (a forced page break or a deferred `column-span: all` heading
 * follows, marked `data-paged-part-end` by the walk) — this often leaves
 * the right-hand columns nearly empty while the left-hand column holds the
 * remaining content. When the author asked for `column-fill: balance` (the
 * CSS default), such final rows are converted back into a native CSS
 * multi-column container for that page only; the browser then distributes
 * the remaining content evenly. If balancing would re-introduce overflow,
 * the row is left in its sequential layout.
 *
 * @param pagesArea - The element containing all rendered pages.
 * @returns The number of rows that were re-balanced.
 */
export function rebalanceManualColumnFinals(
	pagesArea?: HTMLElement | null,
): number {
	if (!pagesArea) {
		return 0;
	}

	const pages = Array.from(
		pagesArea.querySelectorAll<HTMLElement>(".paged_page"),
	);
	const candidatePages = new Set<HTMLElement>(
		Array.from(
			pagesArea.querySelectorAll<HTMLElement>(
				".paged_page[data-paged-part-end]",
			),
		),
	);
	// The document's last page with columns always balances.
	for (let i = pages.length - 1; i >= 0; i--) {
		if (pages[i].querySelector(":scope .paged_flow > .paged_columns")) {
			candidatePages.add(pages[i]);
			break;
		}
	}

	let rebalanced = 0;
	for (const page of candidatePages) {
		const rows = Array.from(
			page.querySelectorAll<HTMLElement>(
				":scope .paged_flow > .paged_columns",
			),
		);
		const row = rows[rows.length - 1];
		if (!row || !row.hasChildNodes()) {
			continue;
		}

		const columns = Array.from(
			row.querySelectorAll<HTMLElement>(":scope > .paged_column"),
		);
		if (columns.length <= 1) {
			continue;
		}

		const fill = row.dataset.pagedColumnFill || "balance";
		if (fill === "auto") {
			continue;
		}

		if (balanceManualColumnRow(row, columns)) {
			rebalanced++;
		}
	}
	return rebalanced;
}

/**
 * Converts one manual-column row into a balanced native multicol block.
 * Keeps the conversion when the balanced layout fits, restores the
 * sequential layout when it would overflow.
 *
 * @param row - The `.paged_columns` row to balance.
 * @param columns - The row's column boxes.
 * @returns True when the row was left balanced.
 */
function balanceManualColumnRow(
	row: HTMLElement,
	columns: HTMLElement[],
): boolean {
	const savedRowStyles = {
		display: row.style.display,
		height: row.style.height,
		minHeight: row.style.minHeight,
		flex: row.style.flex,
		columnCount: row.style.columnCount,
		columnGap: row.style.columnGap,
		columnFill: row.style.columnFill,
		columnRule: row.style.columnRule,
	};
	const savedColumnStyles = new Map<
		HTMLElement,
		{
			display: string;
			height: string;
			flex: string;
			width: string;
			borderLeft: string;
		}
	>();
	const gap = row.style.gap || row.style.columnGap || "1em";

	row.style.display = "block";
	row.style.height = "auto";
	row.style.minHeight = "0";
	row.style.flex = "";
	row.style.columnCount = String(columns.length);
	row.style.columnGap = gap;
	row.style.columnFill = "balance";

	columns.forEach((col) => {
		savedColumnStyles.set(col, {
			display: col.style.display,
			height: col.style.height,
			flex: col.style.flex,
			width: col.style.width,
			borderLeft: col.style.borderLeft,
		});
		col.style.display = "contents";
		col.style.height = "auto";
		col.style.flex = "";
		col.style.width = "";
		col.style.borderLeft = "";
	});

	const secondColumn = columns[1];
	if (secondColumn && secondColumn.style.borderLeft) {
		row.style.columnRule = secondColumn.style.borderLeft;
	}

	row.getBoundingClientRect();
	const pageContent = row.closest(".paged_page_content") as HTMLElement | null;
	const pageBottom = pageContent
		? pageContent.getBoundingClientRect().bottom
		: Infinity;
	const rowRect = row.getBoundingClientRect();
	const spills =
		row.scrollWidth > row.clientWidth + COLUMN_EPSILON ||
		row.scrollHeight > row.clientHeight + COLUMN_EPSILON ||
		rowRect.bottom > pageBottom + COLUMN_EPSILON;

	if (spills) {
		row.style.display = savedRowStyles.display;
		row.style.height = savedRowStyles.height;
		row.style.minHeight = savedRowStyles.minHeight;
		row.style.flex = savedRowStyles.flex;
		row.style.columnCount = savedRowStyles.columnCount;
		row.style.columnGap = savedRowStyles.columnGap;
		row.style.columnFill = savedRowStyles.columnFill;
		row.style.columnRule = savedRowStyles.columnRule;
		columns.forEach((col) => {
			const saved = savedColumnStyles.get(col)!;
			col.style.display = saved.display;
			col.style.height = saved.height;
			col.style.flex = saved.flex;
			col.style.width = saved.width;
			col.style.borderLeft = saved.borderLeft;
		});
		return false;
	}
	row.dataset.pagedManualColumnsBalanced = "";
	return true;
}

function countWords(text: string): number {
	let count = 0;
	let inWord = false;
	for (let i = 0; i < text.length; i++) {
		const isSpace = /\s/.test(text[i]);
		if (!isSpace && !inWord) {
			count++;
			inWord = true;
		} else if (isSpace) {
			inWord = false;
		}
	}
	return count;
}

/**
 * Attaches the source fragment to a hidden host once per flow so computed
 * styles resolve, then captures measurements used later while the fragment
 * is detached again:
 *
 * - for every element with a data-ref, an ElementMeasure record (font spec,
 *   margins, padding/border, display) feeding the column-span segment
 *   height planner — captured in every measurement mode;
 * - when `textMeasurement === "pretext"`, prepared texts for every
 *   substantial text node, front-loading all segmentation and canvas
 *   measurement into one warm phase (after fonts have loaded), leaving
 *   textBreak pure arithmetic + probes afterwards.
 *
 * Flows containing elements that do not survive being moved between
 * parents (iframes, object/embed) skip the attach entirely; the planner
 * then stays disabled and textBreak prepares lazily.
 *
 * The fragment is temporarily attached inside a hidden container so
 * computed styles resolve; it is returned re-parented as a fresh fragment
 * for the caller to render from.
 */
export function prepareTextsEagerly(
	source: DocumentFragment | Node,
	settings: Record<string, unknown>,
): DocumentFragment | Node {
	if (!measurementCapabilities()) {
		return source;
	}
	if (typeof document === "undefined" || !document.body) {
		return source;
	}
	if (
		source instanceof DocumentFragment &&
		source.querySelector("iframe, object, embed")
	) {
		return source;
	}

	const host = document.createElement("div");
	host.setAttribute("data-paged-measure-host", "");
	host.style.position = "absolute";
	host.style.visibility = "hidden";
	host.style.overflow = "hidden";
	host.style.width = "1px";
	host.style.height = "1px";
	host.style.left = "-99999px";
	host.style.top = "0px";
	document.body.appendChild(host);
	host.appendChild(source);

	try {
		setMeasureLocale(
			(document.documentElement &&
				document.documentElement.getAttribute("lang")) ||
				undefined,
		);

		// Element measures for the segment height planner (all modes).
		const elWalker = document.createTreeWalker(
			host,
			NodeFilter.SHOW_ELEMENT,
		);
		let el = elWalker.nextNode() as HTMLElement | null;
		while (el) {
			const ref = el.dataset ? el.dataset.ref : undefined;
			if (ref && !elementMeasures.has(ref)) {
				const measure = buildElementMeasure(el);
				if (measure) {
					elementMeasures.set(ref, measure);
				}
			}
			el = elWalker.nextNode() as HTMLElement | null;
		}

		// The fragment adopted its children into host; walk those.
		if (settings.textMeasurement === "pretext") {
			const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
			let current = walker.nextNode() as Text | null;
			while (current) {
				const full = current.data;
				if (
					full.trim().length >= EAGER_MIN_CHARS &&
					countWords(full) >= PREDICT_MIN_WORDS
				) {
					const parent = current.parentElement as HTMLElement | null;
					const ref = parent?.dataset.ref;
					if (parent && ref) {
						const spec = buildFontSpec(parent);
						if (spec && spec.lineHeight > 0) {
							const key = fontKey(spec);
							const prepared = getTextMeasureService().prepare(full, spec);
							let list = eagerPreparedTexts.get(ref);
							if (!list) {
								list = [];
								eagerPreparedTexts.set(ref, list);
							}
							list.push({
								childIndex: textNodeIndexInParent(current, parent),
								fullText: full,
								fontKey: key,
								prepared,
							});
							predictStats.eagerEntries++;
						}
					}
				}
				current = walker.nextNode() as Text | null;
			}
		}
	} finally {
		// Hand the nodes back to a detached fragment for rendering.
		const restored = document.createDocumentFragment();
		while (host.firstChild) {
			restored.appendChild(host.firstChild);
		}
		host.remove();
		source = restored;
	}

	return source;
}

/**
 * Layout
 * @class
 */
class Layout {
	element: HTMLElement;
	bounds: DOMRect;
	parentBounds: DOMRect | { left: number };
	gap: number;
	hooks: LayoutHooks;
	settings: Record<string, unknown>;
	maxChars: number;
	forceRenderBreak: boolean;
	temporaryIndex: number;
	failed?: boolean;
	/** Selector strings that may produce fragmentainers (from author CSS). */
	multicolSelectors: Set<string>;
	/** Selectors declaring `column-span: all` (full-width rows). */
	columnSpanSelectors: Set<string>;
	/** Root-level multicol config applied to the page wrapper (if any). */
	rootColumns?: {
		count: number;
		gap?: string;
		fill?: "auto" | "balance";
		ruleColor?: string;
		ruleStyle?: string;
		ruleWidth?: string;
	};
	/** Rendered fragmentainer roots found on this page. */
	fragmentainers: Set<Element>;
	/** Cached per-element column metadata. */
	private fragmentainerMeta: WeakMap<Element, FragmentainerMeta>;
	/** Saved inline heights of fragmentainers during unconstrained measuring. */
	private savedFragmentainerHeights: Map<Element, string>;
	/** Whether this.bounds no longer reflects the mutated DOM. */
	private boundsDirty = true;
	/** Whether findOverflow is running inside the residual sweep, where
	 *  range tags from an earlier extraction may no longer match the
	 *  shrunken bounds and should not hide a genuinely overflowing block. */
	private inResidualSweep = false;
	/** Shared pretext-backed measurement service (predict fast path). */
	private measure = getTextMeasureService();
	/** Text nodes for which prediction already proved unprofitable. */
	private predictFallbacks = predictFallbackNodes;
	/** Prepared originals keyed by parent ref, reusable by continuation suffixes. */
	private continuationPrepared = continuationPreparedTexts;
	/**
	 * Whether predicted breaks are verified against real DOM rects before
	 * being accepted. Disable via settings `verifyTextPrediction: false` to
	 * run pure-arithmetic breaking; output should then be audited
	 * post-render with validateRenderedPages().
	 */
	private predictionVerified: boolean;
	/**
	 * Planned natural heights for `column-span` segments on this page, keyed
	 * by the data-ref of the span element that opens each segment. Computed
	 * once per page by planSegmentHeights(); consumed by applyColumnSpan().
	 * Entries with `defer` mark spans that should be deferred to the next
	 * page because the planner found no room for the segment they open.
	 */
	private segmentHeightQueue: Array<{
		ref: string;
		height: number | null;
		spanHeight?: number;
		minRoom?: number;
		defer?: boolean;
	}> = [];

	/**
	 * Whether the final character of a text node renders outside its
	 * fragmentainer / page bounds. Flow order is monotonic, so the tail
	 * overflowing is equivalent to the node straddling the break.
	 */
	private textEndOverflows(
		node: Text,
		frag: Element | null,
		parentAdditions: number,
	): boolean {
		const len = node.data.length;
		if (!len) {
			return false;
		}
		const range = document.createRange();
		range.setStart(node, len - 1);
		range.setEnd(node, len);
		const rect = range.getBoundingClientRect();
		if (!rect || (!rect.height && !rect.width)) {
			return true; // Unmeasurable: let the full path decide.
		}
		return this.rectOverflows(
			new DOMRect(
				rect.left,
				rect.top,
				rect.right - rect.left,
				rect.bottom - rect.top,
			),
			parentAdditions,
			frag,
		);
	}

	constructor(
		element: HTMLElement,
		hooks?: ChunkerHooks,
		options?: Record<string, unknown>,
	) {
		this.element = element;

		this.bounds = this.element.getBoundingClientRect();
		this.parentBounds = this.element.offsetParent?.getBoundingClientRect() || {
			left: 0,
		};
		let gap = parseFloat(window.getComputedStyle(this.element).columnGap);

		if (gap) {
			let leftMargin = this.bounds.left - this.parentBounds.left;
			this.gap = gap - leftMargin;
		} else {
			this.gap = 0;
		}

		if (hooks) {
			this.hooks = hooks as LayoutHooks;
		} else {
			this.hooks = {} as unknown as LayoutHooks;
			this.hooks.onPageLayout = new Hook();
			this.hooks.layout = new Hook();
			this.hooks.renderNode = new Hook();
			this.hooks.layoutNode = new Hook();
			this.hooks.beforeOverflow = new Hook();
			this.hooks.onOverflow = new Hook();
			this.hooks.afterOverflowRemoved = new Hook();
			this.hooks.afterOverflowAdded = new Hook();
			this.hooks.onBreakToken = new Hook();
			this.hooks.beforeRenderResult = new Hook();
		}

		this.settings = options || {};

		this.maxChars = (this.settings.maxChars as number) || MAX_CHARS_PER_BREAK;
		this.forceRenderBreak = false;

		this.temporaryIndex = 0;

		this.multicolSelectors =
			(this.settings.multicolSelectors as Set<string>) || new Set();
		this.columnSpanSelectors =
			(this.settings.columnSpanSelectors as Set<string>) || new Set();
		this.rootColumns = this.settings.rootColumns as Layout["rootColumns"];
		this.fragmentainers = new Set();
		this.fragmentainerMeta = new WeakMap();
		this.savedFragmentainerHeights = new Map();
		this.predictionVerified =
			this.settings.verifyTextPrediction !== false;
	}

	/**
	 * Marks cached page bounds as stale after a DOM or style mutation.
	 */
	invalidateBounds(): void {
		this.boundsDirty = true;
	}

	/**
	 * The manual column boxes of a flow host, or the host itself when the
	 * page is single-column. Content is filled into these sequentially.
	 *
	 * With `column-span` segments the host holds several `.paged_columns`
	 * rows; the active row is the last one (newest segment).
	 *
	 * @param {HTMLElement} wrapper - The page's flow host (`.paged_flow`).
	 * @returns {HTMLElement[]} The containers to fill, in order.
	 */
	flowColumns(wrapper: HTMLElement): HTMLElement[] {
		const rows = wrapper.querySelectorAll(":scope > .paged_columns");
		const row = rows.length ? rows[rows.length - 1] : null;
		if (row) {
			const columns = row.querySelectorAll(":scope > .paged_column");
			return Array.from(columns) as HTMLElement[];
		}
		return [wrapper];
	}

	/**
	 * Starts a new column segment below a `column-span: all` element.
	 *
	 * The spanning element has already been appended to the flow host; this
	 * adds a fresh row of column boxes for the content that follows, which
	 * continues as a new set of columns (column 0 again), mirroring CSS
	 * multicol's span semantics.
	 *
	 * @param {HTMLElement} wrapper - The flow host.
	 * @returns {HTMLElement[]} The new segment's column boxes.
	 */
	private startSpanRow(wrapper: HTMLElement): HTMLElement[] {
		const rootColumns = this.settings.rootColumns as
			| { count: number; gap?: string; fill?: "auto" | "balance"; ruleColor?: string; ruleStyle?: string; ruleWidth?: string }
			| undefined;
		const count =
			rootColumns && rootColumns.count > 1
				? Math.floor(rootColumns.count)
				: 1;
		if (count <= 1) {
			return [wrapper];
		}
		const config = rootColumns as { gap?: string; fill?: "auto" | "balance"; ruleColor?: string; ruleStyle?: string; ruleWidth?: string };
		const gap =
			config.gap !== undefined && config.gap !== "normal"
				? config.gap
				: "1em";
		const fill = config.fill || "balance";
		const row = document.createElement("div");
		row.classList.add("paged_columns");
		row.style.gap = gap;
		row.dataset.pagedColumnFill = fill;
		for (let i = 0; i < count; i++) {
			const column = document.createElement("div");
			column.classList.add("paged_column");
			column.dataset.pagedColumn = String(i);
			column.style.width = `calc((100% - ${count - 1} * ${gap}) / ${count})`;
			if (i > 0 && config.ruleWidth) {
				column.style.borderLeft =
					`${config.ruleWidth} ${config.ruleStyle || "solid"}` +
					(config.ruleColor ? ` ${config.ruleColor}` : "");
			}
			row.appendChild(column);
		}
		wrapper.appendChild(row);
		return Array.from(
			row.querySelectorAll(":scope > .paged_column"),
		) as HTMLElement[];
	}

	/**
	 * Whether a source node carries `column-span: all` and therefore breaks
	 * the current column segment into a full-width row.
	 *
	 * @param {Node|null} node - The source node.
	 * @returns {boolean} True when the node spans all columns.
	 */
	private isColumnSpan(node: Node | null | undefined): boolean {
		if (!node || !(node instanceof HTMLElement)) {
			return false;
		}
		// Author CSS `column-span: all` (tracked by the Columns handler)
		// decides; computed style on detached source nodes is unreliable.
		for (const selector of this.columnSpanSelectors) {
			try {
				if (node.matches(selector)) {
					return true;
				}
			} catch {
				// ignore invalid selectors
			}
		}
		return false;
	}

	/**
	 * Adds a `column-span: all` element as a full-width row and opens a new
	 * column segment below it.
	 *
	 * @param {HTMLElement} wrapper - The flow host.
	 * @param {Node} node - The spanning source node.
	 * @param {Node|DocumentFragment} source - The source content.
	 * @param {BreakToken|undefined} breakToken - Current break token.
	 * @returns {HTMLElement[]} The new segment's column boxes.
	 */
	private applyColumnSpan(
		wrapper: HTMLElement,
		node: Node,
		source: DocumentFragment | Node,
		breakToken: BreakToken | undefined,
	): HTMLElement[] {
		// Shrink the segment just completed to its real content height so
		// the freed space goes to the new segment. Must run before the new
		// row opens, while the row still holds its full height.
		const completedRows = wrapper.querySelectorAll(
			":scope > .paged_columns",
		);
		const completedRow = completedRows[completedRows.length - 1];
		if (completedRow) {
			this.shrinkCorrectSegmentRow(completedRow as HTMLElement);
		}
		this.append(node, wrapper, source, breakToken, false);
		const newColumns = this.startSpanRow(wrapper);
		// Give the new segment its planned natural height, if any.
		this.applyPlannedSegmentHeight(node, newColumns);
		// Opening a new segment row shrinks every segment row (the flow
		// host's height is fixed, so flex re-distributes the free space).
		// Content already laid out in an earlier column can now overflow its
		// shorter box; move that overflow into the next column of the same
		// segment so it is drawn instead of being dropped.
		this.migrateShrunkenSegmentOverflow(wrapper, source);
		return newColumns;
	}

	/**
	 * After a new `column-span` segment row is opened, re-check every earlier
	 * segment's columns: their rows have shrunk, so content that previously
	 * fitted can now overflow. Move the overflowing content into the next
	 * column of the same segment, preserving it in document order.
	 *
	 * @param {HTMLElement} wrapper - The flow host.
	 * @param {DocumentFragment|Node} source - The source content.
	 * @returns {void}
	 */
	private migrateShrunkenSegmentOverflow(
		wrapper: HTMLElement,
		source: DocumentFragment | Node,
	): void {
		const rows = Array.from(
			wrapper.querySelectorAll(":scope > .paged_columns"),
		);
		const lastRow = rows[rows.length - 1];
		for (const row of rows) {
			if (row === lastRow) {
				continue;
			}
			const columns = Array.from(
				row.querySelectorAll<HTMLElement>(":scope > .paged_column"),
			);
			for (let i = 0; i < columns.length; i++) {
				const column = columns[i];
				let guard = 0;
				while (this.hasOverflow(column, this.manualColumnBounds(column))) {
					if (++guard > 10) {
						break;
					}
					column
						.querySelectorAll(
							"[data-overflow-tagged], [data-range-start-overflow], [data-range-end-overflow]",
						)
						.forEach((el) => {
							el.removeAttribute("data-overflow-tagged");
							el.removeAttribute("data-range-start-overflow");
							el.removeAttribute("data-range-end-overflow");
						});
					column.removeAttribute("data-overflow-tagged");
					column.removeAttribute("data-range-start-overflow");
					column.removeAttribute("data-range-end-overflow");
					const range = this.findOverflow(
						column,
						this.manualColumnBounds(column),
						source,
					);
					if (!range) {
						break;
					}
					// Move the overflow into the next column of the same
					// segment. If this is the segment's last column there is
					// nowhere sensible on this page to put it (the content
					// belongs before the span), so leave it untouched for the
					// normal overflow path instead of removing it and losing it.
					const target = columns[i + 1];
					if (!target) {
						break;
					}
					const fragment = this.removeOverflow(range);
					if (!fragment || !fragment.childNodes.length) {
						break;
					}
					// Prepend so migrated content stays in document order when the
					// target column already contains later content.
					if (target.firstChild) {
						target.insertBefore(fragment, target.firstChild);
					} else {
						target.appendChild(fragment);
					}
				}
			}
		}
	}

	/**
	 * Plans natural heights for the `column-span` segments of this page.
	 *
	 * Without a plan every segment row gets an equal flex share of the flow
	 * host, so a segment holding little content wastes the rest, and columns
	 * filled against the pre-span full height spill massively when a new
	 * segment row shrinks them. Instead, the content between the walk start
	 * and each upcoming top-level `column-span: all` element is measured
	 * arithmetically (pretext line counts from font metrics; DOM probes for
	 * content pretext cannot model) and each segment row is fixed at the
	 * height its content actually needs — rounded up to whole lines, so
	 * estimation errors leave slack rather than cause overflow. The final
	 * segment on the page always keeps its flexible height and absorbs
	 * whatever space is left.
	 *
	 * The first row is fixed immediately; heights for later segments are
	 * queued and consumed by applyColumnSpan() as the walker reaches each
	 * span. When no top-level span lies ahead, nothing changes and rows keep
	 * their flexible equal share.
	 *
	 * @param {HTMLElement} wrapper - The page's flow host.
	 * @param {DocumentFragment|Node} source - The source content.
	 * @param {Node|undefined} start - The node the walk starts at.
	 * @returns {void}
	 */
	private planSegmentHeights(
		wrapper: HTMLElement,
		source: DocumentFragment | Node,
		start: Node | undefined,
	): void {
		this.segmentHeightQueue = [];
		const rootColumns = this.rootColumns;
		if (!rootColumns || rootColumns.count <= 1) {
			return;
		}
		if (!this.columnSpanSelectors.size || !elementMeasures.size || !start) {
			return;
		}

		const rows = wrapper.querySelectorAll(":scope > .paged_columns");
		if (rows.length !== 1) {
			return;
		}
		const firstRow = rows[0] as HTMLElement;
		const columns = Array.from(
			firstRow.querySelectorAll<HTMLElement>(":scope > .paged_column"),
		);
		const count = columns.length;
		if (count <= 1) {
			return;
		}
		const columnWidth = columns[0].getBoundingClientRect().width;
		if (columnWidth < 8) {
			return;
		}

		const flowRect = wrapper.getBoundingClientRect();
		const floatTop = wrapper.querySelector<HTMLElement>(
			":scope > .paged_float_top",
		);
		const available =
			flowRect.height -
			(floatTop ? floatTop.getBoundingClientRect().height : 0);
		if (available <= 0) {
			return;
		}
		const fullWidth = flowRect.width;
		const fill = this.rootColumns?.fill || "balance";

		// Content already rebuilt into the row (carried overflow) is measured
		// exactly; only the walk's remaining content needs estimating.
		let segmentTotal = 0;
		for (const extent of this.columnContentExtents(firstRow)) {
			segmentTotal += extent;
		}

		// The top-level source node the walk starts in (or at).
		let topStart: Node | null = start;
		while (topStart && topStart.parentNode !== source) {
			topStart = topStart.parentNode;
		}
		if (!topStart) {
			return;
		}

		const entries: Array<{
			ref: string;
			height: number | null;
			spanHeight?: number;
			minRoom?: number;
			defer?: boolean;
		}> = [];
		const ctx = { maxLine: 0, maxMargin: 0 };
		let firstHeight: number | null = null;
		let used = 0;
		let pendingSpanRef: string | null = null;
		let pendingSpanHeight = 0;
		let spansSeen = 0;
		let node: Node | null = topStart;
		while (node) {
			if (node instanceof HTMLElement && this.isColumnSpan(node)) {
				spansSeen++;
				// Close the segment: estimate how tall the row needs to be.
				// With `column-fill: auto` the content stacks in the first
				// column, so the natural height is the content's own height
				// (capped at the page's available height); with `balance` it
				// is distributed evenly over the columns.
				const line = ctx.maxLine || 16;
				const h = this.segmentRowHeight(
					segmentTotal,
					count,
					line,
					ctx.maxMargin,
					available,
					fill,
				);
				segmentTotal = 0;
				ctx.maxLine = 0;
				ctx.maxMargin = 0;
				if (firstHeight === null) {
					if (h >= available - COLUMN_EPSILON) {
						// The first segment alone fills the page: no span can
						// follow on this page, so there is nothing to plan.
						return;
					}
					firstHeight = h;
					used = h;
				} else if (pendingSpanRef !== null) {
					// Fix the segment's row at its natural height whenever the
					// segment itself fits in the space left by the rows and
					// spans before it — even if the span that follows will
					// not fit afterwards (it then breaks to the next page,
					// which is the desired outcome). A row left flexible
					// here is filled to the remaining page height and then
					// shrunk when the next span opens, spilling content that
					// has nowhere to go.
					const fits = h < available - used - COLUMN_EPSILON;
					entries.push({
						ref: pendingSpanRef,
						height: fits ? h : null,
					});
					used += h + pendingSpanHeight;
					if (
						!fits ||
						used >= available - COLUMN_EPSILON ||
						spansSeen >= 12
					) {
						// The page is full: the span that opens the next
						// segment should be deferred (treated as ordinary
						// content) when the walker reaches it and measures
						// that no room is really left.
						const deferCtx = { maxLine: 0, maxMargin: 0 };
						entries.push({
							ref: node.dataset.ref || "",
							height: null,
							spanHeight: this.estimateFlowBlockHeight(
								node,
								fullWidth,
								deferCtx,
							),
							minRoom: line,
							defer: true,
						});
						break;
					}
				}
				const spanCtx = { maxLine: 0, maxMargin: 0 };
				pendingSpanRef = node.dataset.ref || "";
				pendingSpanHeight = this.estimateFlowBlockHeight(
					node,
					fullWidth,
					spanCtx,
				);
			} else if (node instanceof HTMLElement) {
				const skip =
					node === topStart && start !== topStart ? start : undefined;
				segmentTotal += this.estimateFlowBlockHeight(
					node,
					columnWidth,
					ctx,
					skip,
				);
			} else if (isText(node) && node.data.trim()) {
				// Loose top-level text has no reliable block context to
				// estimate against; leave rows flexible rather than guess.
				return;
			}
			node = node.nextSibling;
		}
		if (firstHeight === null) {
			// No top-level span lies ahead on this page.
			return;
		}
		if (node === null && pendingSpanRef !== null) {
			// The source ran out: close the final segment for the last span.
			const line = ctx.maxLine || 16;
			const h = this.segmentRowHeight(
				segmentTotal,
				count,
				line,
				ctx.maxMargin,
				available,
				fill,
			);
			entries.push({
				ref: pendingSpanRef,
				height:
					h < available - used - COLUMN_EPSILON ? h : null,
			});
		}
		this.fixSegmentRowHeight(firstRow, firstHeight);
		this.segmentHeightQueue = entries;
	}

	/**
	 * Estimates a column-segment row's natural height from the total height
	 * of the content that will fill it.
	 *
	 * With `column-fill: auto` the content is stacked into the first column,
	 * so the row only needs the content's own height (capped at the page's
	 * available height — anything more overflows to the next page). With
	 * `column-fill: balance` the content is spread evenly across the columns,
	 * so the height is the total divided by the column count. Both are
	 * rounded up to whole lines plus margin slop.
	 *
	 * @param {number} segmentTotal - Sum of the segment's block heights (px).
	 * @param {number} count - Number of columns in the row.
	 * @param {number} line - Largest line height seen in the segment.
	 * @param {number} margin - Largest vertical margin seen in the segment.
	 * @param {number} available - Page height available to column content.
	 * @param {string} fill - `auto` or `balance`.
	 * @returns {number} The row height in CSS px.
	 */
	private segmentRowHeight(
		segmentTotal: number,
		count: number,
		line: number,
		margin: number,
		available: number,
		fill: string,
	): number {
		if (fill === "auto") {
			const natural =
				Math.ceil(segmentTotal / line) * line +
				margin +
				2 * COLUMN_EPSILON;
			return Math.min(natural, available - COLUMN_EPSILON);
		}
		return (
			Math.ceil(segmentTotal / count / line) * line +
			margin +
			2 * COLUMN_EPSILON
		);
	}

	/**
	 * Estimates the natural height of a source block laid out at the given
	 * width, including its margins. Inline content is measured arithmetically
	 * from font metrics (per inline run, so mixed formatting keeps its own
	 * fonts); block children are recursed into; anything pretext cannot
	 * model (tables, images, replaced elements, unmeasured styles) is
	 * measured by cloning into the off-screen probe host. Footnote bodies
	 * and hidden content are excluded — they render outside the columns.
	 *
	 * @param {Element} el - The source element (detached).
	 * @param {number} width - The width it will be laid out at.
	 * @param {Object} ctx - Estimation context (tracks the largest line
	 *   height seen, for whole-line rounding by the caller).
	 * @param {Node} [skipBefore] - When set, content before this node is not
	 *   counted (the node resumes mid-block from a previous page).
	 * @returns {number} The estimated height in CSS px.
	 */
	private estimateFlowBlockHeight(
		el: Element,
		width: number,
		ctx: { maxLine: number; maxMargin: number },
		skipBefore?: Node,
	): number {
		if (!(el instanceof HTMLElement)) {
			return 0;
		}
		const rec = el.dataset.ref
			? elementMeasures.get(el.dataset.ref)
			: undefined;
		if (!rec) {
			return this.probeBlockHeight(el, width, ctx);
		}
		if (rec.display === "none") {
			return 0;
		}
		const innerWidth = Math.max(4, width - rec.padBorderX);
		let content = 0;
		let hasBlockChildren = false;
		for (const child of Array.from(el.children)) {
			const childRec = child.dataset.ref
				? elementMeasures.get(child.dataset.ref)
				: undefined;
			const isBlockChild = childRec
				? childRec.block && childRec.display !== "none"
				: true;
			if (!isBlockChild) {
				continue;
			}
			hasBlockChildren = true;
			if (
				skipBefore &&
				!(skipBefore.compareDocumentPosition(child) &
					Node.DOCUMENT_POSITION_FOLLOWING)
			) {
				// Entirely before the resume point (or the resume point is
				// inside it — then the text walk below picks up the rest).
				if (child.contains(skipBefore)) {
					content += this.estimateFlowBlockHeight(
						child,
						innerWidth,
						ctx,
						skipBefore,
					);
				}
				continue;
			}
			content += this.estimateFlowBlockHeight(child, innerWidth, ctx);
		}
		if (!hasBlockChildren) {
			if (!el.textContent || !el.textContent.trim()) {
				// Replaced or empty leaf (img, hr, br): measure exactly.
				return this.probeBlockHeight(el, width, ctx);
			}
			const height = measureInlineRunsHeight(
				this.measure,
				this.collectInlineRuns(el, skipBefore),
				innerWidth,
			);
			if (height === null) {
				return this.probeBlockHeight(el, width, ctx);
			}
			content = height;
			if (rec.font) {
				ctx.maxLine = Math.max(ctx.maxLine, rec.font.lineHeight);
			}
		}
		ctx.maxMargin = Math.max(
			ctx.maxMargin,
			rec.marginTop,
			rec.marginBottom,
		);
		const margins = skipBefore
			? rec.marginBottom
			: rec.marginTop + rec.marginBottom;
		return content + rec.padBorderY + margins;
	}

	/**
	 * Collects the inline text of a block as runs sharing one font spec, so
	 * mixed-format paragraphs are measured with each run's own font. Skips
	 * footnote bodies (they render in the footnote area, not the column),
	 * hidden elements, and script/style text.
	 *
	 * @param {Element} el - The block element.
	 * @param {Node} [skipBefore] - Resume point; earlier text is excluded.
	 * @returns {InlineRun[]} The runs in document order.
	 */
	private collectInlineRuns(el: Element, skipBefore?: Node): InlineRun[] {
		const runs: InlineRun[] = [];
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
			acceptNode: (node) => {
				if (skipBefore && node !== skipBefore) {
					const pos = skipBefore.compareDocumentPosition(node);
					if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING)) {
						return NodeFilter.FILTER_REJECT;
					}
				}
				for (
					let p = node.parentElement;
					p && p !== el;
					p = p.parentElement
				) {
					if (
						p.dataset.note === "footnote" ||
						p.tagName === "SCRIPT" ||
						p.tagName === "STYLE"
					) {
						return NodeFilter.FILTER_REJECT;
					}
					const rec = p.dataset.ref
						? elementMeasures.get(p.dataset.ref)
						: undefined;
					if (rec && rec.display === "none") {
						return NodeFilter.FILTER_REJECT;
					}
				}
				return NodeFilter.FILTER_ACCEPT;
			},
		});
		let current = walker.nextNode() as Text | null;
		while (current) {
			const spec = current.parentElement?.dataset.ref
				? elementMeasures.get(current.parentElement.dataset.ref)?.font
				: undefined;
			const fallbackSpec = el instanceof HTMLElement && el.dataset.ref
				? elementMeasures.get(el.dataset.ref)?.font
				: undefined;
			const runSpec = spec || fallbackSpec;
			if (runSpec) {
				const last = runs[runs.length - 1];
				if (last && fontKey(last.spec) === fontKey(runSpec)) {
					last.text += current.data;
				} else {
					runs.push({ text: current.data, spec: runSpec });
				}
			}
			current = walker.nextNode() as Text | null;
		}
		return runs;
	}

	/**
	 * Measures a block's natural height by cloning it into the hidden probe
	 * host at the target width. Cached per element and width; used for
	 * content pretext cannot model (tables, images, replaced elements).
	 *
	 * @param {Element} el - The source element (detached).
	 * @param {number} width - The width to measure at.
	 * @returns {number} The measured height including margins, in CSS px.
	 */
	private probeBlockHeight(
		el: Element,
		width: number,
		ctx?: { maxLine: number; maxMargin: number },
	): number {
		const ref = (el as HTMLElement).dataset
			? (el as HTMLElement).dataset.ref || ""
			: "";
		const key = `${ref} ${Math.round(width * 4)}`;
		const cached = segmentProbeCache.get(key);
		if (cached !== undefined) {
			if (ctx) {
				ctx.maxLine = Math.max(ctx.maxLine, cached.line);
				ctx.maxMargin = Math.max(
					ctx.maxMargin,
					cached.marginTop,
					cached.marginBottom,
				);
			}
			return cached.height;
		}
		const host = getSegmentProbeHost();
		host.style.width = `${Math.max(4, width)}px`;
		const clone = el.cloneNode(true) as HTMLElement;
		host.appendChild(clone);
		let height = clone.offsetHeight;
		const style = window.getComputedStyle(clone);
		const marginTop = parseFloat(style.marginTop);
		const marginBottom = parseFloat(style.marginBottom);
		if (Number.isFinite(marginTop)) {
			height += marginTop;
		}
		if (Number.isFinite(marginBottom)) {
			height += marginBottom;
		}
		let line = parseFloat(style.lineHeight);
		if (!Number.isFinite(line) || line <= 0) {
			line = (parseFloat(style.fontSize) || 16) * 1.14;
		}
		const record = {
			height,
			line,
			marginTop: Number.isFinite(marginTop) ? marginTop : 0,
			marginBottom: Number.isFinite(marginBottom) ? marginBottom : 0,
		};
		if (ctx) {
			ctx.maxLine = Math.max(ctx.maxLine, record.line);
			ctx.maxMargin = Math.max(
				ctx.maxMargin,
				record.marginTop,
				record.marginBottom,
			);
		}
		clone.remove();
		if (segmentProbeCache.size >= 4096) {
			segmentProbeCache.clear();
		}
		segmentProbeCache.set(key, record);
		return height;
	}

	/**
	 * Measures a block's post-extraction height: like probeBlockHeight, but
	 * the clone's footnote subtrees are removed first, because they leave the
	 * flow when the block renders. The footnote reserve prediction must see
	 * the same heights the real walk lays out — the pretext estimate wraps at
	 * a narrowed width and cannot hyphenate, so it fits less content than the
	 * page will, under-counts the notes to reserve, and lets the footnote
	 * area grow past the reserve mid-walk. Cached per element and width.
	 *
	 * @param {HTMLElement} block - The source block (detached).
	 * @param {number} width - The width to measure at.
	 * @returns The probe record: height including margins, plus the block's
	 *   own margins for collapse-aware budget accumulation.
	 */
	private probeBlockHeightWithoutNotes(
		block: HTMLElement,
		width: number,
	): { height: number; line: number; marginTop: number; marginBottom: number } {
		const ref = block.dataset.ref || "";
		const key = `${ref} nonotes ${Math.round(width * 4)}`;
		const cached = segmentProbeCache.get(key);
		if (cached !== undefined) {
			return cached;
		}
		const host = getSegmentProbeHost();
		host.style.width = `${Math.max(4, width)}px`;
		const clone = block.cloneNode(true) as HTMLElement;
		clone.removeAttribute("id");
		clone
			.querySelectorAll("[data-note='footnote']")
			.forEach((el) => el.remove());
		host.appendChild(clone);
		let height = clone.offsetHeight;
		const style = window.getComputedStyle(clone);
		const marginTop = parseFloat(style.marginTop);
		const marginBottom = parseFloat(style.marginBottom);
		if (Number.isFinite(marginTop)) {
			height += marginTop;
		}
		if (Number.isFinite(marginBottom)) {
			height += marginBottom;
		}
		clone.remove();
		if (segmentProbeCache.size >= 4096) {
			segmentProbeCache.clear();
		}
		const record = {
			height,
			line: 0,
			marginTop: Number.isFinite(marginTop) ? marginTop : 0,
			marginBottom: Number.isFinite(marginBottom) ? marginBottom : 0,
		};
		segmentProbeCache.set(key, record);
		return record;
	}

	/**
	 * Per-column content extents of a segment row: for each column, the
	 * distance from the row's top to the bottom of its content (0 when
	 * empty). Used both to measure carried overflow before the walk and to
	 * shrink a completed segment to its real content height.
	 *
	 * Range rects exclude margins, but a column's scroll height includes the
	 * bottom margin of its last content, so the extent is extended to cover
	 * it (margins collapse down the chain of last children: the deepest
	 * bottom plus the largest margin along it).
	 *
	 * @param {HTMLElement} row - A `.paged_columns` row.
	 * @returns {number[]} One extent per column, in CSS px.
	 */
	private columnContentExtents(row: HTMLElement): number[] {
		return Array.from(
			row.querySelectorAll<HTMLElement>(":scope > .paged_column"),
		).map((column) => this.contentExtent(column));
	}

	/**
	 * Fixes a segment row at an explicit height so it no longer receives an
	 * equal flex share of the flow host.
	 *
	 * @param {HTMLElement} row - A `.paged_columns` row.
	 * @param {number} height - The height in CSS px.
	 * @returns {void}
	 */
	private fixSegmentRowHeight(row: HTMLElement, height: number): void {
		row.style.flex = `0 0 ${Math.max(0, Math.ceil(height))}px`;
		row.dataset.pagedSegmentFixed = "true";
	}

	/**
	 * Shrinks a completed segment row to the height of its measured content
	 * when that is less than its current height, freeing the difference for
	 * the segment that follows. Never grows a row and never shrinks below
	 * the content, so no re-flow is needed.
	 *
	 * @param {HTMLElement} row - The segment's `.paged_columns` row.
	 * @returns {void}
	 */
	private shrinkCorrectSegmentRow(row: HTMLElement): void {
		let needed = 0;
		for (const extent of this.columnContentExtents(row)) {
			needed = Math.max(needed, extent);
		}
		if (needed <= 0) {
			return;
		}
		const current = row.getBoundingClientRect().height;
		if (needed < current - COLUMN_EPSILON) {
			this.fixSegmentRowHeight(row, needed);
		}
	}

	/**
	 * Reserves space for the footnotes this page will extract, before any
	 * column content is filled.
	 *
	 * Footnote calls extract their notes while the walk renders their
	 * paragraphs; each extraction grows the footnote area and shrinks every
	 * column. When that happens after earlier columns are already filled,
	 * the shrink spills laid-out text and the residual sweep moves whole
	 * blocks to the next page — leaving pages with an empty trailing column.
	 *
	 * The page's upcoming content is therefore predicted arithmetically (the
	 * same pretext-backed block estimates the segment planner uses), the
	 * footnotes whose calls land on the page are collected, and their
	 * rendered heights (probed once per note, marker included) are reserved
	 * via `--paged-footnotes-height` up front. Because the prediction
	 * depends on the reserve itself (less column space may push a footnote
	 * call to the next page), the estimate iterates to a fixed point and
	 * keeps the largest value seen — over-reserving only leaves a few
	 * pixels of slack, while under-reserving reproduces the spill.
	 *
	 * The reserved value is recorded on the page area as
	 * `data-paged-footnote-reserve`; the footnotes handler treats it as a
	 * floor while the page is filled and releases the unused remainder when
	 * the page is done.
	 *
	 * @param {HTMLElement} wrapper - The page's flow host.
	 * @param {DocumentFragment|Node} source - The full source fragment.
	 * @param {Node|undefined} start - The node the walk starts at.
	 * @returns {void}
	 */
	private reserveFootnoteAreaHeight(
		wrapper: HTMLElement,
		source: DocumentFragment | Node,
		start: Node | undefined,
	): void {
		if (!start || !measurementCapabilities() || !elementMeasures.size) {
			return;
		}
		const area = wrapper.closest(".paged_area") as HTMLElement | null;
		if (!area || area.dataset.pagedFootnoteReserve !== undefined) {
			return;
		}
		const noteContent = area.querySelector(
			".paged_footnote_content",
		) as HTMLElement | null;
		const noteInner = area.querySelector(
			".paged_footnote_inner_content",
		) as HTMLElement | null;
		if (!noteContent || !noteInner) {
			return;
		}

		const columns = this.flowColumns(wrapper);
		const count = columns.length;
		const columnWidth =
			count > 1
				? columns[0].getBoundingClientRect().width
				: wrapper.clientWidth;
		if (!(columnWidth > 8)) {
			return;
		}

		const flowH = wrapper.getBoundingClientRect().height;
		if (!(flowH > 0)) {
			return;
		}

		// Space already taken above the columns: placed top page floats
		// (deferred ones land here before the layout) and the bottom-float
		// spacer. Pending top floats are deliberately not probed: assuming
		// they defer can only over-predict the page's content, which
		// over-reserves by a note or two — assuming they place could
		// under-reserve when they in fact defer.
		const floatTop = wrapper.querySelector(
			":scope > .paged_float_top",
		) as HTMLElement | null;
		const spacer = wrapper.querySelector(
			":scope > .paged_float_spacer",
		) as HTMLElement | null;
		const placedFloatH =
			(floatTop ? floatTop.getBoundingClientRect().height : 0) +
			(spacer ? spacer.getBoundingClientRect().height : 0);
		const rowH0 = flowH - placedFloatH;
		if (!(rowH0 > 0)) {
			return;
		}

		const used = this.currentUsedColumnHeight(wrapper, count, rowH0);
		const probeWidth =
			noteInner.clientWidth || noteContent.clientWidth || columnWidth;
		const chrome = this.footnoteChrome(noteContent);

		// The top-level source node the walk starts in (or at).
		let topStart: Node | null = start;
		while (topStart && topStart.parentNode !== source) {
			topStart = topStart.parentNode;
		}
		if (!topStart) {
			return;
		}

		const budgetBase = count * rowH0 - used;
		if (budgetBase <= 0) {
			return;
		}

		// Binary search for the minimal safe reserve. Applying reserve R
		// leaves `budgetBase - count * R` of content for the columns; the
		// notes whose calls land there must fit within R (plus the area's
		// chrome). Extraction is weakly decreasing in R, so the predicate
		// is monotone and the search converges on the tight value: any
		// smaller reserve under-covers the extraction and would grow the
		// footnote area after the columns are filled, spilling their text.
		const extractionAt = (reserve: number): number => {
			const budget = budgetBase - count * reserve;
			if (budget <= 0) {
				return 0;
			}
			return this.predictFootnoteReserve(
				source,
				topStart,
				start,
				columnWidth,
				wrapper.getBoundingClientRect().width,
				budget,
				probeWidth,
			);
		};

		const fullExtraction = extractionAt(0);
		if (fullExtraction < 0) {
			// The upcoming content cannot be modelled (loose top-level
			// text); leave the layout to the residual machinery.
			return;
		}
		if (fullExtraction === 0) {
			return;
		}
		// The extraction of the full budget, plus chrome, always covers its
		// own extraction at the reduced budget (extraction is weakly
		// decreasing), so the upper bound is safe from the start.
		let lo = 0;
		let hi = fullExtraction + chrome;
		for (let iteration = 0; iteration < 10 && hi - lo > 0.5; iteration++) {
			const mid = (lo + hi) / 2;
			const extraction = extractionAt(mid);
			if (extraction < 0) {
				return;
			}
			if (extraction + chrome <= mid) {
				hi = mid;
			} else {
				lo = mid;
			}
		}
		const reserve = hi;
		if (reserve <= 0) {
			return;
		}

		// Pathological inputs (footnotes nearly as tall as the page) must
		// keep a sliver of column space rather than producing an empty page.
		let appliedReserve = reserve;
		if (flowH - placedFloatH - appliedReserve < 24) {
			appliedReserve = Math.max(0, flowH - placedFloatH - 24);
			if (appliedReserve <= 0) {
				return;
			}
		}

		const current = parseFloat(
			area.style.getPropertyValue("--paged-footnotes-height"),
		);
		const reserved = Math.ceil(
			(Number.isFinite(current) ? current : 0) + appliedReserve,
		);
		area.style.setProperty("--paged-footnotes-height", `${reserved}px`);
		area.dataset.pagedFootnoteReserve = String(reserved);
		this.invalidateBounds();
	}

	/**
	 * Sums the rendered heights of the footnotes whose calls will land on
	 * this page, walking the upcoming top-level source blocks against the
	 * page's content budget.
	 *
	 * Fully fitting blocks contribute all their notes; the one block that
	 * straddles the page boundary contributes only the notes whose calls sit
	 * before the predicted split (uniform-font blocks get the exact line
	 * offset from pretext, mixed-font blocks a proportional one; unmodellable
	 * blocks conservatively contribute all their notes). Returns -1 when the
	 * walk hits loose top-level text, which has no reliable block context.
	 *
	 * @param {DocumentFragment|Node} source - The full source fragment.
	 * @param {Node} topStart - The top-level node the walk starts in or at.
	 * @param {Node} start - The exact resume node (may sit inside topStart).
	 * @param {number} columnWidth - The width blocks are laid out at.
	 * @param {number} budget - Total column space on the page, in px.
	 * @param {number} probeWidth - Width to probe footnote heights at.
	 * @returns {number} The summed note heights (without area chrome), or -1.
	 */
	private predictFootnoteReserve(
		source: DocumentFragment | Node,
		topStart: Node,
		start: Node,
		columnWidth: number,
		flowWidth: number,
		budget: number,
		probeWidth: number,
	): number {
		let consumed = 0;
		let total = 0;
		let prevMargin = 0;
		let node: Node | null = topStart;
		while (node) {
			if (node instanceof HTMLElement) {
				if (consumed > 0 && needsBreakBefore(node)) {
					// A forced page break ends the predictable region.
					break;
				}
				const skip =
					node === topStart && start !== topStart ? start : undefined;
				// Real layout height: probe the block as the browser will
				// wrap it (hyphenation, justification, footnotes stripped),
				// instead of the pretext estimate — an over-estimate here
				// fits fewer blocks than the page really will and
				// under-counts the notes to reserve. The walk's first block
				// is the exception: a continuation resume point splits it,
				// and the probe can only measure the whole source element,
				// so for it the estimate (which honors the resume point)
				// stays in use.
				const probe =
					skip !== undefined
						? null
						: this.probeBlockHeightWithoutNotes(node, columnWidth);
				const marginT = probe ? probe.marginTop : 0;
				const marginB = probe ? probe.marginBottom : 0;
				const boxH = probe
					? Math.max(0, probe.height - marginT - marginB)
					: this.estimateFlowBlockHeight(
							node,
							columnWidth,
							{ maxLine: 0, maxMargin: 0 },
							skip,
						);
				// Page floats inside the block render outside the columns;
				// subtract their probed heights so they are not counted as
				// flow content (their space above the columns is not part of
				// the prediction — see reserveFootnoteAreaHeight).
				let flowH = boxH;
				const floats = this.floatElementsIn(node);
				if (floats.length) {
					for (const float of floats) {
						flowH = Math.max(
							0,
							flowH - this.probeBlockHeight(float, flowWidth),
						);
					}
				}
				// Margins collapse between siblings in the real columns;
				// summing both sides would over-consume the budget.
				const outer = Math.max(prevMargin, marginT) + flowH;
				const remaining = budget - consumed;
				if (outer <= remaining + COLUMN_EPSILON) {
					consumed += outer;
					prevMargin = marginB;
					total += this.estimateBlockNoteReserve(
						node,
						Infinity,
						flowH,
						columnWidth,
						probeWidth,
						skip,
					);
				} else if (remaining - Math.max(prevMargin, marginT) > 0) {
					total += this.estimateBlockNoteReserve(
						node,
						remaining - Math.max(prevMargin, marginT),
						flowH,
						columnWidth,
						probeWidth,
						skip,
					);
					break;
				} else {
					break;
				}
			} else if (isText(node) && node.data.trim()) {
				return -1;
			}
			node = node.nextSibling;
		}
		return total;
	}

	/**
	 * Rendered heights of a block's footnotes, optionally limited to the
	 * calls that sit before the block's predicted split point.
	 *
	 * @param {HTMLElement} block - The source block.
	 * @param {number} remaining - Column space left on the page (px), or
	 *   Infinity when the block fits entirely.
	 * @param {number} blockHeight - The block's estimated outer height.
	 * @param {number} columnWidth - The width blocks are laid out at.
	 * @param {number} probeWidth - Width to probe note heights at.
	 * @param {Node} [skipBefore] - Resume point; earlier notes are excluded.
	 * @returns {number} The summed note heights in px.
	 */
	private estimateBlockNoteReserve(
		block: HTMLElement,
		remaining: number,
		blockHeight: number,
		columnWidth: number,
		probeWidth: number,
		skipBefore?: Node,
	): number {
		const runs: InlineRun[] = [];
		const notes: Array<{ offset: number; el: HTMLElement }> = [];
		this.collectFlowTextAndNotes(block, skipBefore, runs, notes);
		if (!notes.length) {
			return 0;
		}

		let limitOffset = Infinity;
		if (remaining !== Infinity) {
			const usable = runs.filter((run) => run.text.trim().length);
			if (usable.length) {
				const contentHeight = measureInlineRunsHeight(
					this.measure,
					runs,
					columnWidth,
				);
				if (contentHeight !== null && contentHeight > 0) {
					const lineH = Math.max(
						1,
						...usable.map((run) => run.spec.lineHeight),
					);
					// Space for the block's inline content after its own
					// chrome (padding, border, margins) is accounted for.
					const contentSpace =
						remaining - Math.max(0, blockHeight - contentHeight);
					const fitLines =
						contentSpace > 0
							? Math.floor(contentSpace / lineH)
							: 0;
					const totalLines = Math.max(
						1,
						Math.ceil(contentHeight / lineH),
					);
					if (fitLines >= totalLines) {
						// The chrome rounding ate the overflow: all fits.
					} else if (fitLines <= 0) {
						limitOffset = -1;
					} else {
						const fullText = usable
							.map((run) => run.text)
							.join("");
						const uniform = usable.every(
							(run) =>
								fontKey(run.spec) === fontKey(usable[0].spec),
						);
						limitOffset = uniform
							? this.offsetAtLine(
									fullText,
									usable[0].spec,
									columnWidth,
									fitLines,
								)
							: Math.floor(
									(fullText.length * fitLines) / totalLines,
								);
					}
				}
				// Unmeasurable or probed content keeps limitOffset at
				// Infinity: conservatively count every note in the block.
			}
		}

		let total = 0;
		for (const note of notes) {
			if (note.offset < limitOffset) {
				total += this.estimateNoteHeight(note.el, probeWidth);
			}
		}
		return total;
	}

	/**
	 * Walks a block's flow text (mirroring collectInlineRuns' filters) while
	 * recording the flow-text offset of every footnote it passes, so notes
	 * can be classified against a predicted split offset.
	 *
	 * @param {Element} el - The block element.
	 * @param {Node} [skipBefore] - Resume point; earlier content is excluded.
	 * @param {InlineRun[]} runs - Output: the flow text as font runs.
	 * @param {Array<{offset: number, el: HTMLElement}>} notes - Output: the
	 *   footnotes with their flow-text offsets.
	 * @returns {void}
	 */
	private collectFlowTextAndNotes(
		el: Element,
		skipBefore: Node | undefined,
		runs: InlineRun[],
		notes: Array<{ offset: number; el: HTMLElement }>,
	): void {
		const visit = (element: Element, inherited: FontSpec | null): void => {
			for (const child of Array.from(element.childNodes)) {
				if (isText(child)) {
					if (
						skipBefore &&
						child !== skipBefore &&
						!(skipBefore.compareDocumentPosition(child) &
							Node.DOCUMENT_POSITION_FOLLOWING)
					) {
						continue;
					}
					const spec =
						(element.dataset.ref
							? elementMeasures.get(element.dataset.ref)?.font
							: undefined) || inherited;
					if (spec) {
						const last = runs[runs.length - 1];
						if (last && fontKey(last.spec) === fontKey(spec)) {
							last.text += child.data;
						} else {
							runs.push({ text: child.data, spec });
						}
					}
				} else if (isElement(child)) {
					const childEl = child as HTMLElement;
					if (childEl.dataset.note === "footnote") {
						if (
							!skipBefore ||
							childEl === skipBefore ||
							(skipBefore.compareDocumentPosition(childEl) &
								Node.DOCUMENT_POSITION_FOLLOWING)
						) {
							let offset = 0;
							for (const run of runs) {
								offset += run.text.length;
							}
							notes.push({ offset, el: childEl });
						}
						continue;
					}
					if (
						childEl.tagName === "SCRIPT" ||
						childEl.tagName === "STYLE"
					) {
						continue;
					}
					const rec = childEl.dataset.ref
						? elementMeasures.get(childEl.dataset.ref)
						: undefined;
					if (rec && rec.display === "none") {
						continue;
					}
					visit(childEl, (rec && rec.font) || inherited);
				}
			}
		};
		visit(
			el,
			(el.dataset.ref
				? elementMeasures.get(el.dataset.ref)?.font
				: undefined) ?? null,
		);
	}

	/**
	 * Flow-text offset just past the given line, when the text is laid out
	 * at the given width. Line counts use the same narrowed width as
	 * measureInlineRunsHeight so both agree on where the block wraps.
	 *
	 * @param {string} text - The block's flow text.
	 * @param {FontSpec} spec - The (uniform) font specification.
	 * @param {number} width - The layout width.
	 * @param {number} lines - The number of lines that fit.
	 * @returns {number} The offset ending the last fitted line; the full
	 *   text length when the text cannot be measured (conservative).
	 */
	private offsetAtLine(
		text: string,
		spec: FontSpec,
		width: number,
		lines: number,
	): number {
		try {
			const prepared = this.measure.prepare(text, spec);
			const lineWidth = width * 0.95;
			let end = 0;
			let count = 0;
			this.measure.walkLines(
				prepared,
				lineWidth,
				lineWidth,
				(line) => {
					end = this.measure.cursorToOffset(prepared, line.end);
					return ++count >= lines ? false : undefined;
				},
			);
			return count >= lines ? end : text.length;
		} catch {
			return text.length;
		}
	}

	/**
	 * Rendered height of a footnote in the footnote area, probed by cloning
	 * it into the off-screen probe host at the note width. The clone is
	 * marked as a footnote marker so the list-item display and the rendered
	 * `::marker` ("N. ") are part of the measurement, matching the real
	 * extraction. Cached per note and width.
	 *
	 * @param {HTMLElement} note - The source footnote element.
	 * @param {number} width - The footnote area's content width.
	 * @returns {number} The note's outer height in px.
	 */
	private estimateNoteHeight(note: HTMLElement, width: number): number {
		const ref = note.dataset.ref || "";
		const key = `${ref}\u0000note\u0000${Math.round(width * 4)}`;
		const cached = segmentProbeCache.get(key);
		if (cached) {
			return cached.height;
		}
		const host = getSegmentProbeHost();
		host.style.width = `${Math.max(4, width)}px`;
		const clone = note.cloneNode(true) as HTMLElement;
		clone.removeAttribute("id");
		if (clone.dataset.ref) {
			clone.setAttribute("data-footnote-marker", clone.dataset.ref);
		}
		host.appendChild(clone);
		let height = clone.offsetHeight;
		const style = window.getComputedStyle(clone);
		height += parseFloat(style.marginTop) || 0;
		height += parseFloat(style.marginBottom) || 0;
		clone.remove();
		if (segmentProbeCache.size >= 4096) {
			segmentProbeCache.clear();
		}
		segmentProbeCache.set(key, {
			height,
			line: 0,
			marginTop: 0,
			marginBottom: 0,
		});
		return height;
	}

	/**
	 * Page-float elements within a source node (the node itself included).
	 *
	 * @param {Node} node - The source node.
	 * @returns {HTMLElement[]} The float elements, possibly empty.
	 */
	private floatElementsIn(node: Node): HTMLElement[] {
		if (!(node instanceof HTMLElement)) {
			return [];
		}
		if (node.dataset.pageFloat) {
			return [node];
		}
		return Array.from(
			node.querySelectorAll<HTMLElement>("[data-page-float]"),
		);
	}

	/**
	 * Height of the flow content already rebuilt into the page's columns by
	 * addOverflowToPage (the previous page's carried overflow), in the
	 * sequential-fill coordinate space: a non-empty column k implies columns
	 * 0..k-1 are full.
	 *
	 * @param {HTMLElement} wrapper - The page's flow host.
	 * @param {number} count - The number of columns.
	 * @param {number} rowH - The current height of one column.
	 * @returns {number} The used content height in px.
	 */
	private currentUsedColumnHeight(
		wrapper: HTMLElement,
		count: number,
		rowH: number,
	): number {
		if (count <= 1) {
			return this.contentExtent(wrapper);
		}
		const rows = wrapper.querySelectorAll(":scope > .paged_columns");
		const row = rows[rows.length - 1] as HTMLElement | null;
		if (!row) {
			return 0;
		}
		let used = 0;
		const columns = Array.from(
			row.querySelectorAll<HTMLElement>(":scope > .paged_column"),
		);
		columns.forEach((column, index) => {
			const extent = this.contentExtent(column);
			if (extent > 0) {
				used = Math.max(used, index * rowH + extent);
			}
		});
		return used;
	}

	/**
	 * Bottom slack the walk's break verification grants the deepest content
	 * of a container: the summed bottom margin, padding and border of the
	 * chain of last elements (the same allowance textBreak computes via
	 * getAncestorPaddingBorderAndMarginSums when it accepts a line whose box
	 * ends inside its parent's bottom margin zone).
	 *
	 * @param {HTMLElement} container - The column or flow host.
	 * @returns {number} The trailing slack in px.
	 */
	private trailingBottomSlack(container: HTMLElement): number {
		let slack = 0;
		for (
			let el = container.lastElementChild as HTMLElement | null;
			el;
			el = el.lastElementChild as HTMLElement | null
		) {
			const style = window.getComputedStyle(el);
			const px = (value: string) => {
				const parsed = parseFloat(value);
				return Number.isFinite(parsed) ? parsed : 0;
			};
			slack +=
				px(style.marginBottom) +
				px(style.paddingBottom) +
				px(style.borderBottomWidth);
		}
		return slack;
	}

	/**
	 * Distance from a container's top to the bottom of its content,
	 * including the trailing margin of its deepest last child (range rects
	 * exclude margins). Shared by the column-extent and carried-content
	 * measurements.
	 *
	 * @param {HTMLElement} container - The column or flow host to measure.
	 * @returns {number} The content extent in px, 0 when empty.
	 */
	private contentExtent(container: HTMLElement): number {
		if (!container.firstChild) {
			return 0;
		}
		const containerTop = container.getBoundingClientRect().top;
		const range = document.createRange();
		range.selectNodeContents(container);
		const rect = range.getBoundingClientRect();
		let bottom =
			rect && (rect.bottom !== 0 || rect.top !== 0) ? rect.bottom : 0;
		let deepest = 0;
		let trailingMargin = 0;
		for (
			let last = container.lastElementChild;
			last;
			last = last.lastElementChild
		) {
			deepest = Math.max(deepest, last.getBoundingClientRect().bottom);
			const margin = parseFloat(
				window.getComputedStyle(last).marginBottom,
			);
			if (Number.isFinite(margin)) {
				trailingMargin = Math.max(trailingMargin, margin);
			}
		}
		bottom = Math.max(bottom, deepest + trailingMargin);
		return Math.max(0, bottom - containerTop);
	}

	/**
	 * Vertical chrome (margins, padding, borders) the footnote content box
	 * adds around the notes, matching what recalcFootnotesHeight adds when
	 * it sizes the area from actual content.
	 *
	 * @param {HTMLElement} noteContent - The `.paged_footnote_content` box.
	 * @returns {number} The chrome height in px.
	 */
	private footnoteChrome(noteContent: HTMLElement): number {
		const style = window.getComputedStyle(noteContent);
		const px = (value: string) => {
			const parsed = parseFloat(value);
			return Number.isFinite(parsed) ? parsed : 0;
		};
		return (
			px(style.marginTop) +
			px(style.marginBottom) +
			px(style.paddingTop) +
			px(style.paddingBottom) +
			px(style.borderTopWidth) +
			px(style.borderBottomWidth)
		);
	}

	/**
	 * Gives a freshly opened segment row its planned natural height, clamped
	 * to the space left on the page. The row is always fixed when the plan
	 * covers this span: a flexible row would be filled to the remaining
	 * page height and then shrunk when the next span opens, spilling
	 * content that has nowhere to go. Spans the planner did not see
	 * (nested or stale entries) leave the queue untouched and keep the row
	 * flexible.
	 *
	 * @param {Node} node - The span element that opened the segment.
	 * @param {HTMLElement[]} newColumns - The new segment's column boxes.
	 * @returns {void}
	 */
	private applyPlannedSegmentHeight(
		node: Node,
		newColumns: HTMLElement[],
	): void {
		const entry = this.segmentHeightQueue.length
			? this.segmentHeightQueue[0]
			: undefined;
		if (!entry || !newColumns.length) {
			return;
		}
		const ref =
			node instanceof HTMLElement && node.dataset
				? node.dataset.ref
				: undefined;
		if (!ref || entry.ref !== ref) {
			return;
		}
		this.segmentHeightQueue.shift();
		const row = newColumns[0].parentElement;
		if (!row || !row.classList.contains("paged_columns")) {
			return;
		}
		const remaining = row.getBoundingClientRect().height;
		const target = Math.min(entry.height ?? remaining, remaining);
		if (target > COLUMN_EPSILON) {
			this.fixSegmentRowHeight(row, target);
		}
	}

	/**
	 * Whether a span should be deferred to the next page because there is no
	 * room for it below the current segment. Measured against the actual
	 * remaining space in the flow host at walk time, so it stays correct even
	 * when the planner's `available` estimate was off (e.g. a top float was
	 * not yet placed when the page was planned). When deferred, the element is
	 * treated as ordinary content and the overflow path moves it to the next
	 * page, where it is encountered as a span again.
	 *
	 * @param {HTMLElement} wrapper - The page's flow host.
	 * @param {Node} node - The span element.
	 * @returns {boolean} True when the span should not be applied now.
	 */
	private shouldDeferColumnSpan(wrapper: HTMLElement, node: Node): boolean {
		if (!(node instanceof HTMLElement)) {
			return false;
		}
		const rows = wrapper.querySelectorAll(":scope > .paged_columns");
		const lastRow = rows[rows.length - 1] as HTMLElement | undefined;
		if (!lastRow) {
			return false;
		}
		// A flexible last row fills the flow host but can shrink to make room
		// for the span; only a row fixed at its planned natural height has a
		// meaningful "remaining" space below it.
		if (lastRow.dataset.pagedSegmentFixed !== "true") {
			return false;
		}
		const remaining =
			wrapper.getBoundingClientRect().bottom -
			lastRow.getBoundingClientRect().bottom;
		if (remaining <= COLUMN_EPSILON) {
			// The flow host is already full: no room for this span.
			return true;
		}
		const ctx = { maxLine: 0, maxMargin: 0 };
		const spanHeight = this.estimateFlowBlockHeight(
			node,
			wrapper.getBoundingClientRect().width,
			ctx,
		);
		const minRoom = (ctx.maxLine || 16) + 2 * COLUMN_EPSILON;
		return remaining < spanHeight + minRoom;
	}

	/**
	 * Releases a fixed height from the page's final segment row, so it
	 * absorbs the leftover space below it. Only the last row may flex; rows
	 * closed by a following span keep their measured height.
	 *
	 * @param {HTMLElement} wrapper - The page's flow host.
	 * @returns {void}
	 */
	private relaxFinalSegmentRow(wrapper: HTMLElement): void {
		const rows = wrapper.querySelectorAll(":scope > .paged_columns");
		const last = rows[rows.length - 1] as HTMLElement | undefined;
		if (last && last.dataset.pagedSegmentFixed) {
			last.style.flex = "";
			delete last.dataset.pagedSegmentFixed;
		}
	}


	/**
	 * Makes a column box the active layout root: bounds, fragmentainer
	 * ancestor walks and overflow detection follow this element until the
	 * next column (or page) takes over.
	 *
	 * @param {HTMLElement} dest - The column (or single-column wrapper).
	 * @returns {void}
	 */
	setActiveColumn(dest: HTMLElement): void {
		// Single-column pages keep the content area as the layout root
		// (classic bounds); only manual column boxes swap the root.
		if (dest.classList.contains("paged_column")) {
			this.element = dest;
		}
		this.boundsDirty = true;
		// Compute bounds immediately (the overflow phase relies on
		// refreshBounds, but callers may read this.bounds directly).
		if (dest.classList.contains("paged_column") && dest.closest(".paged_flow")) {
			this.bounds = this.manualColumnBounds(dest);
		} else {
			this.bounds = this.refreshBounds();
		}
	}

	/**
	 * Bounds of a manual column: the column's own box, which the flex column
	 * row already sizes to account for the top page float and any
	 * `column-span: all` segments above it.
	 *
	 * Overflow detection reads against these bounds, so the physical column
	 * boxes match the detection exactly. Using the flow host's full height
	 * here would make columns inside a shorter `column-span` segment accept
	 * the whole page height, letting their text overlap whatever follows.
	 *
	 * @param {HTMLElement} column - A `.paged_column` box inside a `.paged_flow`.
	 * @returns {DOMRect} The bounds used for overflow detection.
	 */
	private manualColumnBounds(column: HTMLElement): DOMRect {
		const elRect = column.getBoundingClientRect();
		const availableHeight = Math.max(0, elRect.height);
		return new DOMRect(
			elRect.left,
			elRect.top,
			elRect.width,
			availableHeight,
		);
	}

	/**
	 * Clears overflow bookkeeping attributes from a column and its content.
	 *
	 * Range tagging (which marks content already accounted for as overflow)
	 * can cross a column boundary — `nodeAfter` climbs past a column's last
	 * child and tags the next column as range-end overflow — suppressing all
	 * further detection there. Every column starts its fill with a clean
	 * slate, so these attributes are stripped when content is handed over.
	 *
	 * @param {HTMLElement} dest - The column (or single-column wrapper).
	 * @returns {void}
	 */
	private clearOverflowTags(dest: HTMLElement): void {
		dest.removeAttribute("data-overflow-tagged");
		dest.removeAttribute("data-range-start-overflow");
		dest.removeAttribute("data-range-end-overflow");
		dest
			.querySelectorAll(
				"[data-overflow-tagged], [data-range-start-overflow], [data-range-end-overflow]",
			)
			.forEach((el) => {
				el.removeAttribute("data-overflow-tagged");
				el.removeAttribute("data-range-start-overflow");
				el.removeAttribute("data-range-end-overflow");
			});
	}

	/**
	 * Advances layout to the next column, rebuilding the current overflow
	 * into it and clearing stray overflow tags left by range tagging.
	 *
	 * @param {HTMLElement[]} columns - The page's column boxes.
	 * @param {number} colIndex - Current column index.
	 * @param {BreakToken} token - Overflow token to rebuild.
	 * @param {HTMLElement|null} prevPage - Previous page content.
	 * @returns {HTMLElement} The new active column.
	 */
	private advanceColumn(
		columns: HTMLElement[],
		colIndex: number,
		token: BreakToken,
		prevPage: HTMLElement | null,
	): HTMLElement {
		const next = columns[colIndex + 1];
		this.setActiveColumn(next);
		this.addOverflowToPage(next, token, prevPage || undefined);
		this.clearOverflowTags(next);
		this.registerFragmentainers(next);
		return next;
	}

	/**
	 * Page content bounds, re-measured at most once per mutation batch.
	 *
	 * Appending a node only matters geometrically when something later
	 * reads geometry; deferring the read here lets consecutive appends
	 * share a single engine layout instead of forcing one per node.
	 */
	refreshBounds(): DOMRect {
		if (this.boundsDirty) {
			const elRect = this.element.getBoundingClientRect();
			if (
				this.element.classList.contains("paged_column") &&
				this.element.closest(".paged_flow")
			) {
				// Manual columns are content-sized; overflow is detected
				// against the flow host's vertical extent (the visible page
				// region), while the horizontal extent is the column's own.
				// The helper also keeps the physical column row's height in
				// lockstep with these bounds.
				this.bounds = this.manualColumnBounds(this.element);
			} else {
				this.bounds = elRect;
			}
			this.boundsDirty = false;
		}
		return this.bounds;
	}

	/**
	 * True when the element computes to more than one column.
	 */
	isMulticolElement(el: Element): boolean {
		return this.getFragmentainerMeta(el).count > 1;
	}

	/**
	 * Reads and caches the column geometry of a potential fragmentainer.
	 *
	 * `column-gap: normal` resolves to 1em per spec; computed styles may
	 * report the keyword, so it is approximated via font-size when needed.
	 */
	getFragmentainerMeta(el: Element): FragmentainerMeta {
		let meta = this.fragmentainerMeta.get(el);
		if (meta) {
			return meta;
		}
		const style = window.getComputedStyle(el);
		const count = parseInt(style.columnCount) || 1;
		let gap = parseFloat(style.columnGap);
		if (Number.isNaN(gap)) {
			gap = parseFloat(style.fontSize) || 0;
		}
		const width = el.clientWidth || el.getBoundingClientRect().width;
		meta = {
			count,
			gap,
			columnWidth: count > 1 ? (width - (count - 1) * gap) / count : width,
		};
		this.fragmentainerMeta.set(el, meta);
		return meta;
	}

	/**
	 * The layout box of a fragmentainer.
	 *
	 * A fragmented multicol container's getBoundingClientRect() returns the
	 * union across all fragments, which poisons geometry; the real box is
	 * the first fragment positioned at (left, top) sized clientWidth x
	 * clientHeight.
	 */
	fragmentainerBox(el: Element): {
		left: number;
		top: number;
		right: number;
		bottom: number;
	} {
		const first =
			el instanceof HTMLElement ? el.getClientRects()[0] : undefined;
		const fallback = el.getBoundingClientRect();
		const left = first ? first.left : fallback.left;
		const top = first ? first.top : fallback.top;
		const width =
			el instanceof HTMLElement && el.clientWidth
				? el.clientWidth
				: fallback.width;
		const height =
			el instanceof HTMLElement && el.clientHeight
				? el.clientHeight
				: fallback.height;
		return {
			left,
			top,
			right: left + width,
			bottom: top + height,
		};
	}

	/**
	 * Finds multicol roots among the rendered descendants of `root`
	 * (including itself) and registers them. Nested fragmentainers are not
	 * supported: the inner container degrades to a single column with a
	 * warning.
	 */
	registerFragmentainers(root: HTMLElement | Node): void {
		if (root instanceof HTMLElement && this.isMulticolElement(root)) {
			this.registerFragmentainer(root);
		}
		if (this.multicolSelectors.size === 0) {
			return;
		}
		for (const selector of this.multicolSelectors) {
			let matches: NodeListOf<Element> | undefined;
			try {
				matches = (root as HTMLElement).querySelectorAll(selector);
			} catch {
				continue;
			}
			if (!matches) {
				continue;
			}
			for (const el of Array.from(matches)) {
				if (!this.isMulticolElement(el)) {
					continue;
				}
				this.registerFragmentainer(el);
			}
		}
	}

	/**
	 * Registers a single fragmentainer unless it sits inside an already
	 * registered one (nested multicol), which is degraded gracefully.
	 */
	private registerFragmentainer(el: Element): void {
		if (this.fragmentainers.has(el)) {
			return;
		}
		let ancestor = el.parentElement;
		while (
			ancestor &&
			!ancestor.classList.contains("paged_page_content") &&
			!ancestor.classList.contains("paged_footnote_inner_content")
		) {
			if (this.fragmentainers.has(ancestor)) {
				console.warn(
					"paged-with-floats: nested multi-column containers are not supported; " +
						"rendering the inner container as a single column.",
				);
				(el as HTMLElement).style.columnCount = "1";
				this.fragmentainerMeta.set(el, {
					count: 1,
					gap: 0,
					columnWidth: el.getBoundingClientRect().width,
				});
				return;
			}
			ancestor = ancestor.parentElement;
		}
		this.fragmentainers.add(el);
	}

	/**
	 * The nearest registered fragmentainer ancestor of a node, or null when
	 * the node flows directly within the page wrapper (single-column
	 * semantics relative to the page bounds).
	 */
	getFragmentainer(node: Node): Element | null {
		let el: Element | null =
			node instanceof Element ? node : node.parentElement;

		while (
			el &&
			el !== this.element &&
			!el.classList.contains("paged_page_content") &&
			!el.classList.contains("paged_footnote_inner_content")
		) {
			if (this.fragmentainers.has(el)) {
				return el;
			}
			el = el.parentElement;
		}

		return null;
	}

	/**
	 * Whether a single client rect of a node exceeds its fragmentainer.
	 *
	 * Without a fragmentainer this falls back to the classic page-bounds
	 * comparison. Within a fragmentainer:
	 * - a rect starting at or beyond the right edge lies in the hidden
	 *   spill-over column and overflows;
	 * - a rect starting in the last visible column must also fit vertically.
	 */
	rectOverflows(
		rect: DOMRect,
		additions: number,
		frag: Element | null,
		bounds: DOMRect = this.bounds,
	): boolean {
		if (!frag) {
			return (
				rect.right > bounds.right + COLUMN_EPSILON ||
				rect.bottom > bounds.bottom + additions + COLUMN_EPSILON
			);
		}

		const meta = this.getFragmentainerMeta(frag);
		const b = this.fragmentainerBox(frag);

		if (rect.left >= b.right + meta.gap - COLUMN_EPSILON) {
			// Started inside the hidden spill-over column.
			return true;
		}

		if (meta.count > 1) {
			const rel = rect.left - b.left;
			const stride = meta.columnWidth + meta.gap;
			const colIndex = Math.floor((rel + COLUMN_EPSILON) / stride);
			if (colIndex >= meta.count - 1) {
				// Last visible column: vertical space is the constraint.
				return (
					rect.bottom > b.bottom + additions + COLUMN_EPSILON &&
					rect.left < b.right + COLUMN_EPSILON
				);
			}
		} else if (rect.bottom > b.bottom + additions + COLUMN_EPSILON) {
			return true;
		}

		return false;
	}

	/**
	 * Constrains a multicol block to the remaining vertical space on this
	 * page so the browser fragments it internally instead of balancing it
	 * past the bottom edge. Only applied when the block's natural height
	 * does not fit.
	 */
	constrainMulticolHeight(el: Element, bounds: DOMRect = this.bounds): void {
		const box = this.fragmentainerBox(el);
		const bottom = box.bottom;
		if (bottom - box.top === 0 || bottom <= bounds.bottom + COLUMN_EPSILON) {
			return;
		}
		const htmlEl = el as HTMLElement;
		const available = Math.floor(bounds.bottom - box.top);
		if (available <= 0) {
			return;
		}
		htmlEl.style.columnFill = "auto";
		htmlEl.style.height = `${available}px`;
		htmlEl.dataset.pagedFragmentainerConstrained = "true";
		// Geometry changed; refresh cached metadata for this element.
		this.fragmentainerMeta.delete(el);
		this.invalidateBounds();
	}

	/**
	 * Fills the page and check for the first overflow.
	 *
	 * @param {Element} wrapper - current Page's content wrapper
	 * @param {HTML} source - Html source template content
	 * @param {BreakToken} breakToken - previous breakToken
	 * @param {Page} prevPage - previous Page
	 * @param {DOMRect} bounds - Page bounds
	 * @returns {BreakToken}
	 */
	async renderTo(
		wrapper: HTMLElement,
		source: DocumentFragment | Node,
		breakToken: BreakToken | undefined,
		prevPage: HTMLElement | null = null,
		bounds: DOMRect = this.bounds,
	): Promise<RenderResult> {
		let start = this.getStart(source, breakToken);
		let firstDivisible = source as HTMLElement;

		while (firstDivisible.children.length == 1) {
			firstDivisible = firstDivisible.children[0] as HTMLElement;
		}

		let walker = walk(start!, source);

		let node: Node | undefined;
		let done;
		let next;
		let forcedBreakQueue: Node[] = [];

		let prevBreakToken = breakToken || new BreakToken(start!);

		// Manual columns: the flow host holds N column boxes that are
		// filled sequentially as single-column fragmentainers. `dest` is
		// the column currently receiving content (the host itself for
		// single-column pages). `columns` may be swapped for a fresh
		// segment when a `column-span: all` element is encountered.
		let columns = this.flowColumns(wrapper);
		let colIndex = 0;
		let dest = columns[0];
		this.setActiveColumn(dest);

		this.hooks &&
			this.hooks.onPageLayout.trigger(wrapper, prevBreakToken, this);

		// Add overflow, and check that it doesn't have overflow itself.
		this.addOverflowToPage(
			dest,
			breakToken,
			prevPage as HTMLElement | undefined,
		);

		// Reserve space for the footnotes this page will extract before any
		// further content is laid out, so a late footnote-area growth cannot
		// shrink already-filled columns and spill their text.
		this.reserveFootnoteAreaHeight(wrapper, source, start);

		// Footnotes may change the bounds.
		bounds = this.refreshBounds();

		// Register fragmentainers (mid-flow multicol blocks inside the
		// column; the manual column boxes themselves are plain single
		// column fragmentainers and need no registration).
		this.registerFragmentainers(dest);
		for (const frag of Array.from(this.fragmentainers)) {
			this.constrainMulticolHeight(frag, bounds);
		}

		let newBreakToken = this.findBreakToken(
			dest,
			source,
			bounds,
			prevBreakToken,
			start,
		);

		if (prevBreakToken.isFinished()) {
			if (newBreakToken) {
				newBreakToken.setFinished();
			}
			return new RenderResult(newBreakToken);
		}

		// Overflow rebuilt from the previous page can be taller than the
		// first column; hand it to the next column on this page before
		// walking further content.
		if (
			newBreakToken &&
			!newBreakToken.isFinished() &&
			colIndex < columns.length - 1
		) {
			dest = this.advanceColumn(
				columns,
				colIndex,
				newBreakToken,
				prevPage as HTMLElement | null,
			);
			colIndex++;
			bounds = this.refreshBounds();
			newBreakToken = undefined;
		}

		// Plan natural heights for any `column-span` segments ahead on this
		// page: fixes the first row at the height its content needs and
		// queues heights for rows opened by later spans, so short segments
		// stop receiving an equal flex share of the page.
		this.planSegmentHeights(wrapper, source, start);

		let hasRenderedContent = Array.from(wrapper.childNodes).some((child) => {
			if (!(child instanceof HTMLElement)) {
				return true;
			}
			return (
				!child.classList.contains("paged_float_top") &&
				!child.classList.contains("paged_float_bottom") &&
				!child.classList.contains("paged_float_spacer")
			);
		});

		if (prevBreakToken) {
			forcedBreakQueue = prevBreakToken.getForcedBreakQueue();
		}

		let mainLoopGuard = 0;
		while (!done && !newBreakToken) {
			if (++mainLoopGuard > 10000) {
				console.error(
					"paged-with-floats: layout main loop guard exceeded; bailing out. node=",
					node?.nodeName,
					"done=",
					done,
					"newBreakToken=",
					newBreakToken,
				);
				this.failed = true;
				return new RenderResult(
					undefined,
					("Layout main loop guard exceeded") as unknown as Error,
				);
			}
			next = walker.next();
			node = next.value;
			done = next.done;

			if (node) {
				this.hooks && this.hooks.layoutNode.trigger(node);

				// Check if the rendered element has a break set
				// Remember the node but don't apply the break until we have laid
				// out the rest of any parent content - this lets a table or divs
				// side by side still add content to this page before we start a new
				// one.
				if (this.shouldBreak(node) && hasRenderedContent) {
					forcedBreakQueue.push(node);
					// The page now ends a part: a forced page break follows.
					// Marked for the post-flow column balancer, which
					// balances the final row of every part-ending page (not
					// just the document's last page).
					const pageEl = this.element.closest(
						".paged_page",
					) as HTMLElement | null;
					if (pageEl) {
						pageEl.dataset.pagedPartEnd = "true";
					}
				}

				if (
					!forcedBreakQueue.length &&
					(node as HTMLElement).dataset &&
					(node as HTMLElement).dataset.page
				) {
					let named = (node as HTMLElement).dataset.page!;
					let page = this.element.closest(".paged_page")!;
					page.classList.add("pagejs_named_page");
					page.classList.add("paged_" + named + "_page");
					if (!(node as HTMLElement).dataset.splitFrom) {
						page.classList.add("paged_" + named + "_first_page");
					}
				}
			}

			// A `column-span: all` element takes a full-width row between
			// column segments; the flow after it continues in a fresh set of
			// columns (column 0 again). If the current column is full, its
			// overflow can still be absorbed by the remaining columns of this
			// segment (migrateShrunkenSegmentOverflow runs when the span
			// opens) — only defer the span when the segment's last column is
			// full, in which case the overflow must go to the next page.
			if (this.isColumnSpan(node) && columns.length > 1) {
				const hasOverflow = this.hasOverflow(
					dest,
					this.refreshBounds(),
				);
				const defer = this.shouldDeferColumnSpan(wrapper, node!);
				const canAbsorb =
					(!hasOverflow || colIndex < columns.length - 1) && !defer;
				if (canAbsorb) {
					columns = this.applyColumnSpan(
						wrapper,
						node!,
						source,
						breakToken,
					);
					colIndex = 0;
					dest = columns[0];
					this.setActiveColumn(dest);
					bounds = this.refreshBounds();
					hasRenderedContent = true;
					walker = walk(nodeAfter(node!, source, false, false) as Node, source);
					continue;
				}
				if (defer) {
					// No room for this span on the page: break here so the span
					// and all following content render on the next page, where
					// it is laid out as a span with the full column width. The
					// page now ends a part — marked for the post-flow column
					// balancer, which spreads the remaining content across the
					// columns instead of leaving later ones empty.
					const pageEl = this.element.closest(
						".paged_page",
					) as HTMLElement | null;
					if (pageEl) {
						pageEl.dataset.pagedPartEnd = "true";
					}
					newBreakToken = this.breakAt(node!, 0);
					this.sweepResidualColumnOverflow(
						wrapper,
						source,
						newBreakToken,
						prevBreakToken,
					);
					this.relaxFinalSegmentRow(wrapper);
					return new RenderResult(newBreakToken);
				}
			}

			// Check whether we have overflow when we've completed laying out a top
			// level element. This lets it have multiple children overflowing and
			// allows us to move all of the overflows onto the next page together.
			if (forcedBreakQueue.length || !node || !node.parentElement) {
				this.hooks && this.hooks.layout.trigger(wrapper, this);

				let imgs = wrapper.querySelectorAll("img");
				if (imgs.length) {
					await this.waitForImages(imgs);
				}

				// Single lazy re-measurement for this whole check phase.
				bounds = this.refreshBounds();

				newBreakToken = this.findBreakToken(
					dest,
					source,
					bounds,
					prevBreakToken,
					node,
				);

				if (
					newBreakToken &&
					node === undefined &&
					colIndex >= columns.length - 1
				) {
					// We have run out of content. Do add the overflow to a new
					// page but don't repeat the whole thing again. Only finish
					// when there is no further column on this page to fill —
					// otherwise the remaining columns are skipped and the
					// overflow jumps to the next page.
					newBreakToken.setFinished();
				}

				if (forcedBreakQueue.length) {
					if (newBreakToken) {
						newBreakToken.setForcedBreakQueue(forcedBreakQueue);
					} else {
						newBreakToken = this.breakAt(
							forcedBreakQueue.shift(),
							0,
							forcedBreakQueue,
						);
					}
				}

				if (newBreakToken && newBreakToken.equals(prevBreakToken)) {
					this.failed = true;
					console.warn(
						"paged-with-floats: unable to layout item, stopping render: " + node,
					);
					return new RenderResult(
						undefined,
						("Unable to layout item: " + node) as unknown as Error,
					);
				}

				// The current column is full: hand the overflow to the next
				// column on this page instead of breaking to a new page.
				if (
					newBreakToken &&
					!newBreakToken.isFinished() &&
					colIndex < columns.length - 1
				) {
					dest = this.advanceColumn(
						columns,
						colIndex,
						newBreakToken,
						prevPage as HTMLElement | null,
					);
					colIndex++;
					bounds = this.refreshBounds();
					newBreakToken = undefined;
					continue;
				}

				if (!node || newBreakToken) {
					if (newBreakToken) {
						this.sweepResidualColumnOverflow(
							wrapper,
							source,
							newBreakToken,
							prevBreakToken,
						);
					}
					this.relaxFinalSegmentRow(wrapper);
					return new RenderResult(newBreakToken);
				}
			}

			// Should the Node be a shallow or deep clone?
			let shallow = isContainer(node!);

			const appendedClone = this.append(
				node!,
				dest,
				source,
				breakToken,
				shallow,
			);

			// A top-level multicol block (e.g. styled inline, so no tracked
			// selector matches) becomes a fragmentainer. Constrain its height
			// to the remaining space when its natural height does not fit.
			if (
				appendedClone instanceof HTMLElement &&
				this.isMulticolElement(appendedClone)
			) {
				this.registerFragmentainer(appendedClone);
				this.constrainMulticolHeight(appendedClone, this.refreshBounds());
			} else {
				// Content appended *inside* an existing fragmentainer (e.g.
				// while filling a continued multicol block) changes how much
				// of the remaining column space is used; keep the
				// fragmentainer's height constraint current.
				const parentFrag =
					appendedClone instanceof Node
						? this.getFragmentainer(appendedClone)
						: null;
				if (
					parentFrag &&
					parentFrag !== appendedClone &&
					parentFrag !== this.element
				) {
					this.constrainMulticolHeight(parentFrag, this.refreshBounds());
				}
			}

			// The append mutated the DOM; geometry consumers later in this
			// iteration re-measure once, lazily.
			this.invalidateBounds();

			// Check whether layout has content yet.
			if (!hasRenderedContent) {
				hasRenderedContent = hasContent(node!);
			}

			// Skip to the next node if a deep clone was rendered.
			if (!shallow) {
				walker = walk(nodeAfter(node!, source, false, false) as Node, source);
			}
		}

		// The walker may have exhausted right after handing content to a
		// new column, in which case the loop exits before that column's
		// overflow is checked. Run one final check, cascading into any
		// further columns.
		if (done && !newBreakToken) {
			let cascades = 0;
			for (;;) {
				bounds = this.refreshBounds();
				newBreakToken = this.findBreakToken(
					dest,
					source,
					bounds,
					prevBreakToken,
					undefined,
				);
				if (
					newBreakToken &&
					node === undefined &&
					colIndex >= columns.length - 1
				) {
					newBreakToken.setFinished();
				}
				if (
					newBreakToken &&
					!newBreakToken.isFinished() &&
					colIndex < columns.length - 1
				) {
					dest = this.advanceColumn(
						columns,
						colIndex,
						newBreakToken,
						prevPage as HTMLElement | null,
					);
					colIndex++;
					newBreakToken = undefined;
					if (++cascades >= columns.length) {
						break;
					}
					continue;
				}
				break;
			}
		}

		this.hooks &&
			this.hooks.beforeRenderResult.trigger(newBreakToken, wrapper, this);
		if (newBreakToken) {
			this.sweepResidualColumnOverflow(
				wrapper,
				source,
				newBreakToken,
				prevBreakToken,
			);
		}
		this.relaxFinalSegmentRow(wrapper);
		return new RenderResult(newBreakToken);
	}

	breakAt(
		node: Node | undefined,
		offset = 0,
		forcedBreakQueue: Node[] = [],
	): BreakToken {
		let newBreakToken = new (BreakToken as any)(
			node,
			offset,
			forcedBreakQueue,
		) as BreakToken;
		let breakHooks = this.hooks.onBreakToken.triggerSync(
			newBreakToken,
			undefined,
			node as HTMLElement | undefined,
			this,
		);
		breakHooks.forEach((newToken) => {
			if (typeof newToken != "undefined") {
				newBreakToken = newToken as BreakToken;
			}
		});

		return newBreakToken;
	}

	shouldBreak(node: Node, limiter?: Node): boolean {
		let previousNode = nodeBefore(node, limiter);
		let parentNode = node.parentNode;
		let parentBreakBefore =
			needsBreakBefore(node) &&
			parentNode &&
			!previousNode &&
			needsBreakBefore(parentNode as unknown as Node);
		let doubleBreakBefore;

		if (parentBreakBefore) {
			doubleBreakBefore =
				(node as Element).dataset.breakBefore ===
				(parentNode as Element).dataset.breakBefore;
		}

		return (
			(!doubleBreakBefore && needsBreakBefore(node)) ||
			needsPreviousBreakAfter(node) ||
			needsPageBreak(node, previousNode as Node)
		);
	}

	forceBreak(): void {
		this.forceRenderBreak = true;
	}

	getStart(
		source: DocumentFragment | Node,
		breakToken?: BreakToken,
	): Node | undefined {
		let start;
		let node = breakToken && breakToken.node;
		let finished = breakToken && breakToken.finished;

		if (node) {
			start = node;
		} else {
			start = source.firstChild;
		}

		return finished ? undefined : start!;
	}

	/**
	 * Merge items from source into dest which don't yet exist in dest.
	 *
	 * @param {element} dest
	 *   A destination DOM node tree.
	 * @param {element} source
	 *   A source DOM node tree.
	 *
	 * @returns {void}
	 */
	addOverflowNodes(dest: HTMLElement, source: Node): void {
		// Since we are modifying source as we go, we need to remember what
		Array.from(source.childNodes).forEach((item) => {
			if (isText(item)) {
				// If we get to a text node, we assume for now an earlier element
				// would have prevented duplication.
				dest.append(item);
			} else {
				let match = findElement(item, dest);
				if (match) {
					this.addOverflowNodes(match as HTMLElement, item);
				} else {
					dest.appendChild(item);
				}
			}
		});
	}

	/**
	 * Add overflow to new page.
	 *
	 * @param {element} dest
	 *   The page content being built.
	 * @param {breakToken} breakToken
	 *   The current break cotent.
	 * @param {element} alreadyRendered
	 *   The content that has already been rendered.
	 *
	 * @returns {void}
	 */
	addOverflowToPage(
		dest: HTMLElement,
		breakToken: BreakToken | undefined,
		alreadyRendered?: DocumentFragment | Node,
	): void {
		if (!dest) {
			console.warn("paged-with-floats: addOverflowToPage called with null dest", new Error().stack);
			return;
		}
		if (!breakToken || !breakToken.overflow.length) {
			return;
		}

		let fragment: DocumentFragment | undefined;

		// Ensure overflow content is rebuilt in source document order, even
		// when residual sweeps appended out-of-order ranges to the token.
		const sortedOverflows = breakToken.overflow.slice().sort((a, b) => {
			if (!a?.node || !b?.node) {
				return 0;
			}
			if (a.node === b.node) {
				return (a.offset || 0) - (b.offset || 0);
			}
			try {
				const pos = a.node.compareDocumentPosition(b.node);
				if (pos & Node.DOCUMENT_POSITION_FOLLOWING) {
					return -1;
				}
				if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
					return 1;
				}
			} catch {
				// compareDocumentPosition can throw for nodes from different
				// documents; leave the original order in that case.
			}
			return 0;
		});

		sortedOverflows.forEach((overflow) => {
			if (!overflow || !overflow.content) {
				return;
			}
			// A handy way to dump the contents of a fragment.
			// console.log([].map.call(overflow.content.children, e => e.outerHTML).join('\n'));

			fragment = rebuildTree(
				overflow.node,
				fragment,
				alreadyRendered as Element | undefined,
			);
			// Find the parent to which overflow.content should be added.
			// Overflow.content can be a much shallower start than
			// overflow.node, if the range end was outside of the range
			// start part of the tree. For this reason, we use a match against
			// the parent element of overflow.content if it exists, or fall back
			// to overflow.node's parent element.
			let addTo = overflow.ancestor
				? findElement(overflow.ancestor, fragment)
				: fragment;
			this.addOverflowNodes(addTo as HTMLElement, overflow.content);
		});

		// Record refs.
		if (!fragment) {
			return;
		}
		Array.from(fragment.querySelectorAll("[data-ref]")).forEach((ref) => {
			let refId = ref.dataset.ref;
			if (!dest.querySelector(`[data-ref='${refId}']`)) {
				let refs = (dest as WithRefs).indexOfRefs;
				if (!refs) {
					refs = {};
					(dest as WithRefs).indexOfRefs = refs;
				}
				refs[refId!] = ref as HTMLElement;
			}
		});

		let tags = [
			"overflow-tagged",
			"overflow-partial",
			"range-start-overflow",
			"range-end-overflow",
		];
		tags.forEach((tag) => {
			let camel = tag
				.replace(/(?:^\w|[A-Z]|\b\w)/g, function (word, index) {
					return index == 0 ? word.toLowerCase() : word.toUpperCase();
				})
				.replace(/[-\s]+/g, "");
			let instances = fragment!.querySelectorAll(`[data-${tag}]`);
			instances.forEach((instance) => {
				delete instance.dataset[camel];
			});
		});

		dest.appendChild(fragment!);

		// Floats can be carried across the break by the overflow path: their
		// source copies are rebuilt here without ever passing through
		// Layout.append, so the renderNode hook (which extracts page floats
		// into the page's float containers) never fires for them. Extract
		// them now, before the fresh page's bounds are measured. Placement
		// marks nodes placed, so re-firing on nested matches is idempotent.
		if (this.hooks && this.hooks.renderNode) {
			Array.from(fragment!.querySelectorAll("[data-page-float]")).forEach(
				(node) => {
					let el = node as HTMLElement;
					if (!el.dataset || el.dataset.pageFloatPlaced) {
						return;
					}
					this.hooks.renderNode!.triggerSync(el, el, this);
				},
			);
		}

		this.hooks && this.hooks.afterOverflowAdded.trigger(dest);
		this.invalidateBounds();
	}

	/**
	 * Add text to new page.
	 *
	 * @param {element} node
	 *   The node being appended to the destination.
	 * @param {element} dest
	 *   The destination to which content is being added.
	 * @param {element} source
	 *   The source DOM
	 * @param {breakToken} breakToken
	 *   The current breakToken.
	 * @param {bool} shallow
	 *	 Whether to do a shallow copy of the node.
	 * @param {bool} rebuild
	 *   Whether to rebuild parents.
	 *
	 * @returns {ChildNode}
	 *   The cloned node.
	 */
	append(
		node: Node,
		dest: HTMLElement,
		source: DocumentFragment | Node,
		breakToken: BreakToken | null | undefined,
		shallow = true,
		rebuild = true,
	): ChildNode {
		let clone = cloneNode(node, !shallow) as ChildNode;

		if (node.parentNode && isElement(node.parentNode)) {
			let parent = findElement(node.parentNode, dest);
			if (parent) {
				replaceOrAppendElement(parent as HTMLElement, clone);
			} else if (rebuild) {
				let fragment = rebuildTree(
					node.parentElement!,
					undefined,
					source as unknown as Element,
				);
				parent = findElement(node.parentNode, fragment);
				replaceOrAppendElement(parent! as HTMLElement, clone);
				dest.appendChild(fragment);
			} else {
				dest.appendChild(clone);
			}
		} else {
			dest.appendChild(clone);
		}

		if ((clone as HTMLElement).dataset && (clone as HTMLElement).dataset.ref) {
			let refs = (dest as WithRefs).indexOfRefs;
			if (!refs) {
				refs = {};
				(dest as WithRefs).indexOfRefs = refs;
			}
			refs[(clone as HTMLElement).dataset.ref!] = clone as HTMLElement;
		}

		let nodeHooks = this.hooks.renderNode.triggerSync(clone, node, this);
		nodeHooks.forEach((newNode) => {
			if (typeof newNode != "undefined") {
				clone = newNode as ChildNode;
			}
		});


		this.invalidateBounds();

		return clone;
	}

	rebuildTableFromBreakToken(
		breakToken: BreakToken | undefined,
		dest: HTMLElement,
		source: DocumentFragment | Node,
	): void {
		if (!breakToken || !breakToken.node) {
			return;
		}
		let node = breakToken.node;
		let td: HTMLTableCellElement | null = isElement(node)
			? (node as Element).closest("td")
			: node.parentElement!.closest("td");
		if (td) {
			let rendered = findElement(td, dest, true);
			if (!rendered) {
				return;
			}
			while ((td = td.nextElementSibling as HTMLTableCellElement | null)) {
				this.append(td, dest, source, null, true);
			}
		}
	}

	async waitForImages(imgs: NodeListOf<HTMLImageElement>): Promise<void> {
		let results = Array.from(imgs).map(async (img) => {
			return this.awaitImageLoaded(img);
		});
		await Promise.all(results);
	}

	async awaitImageLoaded(image: HTMLImageElement): Promise<unknown> {
		return new Promise((resolve) => {
			if (image.complete !== true) {
				image.onload = function () {
					let { width, height } = window.getComputedStyle(image);
					(resolve as (...args: unknown[]) => void)(width, height);
				};
				image.onerror = function (e) {
					let { width, height } = window.getComputedStyle(image);
					(resolve as (...args: unknown[]) => void)(width, height, e);
				};
			} else {
				let { width, height } = window.getComputedStyle(image);
				(resolve as (...args: unknown[]) => void)(width, height);
			}
		});
	}

	avoidBreakInside(node: Node, limiter: Node): Element | undefined {
		let breakNode: Element | undefined;

		while (node.parentNode) {
			if (node === limiter) {
				break;
			}

			if (
				isElement(node) &&
				(node as Element).dataset.originalBreakInside === "avoid"
			) {
				breakNode = node;
				break;
			}

			node = node.parentNode as unknown as Node;
		}
		return breakNode;
	}

	createOverflow(
		overflow: Range,
		rendered: HTMLElement,
		source: DocumentFragment | Node,
	): Overflow | undefined {
		let container = overflow.startContainer;
		let offset = overflow.startOffset;
		let node: Node | null | undefined,
			renderedNode: Element | null | undefined,
			parent: Node | null | undefined,
			index: number | undefined,
			temp: Node | undefined;
		let hyphen = (this.settings.hyphenGlyph as string) || "\u2011";
		let topLevel = false;

		if (isElement(container)) {
			if (container.nodeName == "INPUT") {
				temp = container;
			} else {
				temp = child(container, offset);
			}

			if (isElement(temp)) {
				renderedNode = findElement(temp, rendered);

				if (!renderedNode) {
					// Find closest element with data-ref
					let prevNode: Node | null | undefined = prevValidNode(temp);
					if (prevNode && !isElement(prevNode)) {
						prevNode = prevNode.parentElement;
					}
					if (!prevNode) {
						return;
					}
					renderedNode = findElement(prevNode, rendered);
					if (!renderedNode) {
						return;
					}
					// Check if temp is the last rendered node at its level.
					if (!temp.nextSibling) {
						// We need to ensure that the previous sibling of temp is fully rendered.
						const renderedNodeFromSource = findElement(
							renderedNode,
							source,
						);
						if (!renderedNodeFromSource) {
							return;
						}
						const walker = document.createTreeWalker(
							renderedNodeFromSource,
							NodeFilter.SHOW_ELEMENT,
						);
						const lastChildOfRenderedNodeFromSource = walker.lastChild();
						const lastChildOfRenderedNodeMatchingFromRendered = findElement(
							lastChildOfRenderedNodeFromSource as Node,
							rendered,
						);
						// Check if we found that the last child in source
						if (!lastChildOfRenderedNodeMatchingFromRendered) {
							// Pending content to be rendered before virtual break token
							return;
						}
						// Otherwise we will return a break token as per below
					}
					// renderedNode is actually the last unbroken box that does not overflow.
					// Break Token is therefore the next sibling of renderedNode within source node.
					node = findElement(renderedNode as Node, source)!.nextSibling;
					offset = 0;
				} else {
					node = findElement(renderedNode, source);
					offset = 0;
				}
			} else {
				if (container == rendered) {
					parent = renderedNode = source as unknown as Element;
					topLevel = true;
				} else {
					renderedNode = findElement(container, rendered);

					if (!renderedNode) {
						const prevNode = prevValidNode(container);
						if (!prevNode) {
							return;
						}
						renderedNode = findElement(prevNode, rendered);
					}

					if (!renderedNode) {
						return;
					}
					parent = findElement(renderedNode, source);
				}
				const mapped = indexOfTextNodeForOverflow(
					temp!,
					renderedNode!,
					parent! as Element,
					hyphen,
				);
				index = mapped.index;
				// No seperation for the first textNode of an element
				if (index === 0) {
					node = parent;
					offset = 0;
				} else {
					node = child(parent! as Node, index!);
					offset = 0;
				}
			}
		} else {
			renderedNode = findElement(container.parentNode as Node, rendered);

			if (!renderedNode) {
				const prevNode = prevValidNode(container.parentNode as Node);
				if (!prevNode) {
					return;
				}
				renderedNode = findElement(prevNode, rendered);
			}
			if (!renderedNode) {
				return;
			}
			parent = findElement(renderedNode, source);
			const mapped = indexOfTextNodeForOverflow(
				container,
				renderedNode!,
				parent! as Element,
				hyphen,
			);
			index = mapped.index;

			if (index === -1) {
				// We can't map to a precise text node. Anchor at the parent element
				// so the overflow is carried forward instead of being dropped.
				node = parent;
				offset = 0;
			} else {
				node = child(parent! as Node, index!);

				offset += node!.textContent!.indexOf(container.textContent!);
			}
		}

		if (!node) {
			return;
		}

		return new Overflow(
			node,
			offset,
			overflow.getBoundingClientRect().height,
			overflow,
			topLevel,
		);
	}

	/**
	 * Recursively removes last child and it's ancestors if the nested parentElement is empty
	 *
	 * In case of empty table rows or similar
	 *
	 * @param {Element} parentElement
	 * @param {Element} rootElement
	 */
	lastChildCheck(parentElement: Element, rootElement: WithRefs): void {
		if (parentElement.childElementCount) {
			this.lastChildCheck(parentElement.lastElementChild!, rootElement);
		}

		let refId = parentElement.dataset.ref;

		// A table row, math element or paragraph from which all content has been removed
		// can itself also be removed. It will be added on the next page.
		if (
			parentElement.dataset.overflowTagged &&
			parentElement.textContent.trim() == ""
		) {
			(parentElement.parentNode as Node).removeChild(parentElement);
		} else if (refId && rootElement.indexOfRefs && !rootElement.indexOfRefs[refId]) {
			rootElement.indexOfRefs[refId] = parentElement as HTMLElement;
		}
	}

	/**
	 * Extends an overflow range backward so its tail carries at least one
	 * word of flow text. Only acts when the range's content is empty of
	 * text (whitespace or footnote-call anchors alone — a marker wrapped
	 * past the column edge by itself); walks the block's text nodes in
	 * reverse document order until the tail covers a real word (two word
	 * characters — a trailing "." alone does not count) and moves the
	 * range start to that word's beginning.
	 *
	 * @param {Range} range - The overflow range to adjust in place.
	 * @returns {void}
	 */
	extendOverflowToWord(range: Range): void {
		if (range.toString().trim()) {
			return;
		}

		const wordRe = /(\S+)\s*$/;
		const wordChars = (s: string) => s.replace(/[^\w]/g, "").length;
		let root: Node = range.commonAncestorContainer;
		if (isText(root)) {
			root = root.parentNode as Node;
		}
		if (!root) {
			return;
		}

		const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		let current: Node | null = range.startContainer;
		let currentOffset = range.startOffset;

		// Position the walker at the node preceding the range start: the
		// start container itself is the walker root's boundary when the
		// range begins at it, and previousNode() would return nothing.
		if (!isText(current)) {
			const prev = current.childNodes[currentOffset - 1];
			if (!prev) {
				return;
			}
			current = prev;
			currentOffset = Number.MAX_SAFE_INTEGER;
		}
		walker.currentNode = current;

		let tailWordChars = 0;
		let hops = 0;

		while (current && hops < 60) {
			hops++;
			if (isText(current)) {
				if (
					(current.parentElement as HTMLElement | null)?.dataset
						.note === "footnote"
				) {
					current = walker.previousNode();
					continue;
				}
				const before = current.data.slice(0, currentOffset);
				const match = wordRe.exec(before);
				if (match && wordChars(match[1]) + tailWordChars >= 2) {
					range.setStart(
						current,
						match.index + match[0].length - match[1].length,
					);
					return;
				}
				tailWordChars += match ? wordChars(match[1]) : 0;
			}
			current = walker.previousNode();
			currentOffset = Number.MAX_SAFE_INTEGER;
		}
	}

	/**
	 * Converts overflowresults into a Breaktoken objects
	 *
	 * Proccesses overflow result
	 *
	 * -> Called only from findBreakToken
	 *
	 * @param {List} overflow - overflow ranges
	 * @param {Element} rendered - page content div
	 */
	processOverflowResult(
		ranges: Range[],
		rendered: HTMLElement,
		source: DocumentFragment | Node,
		bounds: DOMRect,
		prevBreakToken: BreakToken | undefined,
		node: Node | null,
		extract?: boolean,
	): BreakToken {
		let breakToken: BreakToken | undefined,
			breakLetter: string | undefined;

		ranges.forEach((overflowRange) => {
			let overflowHooks = this.hooks.onOverflow.triggerSync(
				overflowRange,
				rendered,
				bounds,
				this,
			);
			overflowHooks.forEach((newOverflow) => {
				if (typeof newOverflow != "undefined") {
					overflowRange = newOverflow as Range;
				}
			});

			// A continuation fragment must carry at least one word of
			// content: when the overflow range holds only a footnote-call
			// anchor (the marker wrapped past the column edge on its own),
			// extend it backward over the last word of the kept text so the
			// call is not orphaned on the next page.
			this.extendOverflowToWord(overflowRange);

			let overflow = this.createOverflow(overflowRange, rendered, source);
			if (!overflow) {
				// The rendered range could not be mapped back to the source
				// (e.g. its nodes were detached during a residual sweep);
				// skip it rather than crash on a null break token.
				return;
			}
			if (!breakToken) {
				breakToken = new BreakToken(node!, [overflow]);
			} else {
				breakToken.overflow.push(overflow);
			}

			// breakToken is nullable
			let breakHooks = this.hooks.onBreakToken.triggerSync(
				breakToken,
				overflowRange,
				rendered,
				this,
			);
			breakHooks.forEach((newToken) => {
				if (typeof newToken != "undefined") {
					breakToken = newToken as BreakToken;
				}
			});

			// Stop removal if we are in a loop
			if (breakToken.equals(prevBreakToken as BreakToken)) {
				return;
			}

			if (overflow?.node && overflow?.offset && overflow?.node?.textContent) {
				breakLetter = overflow.node.textContent!.charAt(overflow.offset);
			} else {
				breakLetter = undefined;
			}

			if (overflow?.node && extract) {
				overflow.ancestor = findElement(
					overflow.range!.commonAncestorContainer,
					source,
				);
				overflow.content = this.removeOverflow(overflowRange, breakLetter);
			}
		});

		// For each overflow that is removed, see if we have an empty td that can be removed.
		// Also check that the data-ref is set so we get all the split-froms and tos. If a copy
		// of a node wasn't shallow, the indexOfRefs entry won't be there yet.
		ranges.forEach((overflowRange) => {
			this.lastChildCheck(rendered, rendered);
		});

		// And then see if the last element has been completely removed and not split.
		if (
			(rendered as WithRefs).indexOfRefs &&
			extract &&
			breakToken &&
			breakToken.overflow.length
		) {
			let firstOverflow = breakToken.overflow[0];
			if (firstOverflow?.node && firstOverflow.content) {
				// Remove data-refs in the overflow from the index.
				Array.from(
					firstOverflow.content.querySelectorAll("[data-ref]"),
				).forEach((ref) => {
					let refId = ref.dataset.ref;
					if (!rendered.querySelector(`[data-ref='${refId}']`)) {
						delete (rendered as WithRefs).indexOfRefs![refId!];
					}
				});
			}
		}

		if (breakToken) {
			breakToken.overflow.forEach((overflow) => {
				this.hooks &&
					this.hooks.afterOverflowRemoved.trigger(
						overflow.content,
						rendered,
						this,
					);
			});
		}

		return breakToken as BreakToken;
	}

	/**
	 * Determines overflow of this layout and convert that into a breaktoken
	 * -> Called by Layout.renderTo
	 *
	 * @param {Element} rendered - page content
	 * @param {HTML} source - Source content
	 * @param {DOMRect} bounds - Bounding rect
	 * @param {BreakToken} prevBreakToken - previous BreakToken
	 * @param {Element} node - Start node of the breakContent
	 * @param {*} extract
	 * @returns {BreakToken}
	 */
	findBreakToken(
		rendered: HTMLElement,
		source: DocumentFragment | Node,
		bounds: DOMRect = this.bounds,
		prevBreakToken?: BreakToken,
		node: Node | null = null,
		extract = true,
	): BreakToken | undefined {
		let breakToken: BreakToken | undefined,
			overflow: Range[] = [];

		let overflowResult = this.findOverflow(rendered, bounds, source);
		let findOverflowGuard = 0;
		while (overflowResult) {
			if (++findOverflowGuard > 100) {
				console.error(
					"paged-with-floats: overflow collection guard exceeded; bailing out.",
				);
				break;
			}
			const result = overflowResult;
			// Check whether overflow already added - multiple overflows might result in the
			// same range via avoid break rules.
			let existing = false;
			overflow.forEach((item) => {
				if (
					item.startContainer == result.startContainer &&
					item.endContainer == result.endContainer
				) {
					if (
						item.startOffset >= result.startOffset &&
						item.endOffset <= result.endOffset
					) {
						item.setStart(
							result.startContainer,
							result.startOffset,
						);
						existing = true;
					}
					if (
						item.endOffset > result.endOffset &&
						item.startOffset == result.startOffset
					) {
						(item as any).EndOffset = (result as any).EndOffset;
						item.setEnd(result.endContainer, result.endOffset);
						existing = true;
					}
				}
			});
			if (!existing) {
				overflow.push(result);
			}
			overflowResult = this.findOverflow(rendered, bounds, source);
		}

		if (overflow.length) {
			breakToken = this.processOverflowResult(
				overflow,
				rendered,
				source,
				bounds,
				prevBreakToken,
				node,
				extract,
			);

			if (breakToken && extract) {
				this.extractResidualOverflow(
					rendered,
					bounds,
					source,
					breakToken,
					prevBreakToken,
				);
			}
		}
		return breakToken;
	}

	/**
	 * Re-sweeps the page for overflow created by the extraction itself.
	 *
	 * Removing the overflowing tail of a paragraph changes how the kept
	 * remainder wraps: hyphenation and justification of the partial
	 * paragraph differ from the measured whole, so its tail can slip into
	 * the spill column *after* the primary range collection finished. The
	 * `data-overflow-tagged` marker — which deliberately suppresses
	 * re-detection while a pass collects ranges — would hide that fresh
	 * overflow, leaving text visibly stranded in the hidden column (a
	 * "third column" the engine already decided to overflow). The marker is
	 * cleared before each sweep pass and any residue is folded into the
	 * existing break token, so the next page rebuilds it in document order.
	 *
	 * @param {HTMLElement} rendered - The page content wrapper.
	 * @param {DOMRect} bounds - The page bounds.
	 * @param {DocumentFragment|Node} source - The source content.
	 * @param {BreakToken} breakToken - The token the residue appends to.
	 * @param {BreakToken|undefined} prevBreakToken - The page's incoming
	 * token, used as the loop guard by processOverflowResult.
	 * @returns {void}
	 */
	private extractResidualOverflow(
		rendered: HTMLElement,
		bounds: DOMRect,
		source: DocumentFragment | Node,
		breakToken: BreakToken,
		prevBreakToken: BreakToken | undefined,
	): void {
		let guard = 0;
		// Extraction may have removed the container itself (e.g. an emptied
		// paragraph that is then dropped); nothing left to sweep.
		if (!rendered.isConnected) {
			return;
		}
		this.inResidualSweep = true;
		while (this.hasOverflow(rendered, bounds)) {
			if (++guard > 10) {
				console.warn(
					"paged-with-floats: stopped re-extracting residual overflow on a page (guard limit)",
				);
				break;
			}

			// Make freshly re-wrapped content visible to detection again.
			rendered
				.querySelectorAll("[data-overflow-tagged]")
				.forEach((el) => el.removeAttribute("data-overflow-tagged"));
			rendered.removeAttribute("data-overflow-tagged");

			try {
				const range = this.findOverflow(rendered, bounds, source);
				if (!range) {
					break;
				}

				const residualToken = this.processOverflowResult(
					[range],
					rendered,
					source,
					bounds,
					prevBreakToken,
					breakToken.node as unknown as Node,
					true,
				);
				if (residualToken && residualToken.overflow.length) {
					breakToken.overflow.push(...residualToken.overflow);
				} else {
					// No progress (loop guard inside processOverflowResult
					// bailed); stop rather than spin.
					break;
				}
			} catch (error) {
				// A degenerate page state must never abort pagination over a
				// best-effort residual sweep; log and move on.
				console.warn(
					"paged-with-floats: residual overflow sweep failed: " +
						(error instanceof Error ? error.message : String(error)),
				);
				break;
			}
		}
		this.inResidualSweep = false;
	}

	/**
	 * Sweeps every manual column of a page for overflow that appeared after
	 * the page's last overflow check — for example the footnote area growing
	 * and shrinking the flow host below already-laid-out text, or a split
	 * paragraph re-wrapping slightly taller after its footnotes were pulled
	 * out. Any residue found is folded into the outgoing break token so the
	 * next page rebuilds it in document order.
	 *
	 * @param {HTMLElement} wrapper - The page's flow host (`.paged_flow`).
	 * @param {DocumentFragment|Node} source - The source content.
	 * @param {BreakToken} breakToken - The outgoing break token.
	 * @param {BreakToken|undefined} prevBreakToken - The page's incoming token.
	 * @returns {void}
	 */
	private sweepResidualColumnOverflow(
		wrapper: HTMLElement,
		source: DocumentFragment | Node,
		breakToken: BreakToken,
		prevBreakToken: BreakToken | undefined,
	): void {
		const previousEarliest = this.earliestOverflowNode(breakToken.overflow);

		const pageColumns = wrapper.querySelectorAll(
			":scope > .paged_columns > .paged_column",
		);
		for (const col of Array.from(pageColumns)) {
			const column = col as HTMLElement;
			const columnBounds = this.manualColumnBounds(column);
			const spill = column.scrollHeight - column.clientHeight;
			// The walk's break verification accepts a final line whose box
			// ends inside its parent's bottom margin zone (up to the chain's
			// bottom margin/padding/border, see textBreak's parentAdditions).
			// The sweep must grant the same allowance, or it re-extracts
			// content the walk legitimately placed — splitting a paragraph
			// one line above its real break and desynchronizing the page.
			const slack = this.trailingBottomSlack(column);
			if (
				spill - slack > OVERFLOW_TOLERANCE &&
				this.hasOverflow(column, columnBounds)
			) {
				this.extractResidualOverflow(
					column,
					columnBounds,
					source,
					breakToken,
					prevBreakToken,
				);
			}
		}

		// If the residual sweep pushed the break point earlier in the source,
		// any blocks laid out after the new earliest point are now out of order
		// on this page. Move them to the outgoing token and rewind to the new
		// start so the next page renders everything in document order.
		//
		// This coalesce only makes sense when the residual overflow was caused
		// by the footnote area growing mid-layout (which shrinks the flow host
		// *below* content that is already laid out). On footnote-free pages the
		// residual sweep still reports sub-pixel/shrunk-segment spills, and
		// rewinding the whole page for those empties columns and drops content
		// (Moby/Frankenstein regression). Gate the rewind on an actual,
		// non-empty footnote area.
		const newEarliest = this.earliestOverflowNode(breakToken.overflow);
		if (newEarliest && newEarliest !== previousEarliest) {
			const pageEl = wrapper.closest(".paged_page");
			const footnoteArea = pageEl?.querySelector<HTMLElement>(
				".paged_footnote_area",
			);
			const hasFootnotes =
				!!footnoteArea && !!(footnoteArea.textContent || "").trim();
			if (hasFootnotes) {
				this.coalesceResidualOverflow(wrapper, source, breakToken);
			}
		}
	}

	/**
	 * Returns the source node with the earliest document position among a set
	 * of overflow entries, or undefined if the set is empty.
	 */
	private earliestOverflowNode(
		overflows: Overflow[] | undefined,
	): Node | undefined {
		if (!overflows || !overflows.length) {
			return;
		}
		let earliest: Node | undefined;
		for (const overflow of overflows) {
			if (!overflow?.node) {
				continue;
			}
			if (!earliest) {
				earliest = overflow.node;
				continue;
			}
			try {
				const pos = earliest.compareDocumentPosition(overflow.node);
				if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
					earliest = overflow.node;
				}
			} catch {
				// ignore
			}
		}
		return earliest;
	}

	/**
	 * When a residual sweep discovers overflow earlier than the break token's
	 * existing overflow entries, any rendered blocks that follow that earliest
	 * point in source order are still on the page out of order. Extract them
	 * as separate overflows so the next page lays them out after the residual
	 * content.
	 *
	 * @param {HTMLElement} wrapper - The page's flow host (`.paged_flow`).
	 * @param {DocumentFragment|Node} source - The source content.
	 * @param {BreakToken} breakToken - The outgoing break token.
	 */
	private coalesceResidualOverflow(
		wrapper: HTMLElement,
		source: DocumentFragment | Node,
		breakToken: BreakToken,
	): void {
		if (!breakToken || !breakToken.overflow.length) {
			return;
		}

		let earliest: Node | undefined;
		for (const overflow of breakToken.overflow) {
			if (!overflow?.node) {
				continue;
			}
			if (!earliest) {
				earliest = overflow.node;
				continue;
			}
			try {
				const pos = earliest.compareDocumentPosition(overflow.node);
				if (pos & Node.DOCUMENT_POSITION_PRECEDING) {
					earliest = overflow.node;
				}
			} catch {
				// ignore cross-document comparisons
			}
		}
		if (!earliest) {
			return;
		}

		const blocks = Array.from(
			wrapper.querySelectorAll(
				":scope > .paged_columns > .paged_column > *, :scope > :not(.paged_float_top):not(.paged_float_bottom):not(.paged_float_spacer):not(.paged_columns)",
			),
		);

		const removed = document.createDocumentFragment();

		// The block containing the earliest overflow point is kept (its
		// residual is already recorded). Any *later rendered fragment* of the
		// same source element — its split continuation in a following column
		// — must move as well, or it stays behind on this page while the
		// extracted middle renders on the next one, breaking document order.
		let keptSource: Element | undefined;

		for (const block of blocks) {
			if (
				block.classList.contains("paged_float_top") ||
				block.classList.contains("paged_float_bottom") ||
				block.classList.contains("paged_float_spacer") ||
				block.classList.contains("paged_columns")
			) {
				continue;
			}
			const ref = (block as HTMLElement).dataset?.ref;
			if (!ref) {
				continue;
			}
			const sourceEl = findElement(block, source);
			if (!sourceEl) {
				continue;
			}
			// Keep the first rendered fragment of the element containing the
			// earliest overflow point; it is the one being split and its
			// residual overflow is already recorded.
			if (!keptSource && sourceEl.contains(earliest)) {
				keptSource = sourceEl;
				continue;
			}
			let isAfter: boolean;
			if (keptSource && sourceEl === keptSource) {
				isAfter = true;
			} else {
				try {
					const pos = earliest.compareDocumentPosition(sourceEl);
					isAfter = (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
				} catch {
					continue;
				}
			}
			if (!isAfter) {
				continue;
			}

			const range = document.createRange();
			range.selectNode(block);
			const overflow = this.createOverflow(range, wrapper, source);
			if (overflow) {
				const fragment = this.removeOverflow(range);
				overflow.content = fragment;
				overflow.ancestor =
					findElement(range.commonAncestorContainer, source) || undefined;
				breakToken.overflow.push(overflow);
				// Clone for the hook: appending the original would empty the
				// fragment that `overflow.content` still references.
				removed.appendChild(fragment.cloneNode(true));
			} else {
				// Fallback: move the block without a precise source mapping.
				block.remove();
				const fragment = document.createDocumentFragment();
				Array.from(block.childNodes).forEach((child) => {
					fragment.appendChild(child.cloneNode(true));
				});
				const fallback = new Overflow(sourceEl, 0, 0, undefined, true);
				fallback.content = fragment;
				removed.appendChild(fragment.cloneNode(true));
				breakToken.overflow.push(fallback);
			}
		}

		if (removed.childNodes.length) {
			this.hooks &&
				this.hooks.afterOverflowRemoved.trigger(removed, wrapper, this);
		}

		// The removed blocks are carried to the next page by the overflow
		// entries just pushed (with their precise `node`/`offset`/`ancestor`/
		// `content` anchors); `addOverflowToPage` rebuilds them in source order.
		// The token's main break point stays untouched, so the walk resumes
		// after the last moved block instead of re-rendering the split block
		// already kept on this page (which duplicated content and emptied the
		// next column).
	}

	/**
	 * Does the element exceed the bounds?
	 *
	 * @param {element} element
	 *   The element being constrained.
	 * @param {array} bounds
	 *   The bounding element.
	 *
	 * @returns {bool}
	 *   Whether the element is within bounds.
	 */
	hasOverflow(element: HTMLElement, bounds: DOMRect = this.bounds): boolean {
		let constrainingElement = element && (element.parentNode as Element); // this gets the element, instead of the wrapper for the width workaround
		const isManualColumn =
			constrainingElement &&
			(constrainingElement as Element).classList &&
			(constrainingElement as Element).classList.contains("paged_columns");
		if (
			constrainingElement &&
			(constrainingElement as Element).classList &&
			((constrainingElement as Element).classList.contains("paged_page_content") ||
				// A manual column's content overflow does not grow the flex
				// row it sits in; measure the column box itself.
				isManualColumn)
		) {
			constrainingElement = element;
		}
		let { width, height } = element.getBoundingClientRect();
		let scrollWidth = constrainingElement ? constrainingElement.scrollWidth : 0;
		let scrollHeight = constrainingElement
			? constrainingElement.scrollHeight
			: 0;
		if (
			Math.max(Math.ceil(width), scrollWidth) > Math.ceil(bounds.width) ||
			Math.max(Math.ceil(height), scrollHeight) > Math.ceil(bounds.height)
		) {
			return true;
		}
		// Manual columns are positioned below any top page floats, so their
		// box can grow past the flow host's bottom edge while their height is
		// still smaller than the host's height. Detect that by comparing the
		// column's bottom edge to the host's bottom edge.

		// Multicol blocks fragment internally: their spill-over lands in a
		// hidden extra column (scrollWidth) or beyond a constrained height
		// (scrollHeight) without growing the wrapper itself.
		for (const frag of this.fragmentainers) {
			if (frag === element || frag === constrainingElement) {
				continue;
			}
			const fragBounds = frag.getBoundingClientRect();
			if (
				frag.scrollWidth >
					Math.ceil(fragBounds.width) + COLUMN_EPSILON ||
				frag.scrollHeight >
					Math.ceil(fragBounds.height) + COLUMN_EPSILON
			) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Sums padding, borders and margins for bottom/right of parent elements.
	 *
	 * Assumes no margin collapsing because we're considering overflow
	 * on a page.
	 *
	 * This and callers need to be extended to handle right-to-left text and
	 * flow but I'll get LTR going first in the hope that it will simplify
	 * the task of getting RTL sorted later. Need test cases too.
	 */
	getAncestorPaddingBorderAndMarginSums(
		element?: Element | null,
		stopAtFragmentainer = false,
	): Record<string, number> {
		let attribs = [
			"padding-top",
			"padding-right",
			"padding-bottom",
			"padding-left",
			"border-top-width",
			"border-right-width",
			"border-bottom-width",
			"border-left-width",
			"margin-top",
			"margin-right",
			"margin-bottom",
			"margin-left",
		];
		let result: Record<string, number> = {};
		attribs.forEach((attrib) => (result[attrib] = 0));

		while (
			element &&
			!element.classList.contains("paged_page_content") &&
			!element.classList.contains("paged_footnote_inner_content")
		) {
			if (
				stopAtFragmentainer &&
				this.fragmentainers.has(element) &&
				element !== this.element
			) {
				break;
			}
			let style = window.getComputedStyle(element);
			attribs.forEach(
				(attrib) =>
					(result[attrib] += parseInt(style.getPropertyValue(attrib))),
			);
			element = element.parentElement;
		}

		return result;
	}

	/**
	 * Checks whether an element is within a table and gets any THEAD sizes.
	 */
	getAncestorTheadSizes(element?: Element | null): number {
		let result = 0;

		while (
			element &&
			!element.classList.contains("paged_page_content") &&
			!element.classList.contains("paged_footnote_inner_content")
		) {
			if (element.tagName == "TABLE") {
				element.childNodes.forEach((node) => {
					if ((node as Element).tagName == "THEAD") {
						let style = getComputedStyle(node as Element);
						result += parseInt(style.height);
					}
				});
			}
			element = element.parentElement;
		}

		return result;
	}

	/**
	 * Adds temporary data-split-to/from attribute where needed.
	 *
	 * @param DomElement element
	 *   The deepest child, from which to start.
	 */
	addTemporarySplit(element?: Element | null, isTo = true): void {
		this.temporaryIndex++;
		let name = isTo ? "data-split-to" : "data-split-from";
		while (
			element &&
			!element.classList.contains("paged_page_content") &&
			!element.classList.contains("paged_footnote_inner_content")
		) {
			if (!element.getAttribute(name)) {
				element.setAttribute(name, "temp-" + this.temporaryIndex);
			}

			element = element.parentElement;
		}
		this.invalidateBounds();
	}

	/**
	 * Removes temporary data-split-to/from attribute where added.
	 *
	 * @param DomElement element
	 *   The deepest child, from which to start.
	 * @param boolean isTo
	 *   Whether a split-to or -from was added.
	 */
	deleteTemporarySplit(element?: Element | null, isTo = true): void {
		let name = isTo ? "data-split-to" : "data-split-from";
		while (
			element &&
			!element.classList.contains("paged_page_content") &&
			!element.classList.contains("paged_footnote_inner_content")
		) {
			let value = element.getAttribute(name);
			if (value == "temp-" + this.temporaryIndex) {
				element.removeAttribute(name);
			}

			element = element.parentElement;
		}
		this.invalidateBounds();
	}

	/**
	 * Client rects for any node: elements and ranges directly, text nodes
	 * via a range around their contents.
	 */
	nodeClientRects(node: Node): DOMRectList | undefined {
		if (node instanceof Element || node instanceof Range) {
			return getClientRects(node);
		}
		const range = document.createRange();
		range.selectNodeContents(node);
		return range.getClientRects();
	}

	/**
	 * Returns the first child that overflows the bounds.
	 *
	 * There may be no children that overflow (the height might be extended
	 * by a sibling). In this case, this function returns NULL.
	 *
	 * @param {node} node
	 *   The parent node of the children we are searching.
	 * @param {array} bounds
	 *   The bounds of the page area.
	 * @returns {ChildNode | null | undefined}
	 *   The first overflowing child within the node.
	 */
	firstOverflowingChild(
		node: Node,
		bounds: DOMRect,
	): ChildNode | null | undefined {
		let bLeft = Math.ceil(bounds.left);
		let bRight = Math.floor(bounds.right);
		let bTop = Math.ceil(bounds.top);
		let bBottom = Math.floor(bounds.bottom);
		let result: ChildNode | null | undefined = undefined;
		let skipRange = false;
		let parentBottomPaddingBorder = 0,
				parentBottomMargin = 0;
		const nodeFrag = this.getFragmentainer(node);

		if (isElement(node)) {
			let result = this.getAncestorPaddingBorderAndMarginSums(node);
			parentBottomPaddingBorder = result["border-bottom-width"];
			parentBottomMargin = result["margin-bottom"];
		}

		for (const child of node.childNodes) {
			if ((child as Element).tagName == "COLGROUP") {
				continue;
			}

			let pos = getBoundingClientRect(child as Element)!;
			let bottomMargin = 0;

			let hasStart = false;
			let hasEnd = false;

			if (isElement(child)) {
				let styles = window.getComputedStyle(child);

				bottomMargin = parseInt(styles.getPropertyValue("margin-bottom"));

				hasStart =
					(child as Element).dataset.rangeStartOverflow !== undefined;
				hasEnd =
					(child as Element).dataset.rangeEndOverflow !== undefined;

				if (this.inResidualSweep) {
					// During the residual sweep the bounds may have shrunk after
					// the tags were written, so an element that carries a range
					// marker can still overflow. Let the normal overflow check
					// run for this child, but keep skipping true siblings that
					// sit between a separate start/end pair.
					if (hasStart && hasEnd) {
						// collapsed range on this element: treat normally.
					} else if (hasEnd) {
						skipRange = false;
						result = undefined;
						continue;
					} else if (hasStart) {
						skipRange = true;
						result = null;
					}
				} else {
					// Normal overflow collection: range markers delimit content
					// already assigned to an overflow range.
					if (hasStart) {
						skipRange = true;
						result = null;
					}
					if (hasEnd) {
						skipRange = false;
						result = undefined;
						continue;
					}
				}

				if ((child as Element).dataset.overflowTagged !== undefined) {
					continue;
				}

				// A child that is itself a fragmentainer overflows when its
				// internal content spills past its own columns or capped
				// height; its box alone never shows this.
				if (this.fragmentainers.has(child)) {
					const cb = this.fragmentainerBox(child);
					if (
						child.scrollWidth >
							Math.ceil(cb.right - cb.left) + COLUMN_EPSILON ||
						child.scrollHeight >
							Math.ceil(cb.bottom - cb.top) + COLUMN_EPSILON
					) {
						return child;
					}
					continue;
				}
			} else {
				bottomMargin = parentBottomMargin;
			}

			if (this.inResidualSweep) {
				if (skipRange && !hasStart) {
					continue;
				}
			} else if (skipRange) {
				continue;
			}

			let left = Math.ceil(pos.left);
			let right = Math.floor(pos.right);
			let top = Math.ceil(pos.top);
			let bottom = Math.floor(
				pos.bottom +
					bottomMargin +
					(node.lastChild == child ? parentBottomPaddingBorder : 0),
			);

			if (!(pos.height + bottomMargin)) {
				continue;
			}

			if (nodeFrag) {
				// Fragmentainer-relative check over every client rect, since
				// children fragmented across columns report union boxes.
				const childAdditions =
					bottomMargin +
					(node.lastChild == child ? parentBottomPaddingBorder : 0);
				const rects = this.nodeClientRects(child);
				let overflows = false;
				if (rects && rects.length) {
					for (const fragment of Array.from(rects)) {
						if (
							this.rectOverflows(
								fragment,
								childAdditions,
								nodeFrag,
								bounds,
							)
						) {
							overflows = true;
							break;
						}
					}
				} else {
					overflows = this.rectOverflows(
						pos,
						childAdditions,
						nodeFrag,
						bounds,
					);
				}
				if (overflows) {
					return child;
				}
				continue;
			}

			if (left < bLeft || right > bRight || top < bTop || bottom > bBottom) {
				return child;
			}
		}

		return result;
	}

	removeHeightConstraint(element: Element): void {
		// Inside a multicol block, the constraint is the fragmentainer's
		// explicit height, not the pagebox height variable.
		const frag = this.getFragmentainer(element);
		if (frag && frag !== this.element) {
			this.savedFragmentainerHeights.set(
				frag,
				(frag as HTMLElement).style.height,
			);
			(frag as HTMLElement).style.height = "auto";
			this.addTemporarySplit(element.parentElement, false);
			return;
		}

		let pageBox = element.parentElement!.closest(
			".paged_page",
		) as HTMLElement;
		pageBox.style.setProperty("--paged-pagebox-height", "5000px");
		this.addTemporarySplit(element.parentElement, false);
		this.invalidateBounds();
	}

	restoreHeightConstraint(element: Element): void {
		const frag = this.getFragmentainer(element);
		if (frag && frag !== this.element) {
			const saved = this.savedFragmentainerHeights.get(frag);
			(frag as HTMLElement).style.height = saved ?? "";
			this.savedFragmentainerHeights.delete(frag);
			this.deleteTemporarySplit(element.parentElement, false);
			return;
		}

		let pageBox = element.parentElement!.closest(
			".paged_page",
		) as HTMLElement;
		this.deleteTemporarySplit(element.parentElement, false);
		pageBox.style.removeProperty("--paged-pagebox-height");
		this.invalidateBounds();
	}

	getUnconstrainedElementHeight(
		element: Element,
		includeAncestors = true,
		includeTableHead = true,
	): number {
		this.removeHeightConstraint(element);
		let unconstrainedHeight = getBoundingClientRect(element)!.height;
		if (includeAncestors) {
			let extra = this.getAncestorPaddingBorderAndMarginSums(
				element.parentElement,
			);
			["top", "bottom"].forEach((direction) => {
				unconstrainedHeight +=
					extra[`padding-${direction}`] +
					extra[`border-${direction}-width`] +
					extra[`margin-${direction}`];
			});
		}
		if (includeTableHead) {
			unconstrainedHeight += this.getAncestorTheadSizes(element.parentElement);
		}
		this.restoreHeightConstraint(element);
		return unconstrainedHeight;
	}

	getRange(rangeStart: Node, offset: number, rangeEnd?: Node): Range {
		let range = document.createRange();
		if (isText(rangeStart)) {
			range.setStart(rangeStart, offset);
		} else {
			range.selectNode(rangeStart);
		}

		// Additional nodes may have been added that will overflow further beyond
		// node. Include them in the range.
		rangeEnd = rangeEnd || rangeStart;
		range.setEndAfter(rangeEnd);
		return range;
	}

	startOfNewOverflow(
		startNode: Node,
		rendered: HTMLElement,
		bounds: DOMRect,
	): [ChildNode | null | undefined, boolean] {
		let node = startNode as ChildNode | null | undefined;
		let childNode: ChildNode | null | undefined,
			done = false;
		let prev: ChildNode | null | undefined;
		let anyOverflowFound = false;
		let topNode: Node = startNode;

		do {
			prev = node;
			do {
				let parentBottomPaddingBorder: number,
					parentBottomMargin: number;
				childNode = this.firstOverflowingChild(node!, bounds);
				if (childNode) {
					anyOverflowFound = true;
				} else if (childNode === undefined) {
					// The overflow isn't caused by children. It could be caused by:
					// * a sibling div / td / element with height that stretches this
					//   element
					// * margin / padding on this element
					// In the former case, we want to ignore this node and take the
					// sibling. In the later case, we want to move this node.
					let intrinsicBottom = 0,
							intrinsicRight = 0;
					let childBounds = getBoundingClientRect(node as Element)!;
					if (isElement(node)) {
						// Assume that any height is the result of matching the
						// height of surrounding content if there's no content.
						let result = this.getAncestorPaddingBorderAndMarginSums(
							node as Element,
						);
						parentBottomPaddingBorder =
							result["border-bottom-width"] + result["padding-bottom"];
						parentBottomMargin = result["margin-bottom"];

						if (node.childNodes.length) {
							let lastChild = node.lastChild;
							if (
								(isText(lastChild) &&
									!(node as Element).dataset.overflowTagged) ||
								(!isText(lastChild) &&
									!(lastChild as Element).dataset.overflowTagged)
							) {
								childBounds = getBoundingClientRect(lastChild as Element)!;
								intrinsicRight = childBounds.right;
								intrinsicBottom = childBounds.bottom;
							}
						} else {
							// Do we count this node even though it has no children?
							// Seems to only be needed for BR.
							if (node instanceof HTMLBRElement) {
								intrinsicRight = childBounds.right;
								intrinsicBottom = childBounds.bottom;
							}
						}
					} else {
						intrinsicRight = childBounds.right;
						intrinsicBottom = childBounds.bottom;

						let result = this.getAncestorPaddingBorderAndMarginSums(
							node!.parentElement,
						);
						parentBottomPaddingBorder = result["border-bottom-width"];
						parentBottomMargin = result["margin-bottom"];
					}
					intrinsicBottom += parentBottomPaddingBorder + parentBottomMargin;
					const intrinsicRect = new DOMRect(
						intrinsicRight,
						intrinsicBottom,
						0,
						0,
					);
					if (
						!this.rectOverflows(
							intrinsicRect,
							0,
							this.getFragmentainer(node!),
							bounds,
						)
					) {
					let ascended: boolean;
					do {
						ascended = false;
						do {
							node = node
								? (node as Element).nextElementSibling
								: null;
						} while (node && (node as Element).dataset.overflowTagged);
						if (!node && rendered !== prev) {
							ascended = true;
							prev = node = prev!.parentElement;
						}
					} while (ascended && node && node !== topNode);
					if (!node || node == topNode) {
						return [null, false];
					}
					} else {
						// Node is causing the overflow via padding and margin or text content.
						done = true;
					}
				} else {
					// childNode is null. Overflowing children have been ignored and no other
					// overflowing children were found. Check the node's next sibling or one of
					// an ancestor.
					do {
						while (node && !(node as Element).nextElementSibling) {
							if (node == rendered) {
								return [null, false];
							}
							node = node!.parentElement;
						}
						if (!node) {
							return [null, false];
						}
						do {
							node = node
								? (node as Element).nextElementSibling
								: null;
						} while (
							node &&
							(node as Element).nextElementSibling &&
							(node as Element).dataset.overflowTagged
						);
					} while (node && (node as Element).dataset.overflowTagged);
				}
			} while (node && !childNode && !done);

			if (node) {
				node = childNode;
			}
		} while (node && !done);

		return [prev, anyOverflowFound];
	}

	/**
	 * Tagging elements and returns range of overflowing elements
	 *
	 * @param {Element} startOfOverflow - Start element of the overflow
	 * @param {Node} rangeStart
	 * @param {Node} rangeEnd
	 * @param {DOMRect} bounds - page bounds
	 * @param {Element} rendered - Current rendered page content
	 * @returns
	 */
	tagAndCreateOverflowRange(
		startOfOverflow: Node,
		rangeStart: Node,
		rangeEnd?: Node,
		bounds?: DOMRect,
		rendered?: HTMLElement,
	): Range | undefined {
		let offset: number | undefined = 0;

		// Within a multicol block, text breaking is relative to the
		// fragmentainer's own box rather than the page.
		const rangeFrag = this.getFragmentainer(rangeStart);
		const box = rangeFrag ? this.fragmentainerBox(rangeFrag) : bounds!;
		let start = box.left;
		let end = box.right;
		let vStart = box.top;
		let vEnd = box.bottom;
		let range: Range | undefined;

		if (isText(rangeStart) && rangeStart.textContent!.trim().length) {
			offset = this.textBreak(rangeStart, start, end, vStart, vEnd);
			if (offset === undefined) {
				// Adding split-to changed the CSS and meant we don't need to
				// split this node.
				let next: Node | null = rangeStart;
				while (!(next as Element).nextElementSibling) {
					next = next!.parentElement;
					if (next == rendered) {
						return;
					}
				}
				startOfOverflow = rangeStart = (next as Element)
					.nextElementSibling!;
			}
		}

		let previousElement = nodeBefore(rangeStart, rendered, true);
		let shouldContinue = true;
		let newRangeStart = rangeStart;
		while (
			!offset &&
			previousElement &&
			shouldContinue &&
			((isText(newRangeStart) &&
				(newRangeStart.parentElement!.dataset.previousBreakAfter == "avoid" ||
					newRangeStart.parentElement!.dataset.breakBefore == "avoid")) ||
				(!isText(newRangeStart) &&
					((newRangeStart as Element).dataset.previousBreakAfter == "avoid" ||
						(newRangeStart as Element).dataset.breakBefore == "avoid")))
		) {
			// We are trying to avoid putting a break at newRangeStart.
			// See if we can move some of the content above into the overflow.
			let newPreviousElement = nodeBefore(previousElement, rendered, true);
			// Don't go back into stuff already rendered.
			if (
				!newPreviousElement ||
				(isElement(newPreviousElement) && (newPreviousElement as Element).dataset.splitFrom)
			) {
				shouldContinue = false;
			} else {
				newRangeStart = previousElement;
				previousElement = newPreviousElement;
			}
		}

		if (shouldContinue) {
			// We found earlier content that doesn't want to avoid having a break after it.
			// newRangeStart is the next node (new overflow start).
			rangeStart = newRangeStart;
		}

		// Set the start of the range and record on node or the previous element
		// that overflow was moved.
		let position: Node | null = rangeStart;
		range = this.getRange(rangeStart, offset as number, rangeEnd);
		if (isText(rangeStart)) {
			if (rangeStart.parentElement) {
				rangeStart.parentElement!.dataset.splitTo =
					rangeStart.parentElement!.dataset.ref!;
				rangeStart.parentElement!.dataset.rangeStartOverflow = String(true);
				rangeStart.parentElement!.dataset.overflowTagged = String(true);
				position = rangeStart.parentElement;
			}
		} else {
			(rangeStart as Element).dataset.rangeStartOverflow = String(true);
		}

		rangeEnd = rangeEnd || rangeStart;
		if (isElement(rangeEnd)) {
			if (
				rangeStart.parentElement!.closest(
					`[data-ref='${rangeEnd.dataset.ref}']`,
				)
			) {
				let nextNode = nodeAfter(rangeEnd);
				if (nextNode) {
					(nextNode as Element).dataset.rangeEndOverflow = String(true);
					(nextNode as Element).dataset.overflowTagged = String(true);
				} else {
					// The range ends at the last rendered node. There is no
					// following node to carry the range-end marker, so mark
					// the range end itself; otherwise re-detection keeps
					// returning the same range and never advances past the
					// collected overflow.
					rangeEnd.dataset.rangeEndOverflow = String(true);
					rangeEnd.dataset.overflowTagged = String(true);
				}
			} else {
				rangeEnd.dataset.rangeEndOverflow = String(true);
				rangeEnd.dataset.overflowTagged = String(true);
			}
		} else {
			if (rangeEnd.parentElement) {
				(rangeEnd.parentElement as Element).dataset.rangeEndOverflow =
					String(true);
			}
		}

		// Add splitTo
		while (position !== rendered && position) {
			if (position!.previousSibling && position!.parentElement) {
				position!.parentElement!.dataset.splitTo =
					position!.parentElement!.dataset.ref!;
			}
			position = position!.parentElement;
		}

		// Tag ancestors in the range so we don't generate additional ranges
		// that then cause problems when removing the ranges.
		position = rangeStart;
		while (
			position &&
			position.parentElement !== range!.commonAncestorContainer
		) {
			position = position!.parentElement;
			if (position) {
				(position as Element).dataset.overflowTagged = String(true);
			}
		}

		if (isElement(position)) {
			let stopAt: Node | null | undefined = rangeEnd;
			while (
				stopAt &&
				stopAt.parentElement !== range!.commonAncestorContainer
			) {
				stopAt = stopAt.parentElement;
			}

			while (position !== stopAt && position) {
				position = position!.nextSibling;
				if (isElement(position)) {
					position.dataset.overflowTagged = String(true);
				}
			}
		} else if (position) {
			position = position!.parentElement;
		}
		while (
			position &&
			!(position as Element).nextElementSibling &&
			position !== rendered
		) {
			position = position!.parentElement;
			if (position) {
				(position as Element).dataset.overflowTagged = String(true);
			}
		}

		return range;
	}

	rowspanNeedsBreakAt(
		tableRow: Element,
		rendered: HTMLElement,
	): Element | undefined {
		if (tableRow.nodeName !== "TR") {
			return;
		}

		const table = parentOf(tableRow, "TABLE", rendered) as HTMLTableElement;
		if (!table) {
			return;
		}

		const rowspan = table.querySelector("[colspan]");
		if (!rowspan) {
			return;
		}

		let columnCount = 0;
		for (const cell of Array.from(table.rows[0].cells)) {
			columnCount += parseInt(cell.getAttribute("colspan") || "1");
		}
		if ((tableRow as HTMLTableRowElement).cells.length !== columnCount) {
			let previousRow: HTMLTableRowElement | null =
				tableRow as HTMLTableRowElement;
			let previousRowColumnCount: number | undefined;
			while (previousRow !== null) {
				previousRowColumnCount = 0;
				for (const cell of Array.from(previousRow.cells)) {
					previousRowColumnCount += parseInt(
						cell.getAttribute("colspan") || "1",
					);
				}
				if (previousRowColumnCount === columnCount) {
					break;
				}
				previousRow =
					previousRow.previousElementSibling as HTMLTableRowElement | null;
			}
			if (previousRowColumnCount === columnCount) {
				return previousRow!;
			}
		}
	}

	/**
	 * Find the next overflow in the current layout. Tags overflowing content and returns the range of the overflowing content
	 * -> Called by findBreakToken and afterLayout
	 *
	 * @param {Element} rendered - Current page rendered div
	 * @param {DOMRect} bounds - ClientRect of the page
	 * @param {HTML} source - Source html content
	 * @returns {null | Range} range - null if there is no overflow.
	 */
	findOverflow(
		rendered: HTMLElement,
		bounds: DOMRect,
		source?: DocumentFragment | Node,
	): Range | undefined {
		if (
			!this.hasOverflow(rendered, bounds) ||
			rendered.dataset.overflowTagged
		) {
			return;
		}

		// The pattern here is:
		// Round the bounds towards the smaller rectangle (round up top & left and
		// round down bottom and right) and round the content towards the larger
		// rectangle (round down top and left and round up bottom and right). Then
		// use > and < to check if bounds are exceeded. That way portions of pixels
		// will be correctly handled - you can't render a fraction of a pixel so
		// bounds should have any fraction treated like that pixel isn't available
		// and content should have any fraction of a pixel treated like the whole
		// pixel is required.
		let anyOverflowFound: boolean;

		// Find the deepest element that is the first in set of siblings with
		// overflow. There may be others. We just take the first we find and
		// are called again to check for additional instances.
		let node: ChildNode | null = rendered,
			startOfOverflow: ChildNode | null | undefined,
			check: ChildNode | null;

		while (isText(node)) {
			node = node.nextElementSibling;
		}

		[startOfOverflow, anyOverflowFound] = this.startOfNewOverflow(
			node!,
			rendered,
			bounds,
		);

		if (!anyOverflowFound) {
			return;
		}

		// startOfNewOverflow can report overflow without pinning a start node
		// (e.g. a detached text node after an extraction); without a concrete
		// start there is no range to collect, so bail rather than crash.
		if (!startOfOverflow) {
			return;
		}

		let startOfOverflowIsText = isText(startOfOverflow);
		if (
			(startOfOverflowIsText &&
				startOfOverflow!.parentElement!.dataset.overflowTagged) ||
			(!startOfOverflowIsText &&
				(startOfOverflow as Element).dataset.overflowTagged)
		) {
			return;
		}

		// The node we finished on may be within something asking not to have its
		// contents split. It - or a parent - may also have to be split because
		// the content is just too big for the page.
		// Resolve those requirements, deciding on a node that will be split in
		// the following way:
		// 1) Prefer the smallest node we can (start with the one we ended on).
		//    While going back up the ancestors, check that subsequent children
		//    of the ancestor are all entirely in overflow too. If they are, we
		//    can take a range starting at our initial node and going to the end
		//    of the ancestor's children.

		let rangeStart = (check = node = startOfOverflow!);
		let visibleSiblings = false;
		let rangeEnd: Node | null | undefined = rendered.lastElementChild;

		do {
			let checkBounds = getBoundingClientRect(check as Element)!;
			let hasOverflow = this.rectOverflows(
				checkBounds,
				0,
				this.getFragmentainer(check!),
				bounds,
			);

			let rowspanNeedsBreakAt: Element | undefined;

			if (hasOverflow && this.avoidBreakInside(check!, rendered)) {
				rowspanNeedsBreakAt = this.rowspanNeedsBreakAt(
					check! as Element,
					rendered,
				);
				if (rowspanNeedsBreakAt) {
					// No question - break earlier.
					rangeStart = rowspanNeedsBreakAt;
					rangeEnd = rendered.lastChild;
					break;
				} else {
					// If there is an element with overflow and it is within a
					// break-inside: avoid, we take the whole container, provided that it
					// will fit on a page by itself. But calculating whether it will fit
					// by itself is non-trivial. If it is within a dom structure, the
					// space available will be reduced by the containers. We can use the
					// current container (that will get duplicated) but there might be
					// subtle differences in styling due to the split-from class being
					// added. We therefore temporary add the split-from to the current
					// structure and find out how much space we need for the whole thing.
					//
					// To calculate whether we must split the element, we need to know its
					// unconstrained height. If it has been wrapped into another column
					// by .paged_pagebox's display:grid, we need to temporarily lengthen
					// the current column to get the maximum width it would take. Go from
					// check's parent to simplify handling where check is a text node.
					let unconstrainedHeight: number;
					if (checkBounds.width > bounds.width) {
						unconstrainedHeight = this.getUnconstrainedElementHeight(
						check! as Element,
					);
					} else {
						unconstrainedHeight = checkBounds.height;
					}

					let mustSplit = unconstrainedHeight > bounds.height;

					if (!mustSplit) {
						// Move the whole thing.
						rangeStart = check;
					}
				}
			}

			let sibling: ChildNode | null = check,
				siblingBounds: DOMRect | undefined;
			do {
				sibling = sibling!.nextSibling;
				siblingBounds = sibling
					? getBoundingClientRect(sibling as Element)
					: undefined;
			} while (sibling && !siblingBounds?.height);

			if (sibling && siblingBounds?.height && !rowspanNeedsBreakAt) {
				// Is the sibling entirely in overflow? If yes, so must all following
				// siblings be - add them to this range; they can't have anything we
				// want to keep on this page. A sibling that starts inside the
				// visible area but extends past its bottom edge (e.g. a paragraph
				// taller than the remaining space) is also overflow: leaving it
				// behind strands it on the page and the same range gets
				// re-detected forever.
				const frag = this.getFragmentainer(sibling);
				const siblingStartsBeyondVisible = this.rectOverflows(
					new DOMRect(siblingBounds.left, siblingBounds.top, 0, 0),
					0,
					frag,
					bounds,
				);
				const siblingEndsBeyondVisible = this.rectOverflows(
					new DOMRect(siblingBounds.left, siblingBounds.bottom, 0, 0),
					0,
					frag,
					bounds,
				);
				if (
					(siblingStartsBeyondVisible || siblingEndsBeyondVisible) &&
					!visibleSiblings
				) {
					if (!rowspanNeedsBreakAt) {
						rangeEnd = check!.parentElement!.lastChild;
					}
				} else {
					visibleSiblings = true;
					rangeEnd = undefined;
				}
			}

			// Get the columns widths and make them attributes so removal of
			// overflow doesn't do strange things - they may be affecting
			// widths on this page.
			const checkParent = check!.parentElement;
			if (checkParent) {
				Array.from(checkParent.children).forEach((childNode) => {
					let style = getComputedStyle(childNode);
					(childNode as any).width = style.width;
				});
			}

			if (
				isElement(check) &&
				Array.from(check.classList).filter((value) =>
					["region-content", "paged_page_content"].includes(value),
				).length
			) {
				break;
			}
			check = check!.parentElement;
		} while (check && check !== rendered && check.parentElement);

		return this.tagAndCreateOverflowRange(
			startOfOverflow!,
			rangeStart!,
			rangeEnd as Node | undefined,
			bounds,
			rendered,
		);
	}

	findEndToken(
		rendered: HTMLElement,
		source: DocumentFragment | Node,
	): BreakToken | undefined {
		if (rendered.childNodes.length === 0) {
			return;
		}

		let lastChild: Node | null = rendered.lastChild;

		let lastNodeIndex: number | undefined;
		while (lastChild && lastChild.lastChild) {
			if (!validNode(lastChild)) {
				// Only get elements with refs
				lastChild = lastChild.previousSibling;
			} else if (!validNode(lastChild.lastChild)) {
				// Deal with invalid dom items
				lastChild = prevValidNode(lastChild.lastChild);
				break;
			} else {
				lastChild = lastChild.lastChild;
			}
		}

		if (isText(lastChild)) {
			if ((lastChild.parentNode as Element).dataset.ref) {
				lastNodeIndex = indexOf(lastChild);
				lastChild = lastChild.parentNode as unknown as ChildNode;
			} else {
				lastChild = lastChild.previousSibling;
			}
		}

		let original: Node | null | undefined = findElement(lastChild!, source);

		if (lastNodeIndex) {
			original = original!.childNodes[lastNodeIndex];
		}

		let after = nodeAfter(original as Node);

		return this.breakAt(after);
	}

	/**
	 * Finds the character offset at which this text node first exceeds the
	 * available space.
	 *
	 * Fast path: predicts the break arithmetically via pretext line layout
	 * (cached canvas measurements, no reflow per word) and verifies the
	 * candidate with a couple of cheap DOM probes. Anything unsupported or
	 * inconsistent falls back to the legacy word/letter walker.
	 *
	 * @returns offset, undefined (no break needed within this node), or
	 * legacy fallback semantics otherwise.
	 */
	textBreak(
		node: Text,
		start: number,
		end: number,
		vStart: number,
		vEnd: number,
	): number | undefined {
		// Margin bottom is needed when the node is in a block level element
		// such as a table, grid or flex, where margins don't collapse.
		// Temporarily add data-split-to as this may change margins too
		// (It always does in current code but let's not assume that).
		// With the split-to set, margin might be removed, resulting in us
		// not actually needing to split this text. In that case, the return
		// result will be undefined and the split should be done at the next
		// node. In this case we also keep the data-split-to=foo so the
		// styling that removes the need for the overflow remains active.
		// "Margin" includes bottom padding and border in this calculation.

		this.addTemporarySplit(node.parentElement);

		const additions = this.getAncestorPaddingBorderAndMarginSums(
			node.parentElement,
			true,
		);
		const parentAdditions =
			additions["padding-bottom"] +
			additions["border-bottom-width"] +
			additions["margin-bottom"];

		let offset: number | undefined | null = undefined;
		if (
			this.settings.textMeasurement === "pretext" &&
			!this.predictFallbacks.has(node)
		) {
			try {
				offset = this.predictTextBreak(
					node,
					start,
					end,
					vStart,
					vEnd,
					parentAdditions,
				);
			} catch {
				offset = null;
			}
			if (offset === null) {
				this.predictFallbacks.add(node);
			}
			if (offset !== null && offset !== undefined) {
				this.deleteTemporarySplit(node.parentElement);
				if (node.textContent!.substring(0, offset).trim() == "") {
					return 0;
				}
				return offset;
			}
			if (offset === undefined) {
				// Prediction confidently found no break in this node.
				this.deleteTemporarySplit(node.parentElement);
				return undefined;
			}
		}

		offset = this.legacyTextBreakCore(
			node,
			start,
			end,
			vStart,
			vEnd,
			parentAdditions,
		);

		// See comment above the addTemporarySplit call above for the offset ==
		// undefined part of why we may leave the temporary split-to attribute in
		// place. This should be overridden though if a break is to be avoided.
		// In that case,
		if (offset != undefined) {
			this.deleteTemporarySplit(node.parentElement);
		}

		// Don't get tricked into doing a split by whitespace at the start of a string.
		if (node.textContent!.substring(0, offset).trim() == "") {
			return 0;
		}

		return offset;
	}

	/**
	 * Legacy word/letter walker measuring every word (and boundary-word
	 * letters) through DOM rects.
	 *
	 * TEMPORARY FALLBACK: kept only until parity testing proves the
	 * pretext predictor handles every supported case; remove together with
	 * the `textMeasurement` escape hatch and capability gates then.
	 */
	private legacyTextBreakCore(
		node: Text,
		start: number,
		end: number,
		vStart: number,
		vEnd: number,
		parentAdditions: number,
	): number | undefined {
		let wordwalker = words(node);
		let left = 0;
		let right = 0;
		let top = 0;
		let bottom = 0;
		let word: Range | undefined,
			next,
			done,
			pos: DOMRect | undefined;
		let offset: number | undefined;

		const frag = this.getFragmentainer(node);

		while (!done) {
			next = wordwalker.next();
			word = next.value;
			done = next.done;

			if (!word) {
				break;
			}

			pos = getBoundingClientRect(word)!;

			left = Math.floor(pos!.left);
			right = Math.floor(pos!.right);
			top = pos!.top;
			bottom = pos!.bottom;

			if (frag) {
				if (
					this.rectOverflows(
						new DOMRect(left, top, right - left, bottom - top),
						parentAdditions,
						frag,
					)
				) {
					offset = word.startOffset;
					break;
				}
				continue;
			}

			if (left > end || top > vEnd - parentAdditions) {
				offset = word.startOffset;
				break;
			}

			// The bounds won't be exceeded so we need >= rather than >.
			// Also below for the letters.
			if (right > end || bottom > vEnd - parentAdditions) {
				let letterwalker = letters(word);
				let letter, nextLetter, doneLetter;

				while (!doneLetter) {
					// Note that the letter walker continues to walk beyond the end of the word, until the end of the
					// text node.
					nextLetter = letterwalker.next();
					letter = nextLetter.value;
					doneLetter = nextLetter.done;

					if (!letter) {
						break;
					}

					pos = getBoundingClientRect(letter)!;
					right = pos!.right;
					bottom = pos!.bottom;

					if (right > end || bottom > vEnd - parentAdditions) {
						offset = letter.startOffset;
						done = true;

						break;
					}
				}
			}
		}

		return offset;
	}

	/**
	 * Pretext-backed fast path: predicts the break offset from cached
	 * arithmetic line layout and verifies the candidate with at most a
	 * handful of DOM probes.
	 *
	 * @returns an offset when confidently predicted, `undefined` when the
	 * text provably fits the remaining space, or `null` to request the
	 * legacy fallback.
	 */
	private predictTextBreak(
		node: Text,
		start: number,
		end: number,
		vStart: number,
		vEnd: number,
		parentAdditions: number,
	): number | undefined | null {
		const predictT0 = performance.now();
		const result = this.predictTextBreakInner(
			node,
			start,
			end,
			vStart,
			vEnd,
			parentAdditions,
		);
		predictStats.predictMs += performance.now() - predictT0;
		if (result === null) {
			predictStats.fallbacks++;
		}
		return result;
	}

	private predictTextBreakInner(
		node: Text,
		start: number,
		end: number,
		vStart: number,
		vEnd: number,
		parentAdditions: number,
	): number | undefined | null {
		if (measurementCapabilities() === false) {
			return rejectPrediction("capabilities");
		}
		const spec = buildFontSpec(node.parentElement);
		if (!spec || spec.lineHeight <= 0) {
			return rejectPrediction("font-spec");
		}
		const text = node.textContent || "";
		if (!text.trim().length) {
			return undefined;
		}

		const frag = this.getFragmentainer(node);
		predictStats.predicts++;

		if (!this.predictionVerified) {
			predictStats.unverified++;
		}

		// Fast path (verified mode only): if the node's very last character
		// sits within bounds, everything before it does too (fragments
		// appear in flow order), so this node needs no break at all. One DOM
		// probe replaces the entire prediction for the most common case —
		// nodes that fit.
		if (this.predictionVerified && !this.textEndOverflows(node, frag, parentAdditions)) {
			predictStats.quickFits++;
			return undefined;
		}

		// Word inventory is DOM-cheap (no layout work).
		const wordList: Array<{ range: Range; startOffset: number }> = [];
		const wordwalker = words(node);
		for (;;) {
			const next = wordwalker.next();
			if (next.done || !next.value) {
				break;
			}
			const w = next.value as Range;
			wordList.push({ range: w, startOffset: w.startOffset });
			if (wordList.length > 5000) {
				return rejectPrediction("too-many-words");
			}
		}
		if (wordList.length < 2) {
			return rejectPrediction("too-few-words");
		}

		const r0 = getBoundingClientRect(wordList[0].range);
		if (!r0) {
			return rejectPrediction("no-first-rect");
		}

		// Trivial case: the node's first word already lies outside the
		// available space (e.g. the whole node sits in hidden overflow
		// territory after a sibling spilled). Breaking at its start matches
		// the legacy verdict without any arithmetic.
		if (
			this.rectOverflows(
				new DOMRect(r0.left, r0.top, r0.width, r0.height),
				parentAdditions,
				frag,
			)
		) {
			return wordList[0].startOffset;
		}

		// The legacy walker early-exits at the break, so for short runs its
		// handful of rect reads are cheaper than preparing text for
		// measurement. Only engage the predictor when there is enough text
		// for the arithmetic to pay off.
		if (wordList.length < PREDICT_MIN_WORDS) {
			return rejectPrediction("min-words");
		}

		// Resolve the column geometry the node lives in.
		let colLeft: number,
				colRight: number,
				colBottom: number,
				columnsRemaining: number;
		let box: { left: number; top: number; right: number; bottom: number } | null = null;
		let meta: FragmentainerMeta | null = null;
		let stride = 0;
		if (frag) {
			box = this.fragmentainerBox(frag);
			meta = this.getFragmentainerMeta(frag);
			stride = meta.columnWidth + meta.gap;
			const colIndex0 = Math.max(
				0,
				Math.min(meta.count - 1, Math.floor((r0.left - box.left + COLUMN_EPSILON) / stride)),
			);
			colLeft = box.left + colIndex0 * stride;
			colRight = Math.min(colLeft + meta.columnWidth, box.right);
			colBottom = box.bottom - parentAdditions;
			columnsRemaining = meta.count - 1 - colIndex0;
			if (colRight - colLeft < 4) {
				return rejectPrediction("narrow-column");
			}
		} else {
			colLeft = start;
			colRight = end;
			colBottom = vEnd - parentAdditions;
			columnsRemaining = 0;
		}

		const lineHeight = spec.lineHeight;

		// Reuse a prepared object for this text: prefer the eager warm-up
		// entry (the whole document's texts, prepared once up front), then
		// the pre-split original of a continuation suffix. Only when neither
		// has it does this cost a fresh prepare.
		const key = fontKey(spec);
		const parentEl = node.parentElement as HTMLElement | null;
		const refKey = parentEl?.dataset.ref || "";
		let prepared: PreparedTextWithSegments | undefined;
		let baseOffset = 0;
		let truncated = false;
		let reused = false;

		const eagerList = refKey ? eagerPreparedTexts.get(refKey) : undefined;
		if (eagerList && parentEl) {
			const childIndex = textNodeIndexInParent(node, parentEl);
			for (const entry of eagerList) {
				if (
					entry.childIndex === childIndex &&
					entry.fontKey === key &&
					entry.fullText.endsWith(text)
				) {
					baseOffset = entry.fullText.length - text.length;
					prepared = entry.prepared;
					reused = true;
					break;
				}
			}
		}

		if (!prepared) {
			const stored = refKey
				? this.continuationPrepared.get(refKey)
				: undefined;
			if (
				stored &&
				stored.fontKey === key &&
				stored.fullText.length > text.length &&
				stored.fullText.endsWith(text)
			) {
				baseOffset = stored.fullText.length - text.length;
				prepared = stored.prepared;
				reused = true;
			}
		}

		if (!prepared) {
			truncated = text.length > PREDICT_MAX_CHARS;
			const preparedText = truncated
				? text.slice(0, PREDICT_MAX_CHARS)
				: text;
			const t0 = performance.now();
			prepared = this.measure.prepare(preparedText, spec);
			predictStats.prepareCalls++;
			predictStats.prepareMs += performance.now() - t0;
		}
		predictStats.reuses += reused ? 1 : 0;

		// Walk pretext lines through the column budget. The first line is
		// partial (the node may continue after inline siblings); every
		// following line uses the full column width. When a column's
		// vertical budget is exhausted, remaining lines move to the next
		// visible column; once those run out, the line marks the break.
		//
		// Canvas-measured widths can drift slightly below what DOM layout
		// produces (rounding, kerning differences), making the model pack a
		// word more per few lines than the browser does. Each attempt
		// therefore narrows the wrapping width by a pixel or two — retries
		// are pure arithmetic — while verification against real DOM rects
		// still gates every acceptance.
		let colIndex = 0;
		if (meta && box) {
			colIndex = Math.max(
				0,
				Math.min(meta.count - 1, Math.floor((r0.left - box.left + COLUMN_EPSILON) / stride)),
			);
		}

		const startCursor = this.measure.offsetToCursor(prepared, baseOffset);

		// Verification probe helpers, shared across attempts. Unused in the
		// unverified mode.
		const probeMemo = new Map<number, boolean | null>();
		const overflows = (index: number): boolean | null => {
			if (probeMemo.has(index)) {
				return probeMemo.get(index)!;
			}
			const r = getBoundingClientRect(wordList[index].range);
			const result =
				!r
					? null
					: this.rectOverflows(
							new DOMRect(
								r.left,
								r.top,
								r.right - r.left,
								r.bottom - r.top,
							),
							parentAdditions,
							frag,
						);
			probeMemo.set(index, result);
			return result;
		};

		let lastReject = "exhausted";
		for (const shrink of this.predictionVerified
			? PREDICT_WIDTH_SHRINKS_PX
			: [0]) {
			let y = r0.top;
			let currentColRight = colRight;
			let currentColIndex = colIndex;
			let remaining = columnsRemaining;
			let candidateCursor: LayoutCursor | null = null;

			const wrapWidth = meta
				? meta.columnWidth - shrink
				: currentColRight - colLeft - shrink;

			this.measure.walkLines(
				prepared,
				currentColRight - r0.left - shrink,
				wrapWidth,
				(line) => {
					const lineBottom = y + lineHeight;
					if (lineBottom <= colBottom + COLUMN_EPSILON) {
						y = lineBottom;
						return true;
					}
					if (remaining > 0 && meta && box) {
						// Move the flow to the next visible column.
						remaining--;
						currentColIndex++;
						currentColRight = Math.min(
							box.left + currentColIndex * stride + meta.columnWidth,
							box.right,
						);
						y = box.top;
						if (y + lineHeight <= colBottom + COLUMN_EPSILON) {
							y += lineHeight;
							return true;
						}
					}
					candidateCursor = line.start;
					return false;
				},
				startCursor,
			);

			if (!candidateCursor) {
				if (truncated) {
					// Walk exhausted on the truncated prefix, not real text.
					return rejectPrediction("truncated");
				}
				if (!this.predictionVerified) {
					// Pure prediction says it fits; post-render auditing is
					// responsible for catching divergence.
					return undefined;
				}
				// Everything fit at this width; verify against the DOM tail.
				const lastRect = getBoundingClientRect(
					wordList[wordList.length - 1].range,
				);
				if (
					!lastRect ||
					this.rectOverflows(
						new DOMRect(
							lastRect.left,
							lastRect.top,
							lastRect.right - lastRect.left,
							lastRect.bottom - lastRect.top,
						),
						parentAdditions,
						frag,
					)
				) {
					lastReject = "fits-mismatch";
					continue; // retry narrower before giving up
				}
				return undefined;
			}

			// Map the predicted cursor to a character offset in this node
			// and snap it to the word that begins the overflowing line.
			const absOffset = this.measure.cursorToOffset(prepared, candidateCursor);
			const candidateOffset = absOffset - baseOffset;
			if (candidateOffset <= 0 || candidateOffset > text.length) {
				return rejectPrediction("offset-range");
			}
			let j = 0;
			for (let i = 0; i < wordList.length; i++) {
				if (wordList[i].startOffset <= candidateOffset) {
					j = i;
				} else {
					break;
				}
			}

			if (!this.predictionVerified) {
				// Accept the arithmetic break directly; an early break is
				// typographically harmless, and late ones are caught by
				// post-render auditing instead of per-break probes.
				return wordList[j].startOffset;
			}

			// Verification probes: bounded nudges in either direction. The
			// candidate word must not fit; the word before it must.
			let nudges = 0;
			while (j < wordList.length - 1 && overflows(j) === false && nudges < 3) {
				// Prediction was conservative: the candidate still fits.
				j++;
				nudges++;
			}
			if (overflows(j) !== true) {
				lastReject = "no-nonfit";
				break; // narrower attempts only worsen this; stop
			}
			while (j > 0 && overflows(j - 1) === true && nudges < 6) {
				// Prediction was late: the previous word already overflows.
				j--;
				nudges++;
			}
			if (j > 0 && overflows(j - 1) === true) {
				lastReject = "prev-overlaps";
				continue; // try narrower: an earlier break may verify
			}

			// A split will follow from this offset: remember the prepared
			// object so continuation suffixes reuse it without re-preparing.
			if (refKey && this.continuationPrepared.size >= CONTINUATION_CACHE_MAX) {
				this.continuationPrepared.clear();
			}
			this.continuationPrepared.set(refKey, {
				fullText: text,
				fontKey: key,
				prepared,
			});

			return wordList[j].startOffset;
		}

		return rejectPrediction(lastReject);
	}

	removeOverflow(overflow: Range, breakLetter?: string): DocumentFragment {
		let { startContainer } = overflow;
		let extracted = overflow.extractContents();

		this.hyphenateAtBreak(startContainer, breakLetter);

		return extracted;
		this.invalidateBounds();
	}

	hyphenateAtBreak(startContainer: Node, breakLetter?: string): void {
		if (isText(startContainer)) {
			let startText = startContainer.textContent!;
			let prevLetter = startText[startText.length - 1];

			// Add a hyphen if previous character is a letter or soft hyphen
			if (
				(breakLetter &&
					/^\w|\u00AD$/.test(prevLetter) &&
					/^\w|\u00AD$/.test(breakLetter)) ||
				(!breakLetter && prevLetter && /^\w|\u00AD$/.test(prevLetter))
			) {
				(startContainer.parentNode as Element).classList.add("paged_hyphen");
				startContainer.textContent =
					startContainer.textContent +
					((this.settings.hyphenGlyph as string) || "\u2011");
			}
		}
		this.invalidateBounds();
	}

	equalTokens(
		a?: { node?: Node; offset?: number } | null,
		b?: { node?: Node; offset?: number } | null,
	): boolean {
		if (!a || !b) {
			return false;
		}
		if (a["node"] && b["node"] && a["node"] !== b["node"]) {
			return false;
		}
		if (a["offset"] && b["offset"] && a["offset"] !== b["offset"]) {
			return false;
		}
		return true;
	}
}

EventEmitter(Layout.prototype);

interface Layout extends PagedEventEmitter {}

declare global {
	interface Window {
		__pagedPredictStats?: typeof predictStats;
	}
}
if (typeof window !== "undefined") {
	window.__pagedPredictStats = predictStats;
	(globalThis as unknown as { __pagedDomOps?: unknown }).__pagedDomOps =
		getDomOpStats();
}

export default Layout;
