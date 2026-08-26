import {
	getBoundingClientRect,
	getClientRects,
} from "../utils/utils.js";
import {
	buildFontSpec,
	getTextMeasureService,
	measurementCapabilities,
} from "../utils/textmeasure.js";
import { getDomOpStats } from "../utils/domops.js";
import type { LayoutCursor, PreparedTextWithSegments } from "@chenglou/pretext";
import {
	child,
	cloneNode,
	findElement,
	hasContent,
	indexOf,
	indexOfTextNode,
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
			if (container.scrollWidth > container.clientWidth + 2) {
				violations.push({
					page: pg.id,
					kind: "h-spill",
					detail: `scrollWidth ${container.scrollWidth} > clientWidth ${container.clientWidth}`,
				});
			}
			if (container.scrollHeight > container.clientHeight + 2) {
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
 * Prepares every substantial text node of the source document up front.
 *
 * The whole document is known before pagination starts, so this front-loads
 * all segmentation and canvas measurement into one warm phase (after fonts
 * have loaded), leaving textBreak pure arithmetic + probes afterwards.
 *
 * The fragment is temporarily attached inside a hidden container so
 * computed styles resolve; it is returned re-parented as a fresh fragment
 * for the caller to render from.
 */
export function prepareTextsEagerly(
	source: DocumentFragment | Node,
	settings: Record<string, unknown>,
): DocumentFragment | Node {
	if (
		settings.textMeasurement !== "pretext" ||
		!measurementCapabilities()
	) {
		return source;
	}
	if (typeof document === "undefined" || !document.body) {
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
		// The fragment adopted its children into host; walk those.
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
						const fontKey = `${spec.font}\u0000${spec.letterSpacing}\u0000${spec.whiteSpace}`;
						const prepared = getTextMeasureService().prepare(full, spec);
						let list = eagerPreparedTexts.get(ref);
						if (!list) {
							list = [];
							eagerPreparedTexts.set(ref, list);
						}
						list.push({
							childIndex: textNodeIndexInParent(current, parent),
							fullText: full,
							fontKey,
							prepared,
						});
						predictStats.eagerEntries++;
					}
				}
			}
			current = walker.nextNode() as Text | null;
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
			| { count: number; gap?: string; ruleColor?: string; ruleStyle?: string; ruleWidth?: string }
			| undefined;
		const count =
			rootColumns && rootColumns.count > 1
				? Math.floor(rootColumns.count)
				: 1;
		if (count <= 1) {
			return [wrapper];
		}
		const config = rootColumns as { gap?: string; ruleColor?: string; ruleStyle?: string; ruleWidth?: string };
		const gap =
			config.gap !== undefined && config.gap !== "normal"
				? config.gap
				: "1em";
		const row = document.createElement("div");
		row.classList.add("paged_columns");
		row.style.gap = gap;
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
		this.append(node, wrapper, source, breakToken, false);
		return this.startSpanRow(wrapper);
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
		const elRect = dest.getBoundingClientRect();
		if (dest.classList.contains("paged_column") && dest.closest(".paged_flow")) {
			const hostRect = dest.closest(".paged_flow")!.getBoundingClientRect();
			this.bounds = new DOMRect(
				elRect.left,
				hostRect.top,
				elRect.width,
				hostRect.height,
			);
		} else {
			this.bounds = this.refreshBounds();
		}
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
				const hostRect = this.element
					.closest(".paged_flow")!
					.getBoundingClientRect();
				this.bounds = new DOMRect(
					elRect.left,
					hostRect.top,
					elRect.width,
					hostRect.height,
				);
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

		while (!done && !newBreakToken) {
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
			// columns (column 0 again). If the current columns already
			// overflow, that overflow must be handled first (the span then
			// interrupts at its natural flow position, possibly on the next
			// page).
			if (
				this.isColumnSpan(node) &&
				columns.length > 1 &&
				!this.hasOverflow(dest, this.refreshBounds())
			) {
				columns = this.applyColumnSpan(wrapper, node!, source, breakToken);
				colIndex = 0;
				dest = columns[0];
				this.setActiveColumn(dest);
				bounds = this.refreshBounds();
				hasRenderedContent = true;
				walker = walk(nodeAfter(node!, source) as Node, source);
				continue;
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

				if (newBreakToken && node === undefined) {
					// We have run out of content. Do add the overflow to a new page but
					// don't repeat the whole thing again.
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
				walker = walk(nodeAfter(node!, source) as Node, source);
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
				if (newBreakToken && node === undefined) {
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

		breakToken.overflow.forEach((overflow) => {
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
			this.addOverflowNodes(addTo as HTMLElement, overflow.content!);
		});

		// Record refs.
		Array.from(fragment!.querySelectorAll("[data-ref]")).forEach((ref) => {
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
					let prevNode: Node | null = prevValidNode(temp);
					if (!isElement(prevNode)) {
						prevNode = prevNode!.parentElement;
					}
					renderedNode = findElement(prevNode as Node, rendered);
					// Check if temp is the last rendered node at its level.
					if (!temp.nextSibling) {
						// We need to ensure that the previous sibling of temp is fully rendered.
						const renderedNodeFromSource = findElement(
							renderedNode as Node,
							source,
						);
						const walker = document.createTreeWalker(
							renderedNodeFromSource!,
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
						renderedNode = findElement(
							prevValidNode(container) as Node,
							rendered,
						);
					}

					parent = findElement(renderedNode!, source);
				}
				index = indexOfTextNode(temp!, parent! as Element, hyphen);
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
				renderedNode = findElement(
					prevValidNode(container.parentNode as Node) as Node,
					rendered,
				);
			}

			parent = findElement(renderedNode!, source);
			index = indexOfTextNode(container, parent! as Element, hyphen);

			if (index === -1) {
				return;
			}

			node = child(parent! as Node, index!);

			offset += node!.textContent!.indexOf(container.textContent!);
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
		} else if (refId && !rootElement.indexOfRefs![refId]) {
			rootElement.indexOfRefs![refId] = parentElement as HTMLElement;
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

			let overflow = this.createOverflow(overflowRange, rendered, source);
			if (!breakToken) {
				breakToken = new BreakToken(node!, [overflow!]);
			} else {
				breakToken.overflow.push(overflow!);
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
		if ((rendered as WithRefs).indexOfRefs && extract && breakToken!.overflow.length) {
			let firstOverflow = breakToken!.overflow[0];
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

		breakToken!.overflow.forEach((overflow) => {
			this.hooks &&
				this.hooks.afterOverflowRemoved.trigger(
					overflow.content,
					rendered,
					this,
				);
		});

		return breakToken!;
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
		while (overflowResult) {
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

				const before = breakToken.overflow.length;
				this.processOverflowResult(
					[range],
					rendered,
					source,
					bounds,
					prevBreakToken,
					breakToken.node as unknown as Node,
					true,
				);
				if (breakToken.overflow.length === before) {
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
		if (
			constrainingElement &&
			(constrainingElement.classList.contains("paged_page_content") ||
				// A manual column's content overflow does not grow the flex
				// row it sits in; measure the column box itself.
				constrainingElement.classList.contains("paged_columns"))
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

			if (isElement(child)) {
				let styles = window.getComputedStyle(child);

				bottomMargin = parseInt(styles.getPropertyValue("margin-bottom"));

				if ((child as Element).dataset.rangeStartOverflow !== undefined) {
					skipRange = true;
					result = null;
					// Don't continue. The start may also be the end.
				}

				if ((child as Element).dataset.rangeEndOverflow !== undefined) {
					skipRange = false;
					result = undefined;
					continue;
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

			if (skipRange) {
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
								node = (node! as Element).nextElementSibling;
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
						while (!(node! as Element).nextElementSibling) {
							if (node == rendered) {
								return [null, false];
							}
							node = node!.parentElement;
						}
						do {
							node = (node! as Element).nextElementSibling;
						} while (
							(node! as Element).nextElementSibling &&
							(node as Element).dataset.overflowTagged
						);
					} while ((node as Element).dataset.overflowTagged);
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
			if (!newPreviousElement || (newPreviousElement as Element).dataset.splitFrom) {
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
			rangeStart.parentElement!.dataset.splitTo =
				rangeStart.parentElement!.dataset.ref!;
			rangeStart.parentElement!.dataset.rangeStartOverflow = String(true);
			rangeStart.parentElement!.dataset.overflowTagged = String(true);
			position = rangeStart.parentElement;
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
				}
			} else {
				rangeEnd.dataset.rangeEndOverflow = String(true);
				rangeEnd.dataset.overflowTagged = String(true);
			}
		} else {
			(rangeEnd.parentElement as Element).dataset.rangeEndOverflow =
				String(true);
		}

		// Add splitTo
		while (position !== rendered) {
			if (position!.previousSibling) {
				position!.parentElement!.dataset.splitTo =
					position!.parentElement!.dataset.ref!;
			}
			position = position!.parentElement;
		}

		// Tag ancestors in the range so we don't generate additional ranges
		// that then cause problems when removing the ranges.
		position = rangeStart;
		while (position!.parentElement !== range!.commonAncestorContainer) {
			position = position!.parentElement;
			(position as Element).dataset.overflowTagged = String(true);
		}

		if (isElement(position)) {
			let stopAt: Node | null | undefined = rangeEnd;
			while (stopAt!.parentElement !== range!.commonAncestorContainer) {
				stopAt = stopAt!.parentElement;
			}

			while (position !== stopAt) {
				position = position!.nextSibling;
				if (isElement(position)) {
					position.dataset.overflowTagged = String(true);
				}
			}
		} else {
			position = position!.parentElement;
		}
		while (!(position as Element).nextElementSibling && position !== rendered) {
			position = position!.parentElement;
			(position as Element).dataset.overflowTagged = String(true);
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
				// want to keep on this page.
				const siblingStartsBeyondVisible =
					this.rectOverflows(
						new DOMRect(
							siblingBounds.left,
							siblingBounds.top,
							0,
							0,
						),
						0,
						this.getFragmentainer(sibling),
						bounds,
					);
				if (siblingStartsBeyondVisible && !visibleSiblings) {
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
		const fontKey = `${spec.font}\u0000${spec.letterSpacing}\u0000${spec.whiteSpace}`;
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
					entry.fontKey === fontKey &&
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
				stored.fontKey === fontKey &&
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
				fontKey,
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
