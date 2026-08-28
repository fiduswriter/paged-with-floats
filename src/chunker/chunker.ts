import Page from "./page.js";
import ContentParser from "./parser.js";
import EventEmitter from "event-emitter";
import Hook from "../utils/hook.js";
import Queue from "../utils/queue.js";
import BreakToken from "./breaktoken.js";
import Layout, {
	prepareTextsEagerly,
	resetPredictionCaches,
} from "./layout.js";
import {
	installDomOperationCounters,
	resetDomOpStats,
} from "../utils/domops.js";
import { requestIdleCallback } from "../utils/utils.js";
import type { PagedEventEmitter } from "../types/emitter.js";

const MAX_PAGES: number | null = null;

/** Upper bound for waiting on a single image during the preload pass. */
const IMAGE_PRELOAD_TIMEOUT_MS = 10000;

/**
 * Number of load/barrier passes over the font set. Late-processed styles can
 * register faces while earlier passes are still awaiting them; two extra
 * passes cover that without risking an endless loop on pathological sheets.
 */
const FONT_LOAD_PASSES = 3;
const MAX_LAYOUTS: number | false = false;

export interface ChunkerHooks {
	beforeParsed: Hook<[Node | string, Chunker]>;
	filter: Hook<[DocumentFragment]>;
	afterParsed: Hook<[DocumentFragment, Chunker]>;
	beforePageLayout: Hook<[Page, Node | string | undefined, BreakToken | undefined, Chunker]>;
	onPageLayout: Hook<[HTMLElement, BreakToken | undefined, Layout]>;
	layout: Hook<[HTMLElement, Layout]>;
	renderNode: Hook<[Node, Node, Layout]>;
	layoutNode: Hook<[Node]>;
	onOverflow: Hook<[Range, HTMLElement, DOMRect, Layout]>;
	afterOverflowRemoved: Hook<[DocumentFragment | null | undefined, HTMLElement, Layout]>;
	afterOverflowAdded: Hook<[HTMLElement]>;
	onBreakToken: Hook<[BreakToken, Range | undefined, HTMLElement | undefined, Layout]>;
	beforeRenderResult: Hook<[BreakToken | undefined, HTMLElement, Layout]>;
	afterPageLayout: Hook<[HTMLElement, Page, BreakToken | null | undefined, Chunker]>;
	finalizePage: Hook<[HTMLElement, Page, BreakToken | undefined, Chunker]>;
	afterRendered: Hook<[Page[], Chunker]>;
}

export type RenderStep = IteratorResult<BreakToken | undefined, void> & {
	canceled?: boolean;
};

const TEMPLATE = `
<div class="paged_page">
	<div class="paged_sheet">
		<div class="paged_bleed paged_bleed-top">
			<div class="paged_marks-crop"></div>
			<div class="paged_marks-middle">
				<div class="paged_marks-cross"></div>
			</div>
			<div class="paged_marks-crop"></div>
		</div>
		<div class="paged_bleed paged_bleed-bottom">
			<div class="paged_marks-crop"></div>
			<div class="paged_marks-middle">
				<div class="paged_marks-cross"></div>
			</div>		<div class="paged_marks-crop"></div>
		</div>
		<div class="paged_bleed paged_bleed-left">
			<div class="paged_marks-crop"></div>
			<div class="paged_marks-middle">
				<div class="paged_marks-cross"></div>
			</div>		<div class="paged_marks-crop"></div>
		</div>
		<div class="paged_bleed paged_bleed-right">
			<div class="paged_marks-crop"></div>
			<div class="paged_marks-middle">
				<div class="paged_marks-cross"></div>
			</div>
			<div class="paged_marks-crop"></div>
		</div>
		<div class="paged_pagebox">
			<div class="paged_margin-top-left-corner-holder">
				<div class="paged_margin paged_margin-top-left-corner"><div class="paged_margin-content"></div></div>
			</div>
			<div class="paged_margin-top">
				<div class="paged_margin paged_margin-top-left"><div class="paged_margin-content"></div></div>
				<div class="paged_margin paged_margin-top-center"><div class="paged_margin-content"></div></div>
				<div class="paged_margin paged_margin-top-right"><div class="paged_margin-content"></div></div>
			</div>
			<div class="paged_margin-top-right-corner-holder">
				<div class="paged_margin paged_margin-top-right-corner"><div class="paged_margin-content"></div></div>
			</div>
			<div class="paged_margin-right">
				<div class="paged_margin paged_margin-right-top"><div class="paged_margin-content"></div></div>
				<div class="paged_margin paged_margin-right-middle"><div class="paged_margin-content"></div></div>
				<div class="paged_margin paged_margin-right-bottom"><div class="paged_margin-content"></div></div>
			</div>
			<div class="paged_margin-left">
				<div class="paged_margin paged_margin-left-top"><div class="paged_margin-content"></div></div>
				<div class="paged_margin paged_margin-left-middle"><div class="paged_margin-content"></div></div>
				<div class="paged_margin paged_margin-left-bottom"><div class="paged_margin-content"></div></div>
			</div>
			<div class="paged_margin-bottom-left-corner-holder">
				<div class="paged_margin paged_margin-bottom-left-corner"><div class="paged_margin-content"></div></div>
			</div>
			<div class="paged_margin-bottom">
				<div class="paged_margin paged_margin-bottom-left"><div class="paged_margin-content"></div></div>
				<div class="paged_margin paged_margin-bottom-center"><div class="paged_margin-content"></div></div>
				<div class="paged_margin paged_margin-bottom-right"><div class="paged_margin-content"></div></div>
			</div>
			<div class="paged_margin-bottom-right-corner-holder">
				<div class="paged_margin paged_margin-bottom-right-corner"><div class="paged_margin-content"></div></div>
			</div>
			<div class="paged_area">
				<div class="paged_page_content">
					<div class="paged_float_top"></div>
					<div class="paged_float_bottom"></div>
				</div>
				<div class="paged_footnote_area">
					<div class="paged_footnote_content paged_footnote_empty">
						<div class="paged_footnote_inner_content"></div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>`;

/**
 * The Chunker class is responsible for processing and paginating HTML content into individual page layouts.
 * It manages rendering, page flow, break handling, overflow detection, and layout cycles.
 *
 * @class
 */

/**
 * Configuration for a root-level multi-column flow, applied to the page
 * content wrapper of every page.
 */
export interface RootColumnConfig {
	count: number;
	gap?: string;
	fill?: "auto" | "balance";
	ruleColor?: string;
	ruleStyle?: string;
	ruleWidth?: string;
}

class Chunker {
	settings: Record<string, unknown>;
	hooks: ChunkerHooks;
	pages: Page[];
	total: number;
	q: Queue;
	stopped: boolean;
	rendered: boolean;
	content: HTMLElement | DocumentFragment | string | undefined;
	modifiedRules: Record<string, Record<string, CSSStyleRule[]>>;
	charsPerBreak: number[];
	maxChars?: number;
	pagesArea?: HTMLDivElement;
	pageTemplate?: HTMLTemplateElement;
	source?: DocumentFragment | Node;
	breakToken?: BreakToken;
	/** Selector strings from author CSS that declare multi-column formatting. */
	multicolSelectors: Set<string>;
	/** Selectors declaring `column-span: all` (full-width rows). */
	columnSpanSelectors: Set<string>;
	/** Root-level multicol configuration applied to every page wrapper. */
	rootColumns?: RootColumnConfig;
	/**
	 * Root-level column configuration captured from author CSS by the
	 * Columns handler, which simultaneously strips the declarations from
	 * the sheet so they can never restyle the host document (the rendered
	 * page list must not become a browser multicol container).
	 */
	rootColumnsFromCss?: RootColumnConfig;

	/**
	 * Create a new Chunker instance.
	 *
	 * @param {HTMLElement|Document} content - The DOM content to be paginated.
	 * @param {HTMLElement} [renderTo] - Optional container element to render pages into.
	 * @param {Object} [options={}] - Configuration options.
	 * @property {Object} hooks - Collection of lifecycle hooks.
	 * @property {Page[]} pages - Array of rendered pages.
	 * @property {number} total - Total number of pages rendered.
	 * @property {boolean} stopped - Whether rendering is currently stopped.
	 * @property {boolean} rendered - Whether rendering has completed.
	 * @property {Queue} q - Internal render queue.
	 * @property {HTMLElement|Document} content - The original content passed to the chunker.
	 * @property {Object} modifiedRules - Map of modified stylesheets during rendering.
	 * @property {number[]} charsPerBreak - Characters per page break for estimation.
	 * @property {number} maxChars - Estimated maximum characters per page.
	 */
	constructor(
		content?: HTMLElement | DocumentFragment | string,
		renderTo?: HTMLElement,
		options?: Record<string, unknown>,
	) {
		// this.preview = preview;

		this.settings = options || {};

		this.hooks = {} as ChunkerHooks;
		this.hooks.beforeParsed = new Hook(this);
		this.hooks.filter = new Hook(this);
		this.hooks.afterParsed = new Hook(this);
		this.hooks.beforePageLayout = new Hook(this);
		this.hooks.onPageLayout = new Hook(this);
		this.hooks.layout = new Hook(this);
		this.hooks.renderNode = new Hook(this);
		this.hooks.layoutNode = new Hook(this);
		this.hooks.onOverflow = new Hook(this);
		this.hooks.afterOverflowRemoved = new Hook(this);
		this.hooks.afterOverflowAdded = new Hook(this);
		this.hooks.onBreakToken = new Hook();
		this.hooks.beforeRenderResult = new Hook(this);
		this.hooks.afterPageLayout = new Hook(this);
		this.hooks.finalizePage = new Hook(this);
		this.hooks.afterRendered = new Hook(this);

		this.pages = [];
		this.total = 0;

		this.q = new Queue(this);
		this.stopped = false;
		this.rendered = false;

		this.content = content;

		this.modifiedRules = {};

		this.charsPerBreak = [];

		this.multicolSelectors = new Set();
		this.columnSpanSelectors = new Set();

		if (content) {
			this.flow(content, renderTo);
		}
	}

	/**
	 * Detects root-level multi-column configuration.
	 *
	 * Sources, in order of precedence:
	 * 1. `settings.rootColumns` ({ count: 2, ... }).
	 * 2. Column declarations on `body`/`html` captured from author CSS by
	 *    the Columns handler (which strips them from the sheet so the host
	 *    document is never itself turned into a multicol container).
	 * 3. The computed style of the content element when it is an
	 *    HTMLElement attached to the document.
	 * 4. The computed style of document.body (legacy fallback for CSS the
	 *    polisher did not process).
	 */
	detectRootColumns(
		content?: HTMLElement | DocumentFragment | string,
	): RootColumnConfig | undefined {
		const fromSettings = this.settings.rootColumns as
			| Partial<RootColumnConfig>
			| undefined;
		if (fromSettings && Number(fromSettings.count) > 1) {
			return {
				count: Math.floor(Number(fromSettings.count)),
				gap: fromSettings.gap,
				fill: fromSettings.fill,
				ruleColor: fromSettings.ruleColor,
				ruleStyle: fromSettings.ruleStyle,
				ruleWidth: fromSettings.ruleWidth,
			};
		}

		let el: Element | null = null;

		const fromCss = this.rootColumnsFromCss;
		if (fromCss && Number(fromCss.count) > 1) {
			return {
				count: Math.floor(Number(fromCss.count)),
				gap: fromCss.gap,
				fill: fromCss.fill,
				ruleColor: fromCss.ruleColor,
				ruleStyle: fromCss.ruleStyle,
				ruleWidth: fromCss.ruleWidth,
			};
		}

		if (content instanceof HTMLElement && content.isConnected) {
			el = content;
		} else if (typeof document !== "undefined") {
			el = document.body;
		}

		if (el) {
			const style = window.getComputedStyle(el);
			const count = parseInt(style.columnCount);
			if (count > 1) {
				const fill = style.columnFill as "auto" | "balance" | "balance-all";
				return {
					count,
					gap: style.columnGap !== "normal" ? style.columnGap : undefined,
					fill: fill === "auto" || fill === "balance" ? fill : undefined,
					ruleColor: style.columnRuleColor,
					ruleStyle: style.columnRuleStyle,
					ruleWidth: style.columnRuleWidth,
				};
			}
		}

		return undefined;
	}

	/**
	 * Sets up the page container and page template structure.
	 *
	 * @param {HTMLElement} renderTo - The DOM node to which pages should be rendered.
	 */
	setup(renderTo?: HTMLElement): void {
		this.pagesArea = document.createElement("div");
		this.pagesArea.classList.add("paged_pages");

		if (renderTo) {
			renderTo.appendChild(this.pagesArea);
		} else {
			document.querySelector("body")!.appendChild(this.pagesArea);
		}

		this.pageTemplate = document.createElement("template");
		this.pageTemplate.innerHTML = TEMPLATE;
	}

	/**
	 * Gathers and records rules that should be disabled during rendering.
	 */
	rulesToDisable: Array<string | Record<string, string>> = [
		"breakInside",
		"overflow",
		"overflowX",
		"overflowY",
	];

	recordRulesToDisable(): void {
		for (const sheet of Array.from(document.styleSheets) as CSSStyleSheet[]) {
			for (const rule of Array.from(sheet.cssRules)) {
				const styledRule = rule as CSSStyleRule;
				if (styledRule && styledRule.style) {
					const style = styledRule.style as CSSStyleDeclaration &
						Record<string, string>;
					for (const disable of this.rulesToDisable) {
						let skip = false;
						let attribName = disable as string;
						if (typeof disable == "object") {
							attribName = Object.keys(disable)[0];
							let value = disable[attribName];
							skip =
								!style[attribName] || style[attribName] !== value;
						} else {
							skip = !style[attribName];
						}
						if (!skip) {
							if (!this.modifiedRules[attribName]) {
								this.modifiedRules[attribName] = {};
							}
							if (!this.modifiedRules[attribName][style[attribName]]) {
								this.modifiedRules[attribName][style[attribName]] = [];
							}
							this.modifiedRules[attribName][style[attribName]].push(
								styledRule,
							);
						}
					}
				}
			}
		}
	}

	/**
	 * Disables specific CSS rules that may interfere with rendering.
	 *
	 * @param {HTMLElement} rendered - The rendered content container.
	 */
	disableRules(rendered: DocumentFragment | HTMLElement): void {
		for (const prop in this.modifiedRules) {
			for (const value in this.modifiedRules[prop]) {
				for (const rule of this.modifiedRules[prop][value]) {
					const style = rule.style as CSSStyleDeclaration &
						Record<string, string>;
					style[prop] = "";
					let nodes = rendered.querySelectorAll(rule.selectorText);
					nodes.forEach((node) => {
						let attribName =
							prop.substring(0, 1).toUpperCase() + prop.substring(1);
						(node as HTMLElement).dataset[`original${attribName}`] = value;
					});
				}
			}
		}
	}

	/**
	 * Re-enables the CSS rules that were previously disabled.
	 *
	 * @param {HTMLElement} rendered - The rendered content container.
	 */
	enableRules(rendered: DocumentFragment | HTMLElement): void {
		for (const prop in this.modifiedRules) {
			for (const value in this.modifiedRules[prop]) {
				for (const rule of this.modifiedRules[prop][value]) {
					const style = rule.style as CSSStyleDeclaration &
						Record<string, string>;
					style[prop] = value;
					let nodes = rendered.querySelectorAll(rule.selectorText);
					nodes.forEach((node) => {
						let attribName =
							prop.substring(0, 1).toUpperCase() + prop.substring(2);
						delete (node as HTMLElement).dataset[`original${attribName}`];
					});
				}
			}
		}
	}

	/**
	 * Starts the chunking and rendering process for the given content.
	 *
	 *
	 * @async
	 *
	 * @param {HTMLElement|Document} content - Content to be paginated.
	 * @param {HTMLElement} renderTo - Element to render into.
	 * @returns {Promise<Chunker>} - Returns itself once rendering is complete.
	 */
	async flow(
		content: HTMLElement | DocumentFragment | string | undefined,
		renderTo?: HTMLElement,
	): Promise<Chunker> {
		let parsed: DocumentFragment | Node;

		await this.hooks.beforeParsed.trigger(
			content as string | Node,
			this,
		);

		if (content) {
			this.recordRulesToDisable();
			this.disableRules(content as DocumentFragment | HTMLElement);
		}

		parsed = new ContentParser(content as string | Node) as unknown as
			DocumentFragment | Node;

		this.hooks.filter.triggerSync(parsed as DocumentFragment);

		this.source = parsed;
		this.breakToken = undefined;
		this.rootColumns = this.detectRootColumns(content);

		if (this.pagesArea && this.pageTemplate) {
			this.q.clear();
			this.removePages();
		} else {
			this.setup(renderTo);
		}

		this.emit("rendering", parsed);

		await this.hooks.afterParsed.trigger(parsed as DocumentFragment, this);

		await this.loadFonts();

		await this.loadImages(parsed);

		// The whole document is known at this point: prepare all of its
		// texts once, after fonts have loaded and with the fragment
		// temporarily attached so computed styles resolve. Text breaking
		// then runs on pure arithmetic for the rest of the flow.
		const debug = (globalThis as unknown as {
			__PAGED_DEBUG?: { domops?: boolean };
		}).__PAGED_DEBUG;
		if (this.settings.debugDomOps === true || debug?.domops) {
			installDomOperationCounters();
			resetDomOpStats();
		}
		resetPredictionCaches();
		parsed = prepareTextsEagerly(
			parsed as DocumentFragment,
			this.settings,
		) as DocumentFragment;
		this.source = parsed;

		let rendered = await this.render(parsed, this.breakToken);
		while (rendered.canceled) {
			this.start();
			rendered = await this.render(parsed, this.breakToken);
		}

		this.rendered = true;
		this.pagesArea!.style.setProperty("--paged-page-count", `${this.total}`);

		await this.hooks.afterRendered.trigger(this.pages, this);

		this.emit("rendered", this.pages);

		this.enableRules(content as DocumentFragment | HTMLElement);

		return this;
	}

	// oversetPages() {
	// 	let overset = [];
	// 	for (let i = 0; i < this.pages.length; i++) {
	// 		let page = this.pages[i];
	// 		if (page.overset) {
	// 			overset.push(page);
	// 			// page.overset = false;
	// 		}
	// 	}
	// 	return overset;
	// }
	//
	// async handleOverset(parsed) {
	// 	let overset = this.oversetPages();
	// 	if (overset.length) {
	// 		console.log("overset", overset);
	// 		let index = this.pages.indexOf(overset[0]) + 1;
	// 		console.log("INDEX", index);
	//
	// 		// Remove pages
	// 		// this.removePages(index);
	//
	// 		// await this.render(parsed, overset[0].overset);
	//
	// 		// return this.handleOverset(parsed);
	// 	}
	// }

	/**
	 * Renders the parsed html into paginated content and adds references (UUID data-ref attributes)
	 *
	 * @param {HTML} parsed - parsed html content with data-refs for later use
	 * @param {Element} startAt - HTML node to start rendering
	 * @returns Pages
	 */
	async render(
		parsed: DocumentFragment | Node,
		startAt?: BreakToken,
	): Promise<RenderStep> {
		let renderer = this.layout(parsed, startAt);

		let done: boolean | undefined = false;
		let result: RenderStep = { done: false, value: undefined };

		let loops = 0;
		while (!done) {
			result = (await this.q.enqueue(() => {
				return this.renderBudgeted(
					renderer,
					(this.settings.renderFrameBudget as number | undefined) ??
						12,
				);
			})) as RenderStep;
			done = result.done;
			if (MAX_LAYOUTS) {
				loops += 1;
				if (loops >= MAX_LAYOUTS) {
					this.stop();
					break;
				}
			}
		}

		return result;
	}

	/**
	 * Runs generator steps for up to a frame budget.
	 *
	 * The engine performs layout once per animation frame that touched the
	 * DOM, so stepping once per frame paid full style+layout+paint per
	 * page. Coalescing steps into time-boxed frames divides that cost by
	 * the number of pages completed per frame while keeping the UI live.
	 *
	 * @param {AsyncGenerator} renderer - The renderer iterator.
	 * @param {number} [budgetMs] - Wall-clock budget per animation frame.
	 * @returns {Promise<Object>} - Result of the last rendering step.
	 */
	async renderBudgeted(
		renderer: AsyncGenerator<BreakToken | undefined>,
		budgetMs = 12,
	): Promise<RenderStep> {
		const start = performance.now();
		let result: RenderStep = { done: false, value: undefined };
		do {
			if (this.stopped) {
				return { done: true, value: undefined, canceled: true };
			}
			result = await renderer.next();
			if (this.stopped) {
				return { done: true, value: undefined, canceled: true };
			}
		} while (!result.done && performance.now() - start < budgetMs);
		return result;
	}
	/**
	 * Resets the rendering state.
	 */
	start(): void {
		this.rendered = false;
		this.stopped = false;
	}

	/**
	 * Stop the rendering process.
	 */
	stop(): void {
		this.stopped = true;
		// this.q.clear();
	}
	/**
	 * Renders a chunk of content when the browser is idle.
	 *
	 * @param {AsyncGenerator} renderer - The renderer iterator.
	 * @returns {Promise<Object>} - Result of rendering.
	 */
	renderOnIdle(
		renderer: AsyncGenerator<BreakToken | undefined>,
	): Promise<RenderStep> {
		return new Promise((resolve) => {
			requestIdleCallback!(async () => {
				if (this.stopped) {
					return resolve({ done: true, value: undefined, canceled: true });
				}
				let result = await renderer.next();
				if (this.stopped) {
					resolve({ done: true, value: undefined, canceled: true });
				} else {
					resolve(result);
				}
			});
		});
	}
	/**
	 * Performs one asynchronous rendering step.
	 *
	 * @param {AsyncGenerator} renderer - The renderer iterator.
	 * @returns {Promise<Object>} - Result of rendering.
	 */
	async renderAsync(
		renderer: AsyncGenerator<BreakToken | undefined>,
	): Promise<RenderStep> {
		if (this.stopped) {
			return { done: true, value: undefined, canceled: true };
		}
		let result = await renderer.next();
		if (this.stopped) {
			return { done: true, value: undefined, canceled: true };
		} else {
			return result;
		}
	}

	/**
	 * Handling page breaks and adds new Pages if required
	 *
	 * @param {Element} node - breaking node
	 * @param {bool} force - force page break
	 * @returns {null}
	 */
	async handleBreaks(
		node: Node | undefined | null,
		force?: boolean,
	): Promise<void> {
		let currentPage = this.total + 1;
		let currentPosition = currentPage % 2 === 0 ? "left" : "right";
		// TODO: Recto and Verso should reverse for rtl languages
		let currentSide = currentPage % 2 === 0 ? "verso" : "recto";
		let previousBreakAfter: string | undefined;
		let breakBefore: string | undefined;
		let page: Page | undefined;

		if (currentPage === 1) {
			return;
		}

		if (
			node &&
			typeof (node as Element).dataset !== "undefined" &&
			typeof (node as Element).dataset.previousBreakAfter !== "undefined"
		) {
			previousBreakAfter = (node as Element).dataset.previousBreakAfter;
		}

		if (
			node &&
			typeof (node as Element).dataset !== "undefined" &&
			typeof (node as Element).dataset.breakBefore !== "undefined"
		) {
			breakBefore = (node as Element).dataset.breakBefore;
		}

		if (force) {
			page = this.addPage(true);
		} else if (
			previousBreakAfter &&
			(previousBreakAfter === "left" || previousBreakAfter === "right") &&
			previousBreakAfter !== currentPosition
		) {
			page = this.addPage(true);
		} else if (
			previousBreakAfter &&
			(previousBreakAfter === "verso" || previousBreakAfter === "recto") &&
			previousBreakAfter !== currentSide
		) {
			page = this.addPage(true);
		} else if (
			breakBefore &&
			(breakBefore === "left" || breakBefore === "right") &&
			breakBefore !== currentPosition
		) {
			page = this.addPage(true);
		} else if (
			breakBefore &&
			(breakBefore === "verso" || breakBefore === "recto") &&
			breakBefore !== currentSide
		) {
			page = this.addPage(true);
		}

		if (page) {
			await this.hooks.beforePageLayout.trigger(
				page,
				undefined,
				undefined,
				this,
			);
			this.emit("page", page);
			// await this.hooks.layout.trigger(page.element, page, undefined, this);
			await this.hooks.afterPageLayout.trigger(
				page.element!,
				page,
				undefined,
				this,
			);
			await this.hooks.finalizePage.trigger(
				page.element!,
				page,
				undefined,
				this,
			);
			this.emit("renderedPage", page);
		}
	}
	/**
	 * Generator that performs the layout step-by-step, yielding break tokens.
	 *
	 * @async
	 * @param {Document|HTMLElement} content - The parsed content.
	 * @param {Object} [startAt] - Optional starting break token.
	 * @yields {Object} - The current break token.
	 */
	async *layout(
		content: Node | string,
		startAt?: BreakToken,
	): AsyncGenerator<BreakToken | undefined, void, void> {
		let breakToken: BreakToken | false | undefined = startAt || false;
		let page: Page | undefined,
			prevPage: HTMLElement | undefined,
			prevNumPages: number;

		while (
			breakToken !== undefined &&
			(MAX_PAGES ? this.total < MAX_PAGES : true)
		) {
			let range: Range | undefined;
			if (page && page.wrapper && page.wrapper.childElementCount) {
				range = document.createRange();
				range.selectNode(page.wrapper.childNodes[0]);
				range.setEndAfter(page.wrapper.lastChild!);
			}

			let addedExtra = false;
			let emptyBody = !range || !range.getBoundingClientRect().height;
			let emptyFootnotes =
				!page ||
				!page.footnotesArea!.firstElementChild ||
				!page.footnotesArea!.firstElementChild.childElementCount ||
				!page.footnotesArea!.firstElementChild.firstElementChild!.getBoundingClientRect()
					.height;
			let emptyPage = emptyBody && emptyFootnotes;

			prevNumPages = this.total;

			if (!page || !emptyPage) {
				if (breakToken) {
					if (breakToken.overflow.length && breakToken.overflow[0].node) {
						// Overflow.
						await this.handleBreaks(breakToken.overflow[0].node);
					} else {
						await this.handleBreaks(breakToken.node);
					}
				} else {
					await this.handleBreaks((content as Node).firstChild);
				}
			}

			addedExtra = this.total != prevNumPages;

			// Don't add a page if we have a forced break now and we just
			// did a break due to overflow but have nothing displayed on
			// the current page, unless there's overflow and we're finished.
			if (!page || addedExtra || !emptyPage) {
				this.addPage();
			}

			page = this.pages[this.total - 1];

			await this.hooks.beforePageLayout.trigger(
				page,
				content,
				breakToken as BreakToken | undefined,
				this,
			);
			this.emit("page", page);

			// Layout content in the page, starting from the breakToken.
			breakToken = await page.layout(
				content as DocumentFragment,
				breakToken as BreakToken | undefined,
				prevPage as unknown as Page,
			);

			if (!breakToken && page.zeroProgress && page.isBlank()) {
				// Pagination stopped because no further progress was possible
				// (e.g. the content cannot fit anywhere). The page absorbed
				// nothing displayable, so drop it instead of emitting an empty
				// trailing page.
				this.removePages(this.pages.indexOf(page));
				break;
			}

			await this.hooks.afterPageLayout.trigger(
				page.element!,
				page,
				breakToken,
				this,
			);
			await this.hooks.finalizePage.trigger(
				page.element!,
				page,
				undefined,
				this,
			);
			this.emit("renderedPage", page);

			prevPage = page.wrapper;

			this.recoredCharLength(page.wrapper!.textContent!.length);

			yield breakToken as BreakToken | undefined;
		}
	}
	/**
	 * Records the number of characters per page for average calculation.
	 *
	 * @param {number} length - Number of characters on the page.
	 */
	recoredCharLength(length: number): void {
		if (length === 0) {
			return;
		}

		this.charsPerBreak.push(length);

		// Keep the length of the last few breaks
		if (this.charsPerBreak.length > 4) {
			this.charsPerBreak.shift();
		}

		this.maxChars =
			this.charsPerBreak.reduce((a, b) => a + b, 0) / this.charsPerBreak.length;
	}

	/**
	 * Removes rendered pages starting from the specified index.
	 *
	 * @param {number} [fromIndex=0] - Index to start removing pages from.
	 */
	removePages(fromIndex = 0): void {
		if (fromIndex >= this.pages.length) {
			return;
		}

		// Remove pages
		for (let i = fromIndex; i < this.pages.length; i++) {
			this.pages[i].destroy();
		}

		if (fromIndex > 0) {
			this.pages.splice(fromIndex);
		} else {
			this.pages = [];
		}

		this.total = this.pages.length;
	}
	/**
	 * Per-page settings snapshot, extended with the current multi-column
	 * configuration so that Page and Layout can set up fragmentainers.
	 */
	pageSettings(): Record<string, unknown> {
		return {
			...this.settings,
			rootColumns: this.rootColumns,
			multicolSelectors: this.multicolSelectors,
			columnSpanSelectors: this.columnSpanSelectors,
		};
	}

	/**
	 * Adds a new page to the render flow.
	 *
	 * @param {boolean} [blank=false] - Whether to add a blank page.
	 * @returns {Page} - The newly added Page instance.
	 */
	addPage(blank?: boolean): Page {
		let lastPage = this.pages[this.pages.length - 1];
		// Create a new page from the template
		let page = new Page(
			this.pagesArea!,
			this.pageTemplate!,
			blank,
			this.hooks,
			this.pageSettings(),
		);

		this.pages.push(page);

		// Create the pages
		page.create(undefined, lastPage && lastPage.element);

		page.index(this.total);

		if (!blank) {
			// Listen for page overflow
			page.onOverflow((overflowToken) => {
				console.warn("overflow on", page.id, overflowToken);

				// Only reflow while rendering
				if (this.rendered) {
					return;
				}

				let index = this.pages.indexOf(page) + 1;

				// Stop the rendering
				this.stop();

				// Set the breakToken to resume at
				this.breakToken = overflowToken;

				// Remove pages
				this.removePages(index);

				if ((this.rendered as boolean) === true) {
					this.rendered = false;

					this.q.enqueue(async () => {
						this.start();

						await this.render(this.source!, this.breakToken);

						this.rendered = true;
					});
				}
			});

			page.onUnderflow((overflowToken) => {
				// console.log("underflow on", page.id, overflowToken);
				// page.append(this.source, overflowToken);
			});
		}

		this.total = this.pages.length;

		return page;
	}
	/*
	insertPage(index, blank) {
		let lastPage = this.pages[index];
		// Create a new page from the template
		let page = new Page(this.pagesArea, this.pageTemplate, blank, this.hooks);

		let total = this.pages.splice(index, 0, page);

		// Create the pages
		page.create(undefined, lastPage && lastPage.element);

		page.index(index + 1);

		for (let i = index + 2; i < this.pages.length; i++) {
			this.pages[i].index(i);
		}

		if (!blank) {
			// Listen for page overflow
			page.onOverflow((overflowToken) => {
				if (total < this.pages.length) {
					this.pages[total].layout(this.source, overflowToken);
				} else {
					let newPage = this.addPage();
					newPage.layout(this.source, overflowToken);
				}
			});

			page.onUnderflow(() => {
				// console.log("underflow on", page.id);
			});
		}

		this.total += 1;

		return page;
	}
	*/
	/**
	 * Clones an existing page and appends it to the document.
	 *
	 * @async
	 * @param {Page} originalPage - The page to clone.
	 */
	async clonePage(originalPage: Page): Promise<void> {
		let lastPage = this.pages[this.pages.length - 1];

		let page = new Page(
			this.pagesArea!,
			this.pageTemplate!,
			false,
			this.hooks,
			this.pageSettings(),
		);

		this.pages.push(page);

		// Create the pages
		page.create(undefined, lastPage && lastPage.element);

		page.index(this.total);

		await this.hooks.beforePageLayout.trigger(page, undefined, undefined, this);
		this.emit("page", page);

		for (const className of originalPage.element!.classList) {
			if (
				className !== "paged_left_page" &&
				className !== "paged_right_page"
			) {
				page.element!.classList.add(className);
			}
		}

		await this.hooks.afterPageLayout.trigger(
			page.element!,
			page,
			undefined,
			this,
		);
		await this.hooks.finalizePage.trigger(page.element!, page, undefined, this);
		this.emit("renderedPage", page);
	}
	/**
	 * Waits for all fonts to load before rendering starts.
	 *
	 * Every registered face is loaded explicitly, then `document.fonts.ready`
	 * is awaited as a browser-wide barrier. Because styles processed during
	 * loading can register further faces, the load/barrier cycle repeats
	 * until a pass finds nothing left unloaded (bounded by FONT_LOAD_PASSES).
	 * This keeps on-screen text breaking aligned with the fonts the PDF
	 * emitter later measures against.
	 *
	 * @returns {Promise<string[]>} - A promise resolving to a list of font families loaded.
	 */
	async loadFonts(): Promise<string[]> {
		const families: string[] = [];
		const fontSet = (document.fonts || []) as unknown as FontFaceSet;
		if (!fontSet || typeof fontSet.forEach !== "function") {
			return families;
		}

		for (let pass = 0; pass < FONT_LOAD_PASSES; pass++) {
			let sawUnloaded = false;
			const pending: Promise<void>[] = [];
			fontSet.forEach((fontFace: FontFace) => {
				if (fontFace.status === "unloaded") {
					sawUnloaded = true;
					pending.push(
						fontFace.load().then(
							() => {
								families.push(fontFace.family);
							},
							() => {
								console.warn("Failed to preload font-family:", fontFace.family);
							},
						),
					);
				}
			});
			await Promise.all(pending);
			if (typeof document !== "undefined" && document.fonts) {
				await document.fonts.ready;
			}
			if (!sawUnloaded) {
				break;
			}
		}
		return families;
	}

	/**
	 * Preloads every source image before pagination starts.
	 *
	 * Float placement and overflow detection read element geometry while
	 * content is appended — earlier than the per-page image waits run — so
	 * images must already have their final boxes by then. Loading the URLs
	 * up front warms the cache so cloned page images complete immediately.
	 *
	 * @param {DocumentFragment|Node} parsed - The parsed source content.
	 * @returns {Promise<void>} - Resolves when all images settled (loaded,
	 * failed, or timed out); failures only warn.
	 */
	async loadImages(parsed: DocumentFragment | Node): Promise<void> {
		const root = parsed as ParentNode;
		if (
			typeof document === "undefined" ||
			!root ||
			typeof root.querySelectorAll !== "function"
		) {
			return;
		}
		const images = Array.from(root.querySelectorAll("img"));
		await Promise.all(images.map((img) => this.preloadImage(img)));
	}

	/**
	 * Awaits a single image's data, bounded by IMAGE_PRELOAD_TIMEOUT_MS so a
	 * hanging request cannot stall rendering forever. Also forces eager
	 * loading: clones of the node keep that attribute and never measure
	 * against an empty lazy box.
	 *
	 * @param {HTMLImageElement} img - The image to preload.
	 * @returns {Promise<void>} - Resolves on load, error, or timeout.
	 */
	private preloadImage(img: HTMLImageElement): Promise<void> {
		img.loading = "eager";
		return new Promise((resolve) => {
			// Images in a detached DocumentFragment may not have started
			// loading yet (complete is true with naturalWidth === 0). Use a
			// dedicated loader so the browser actually fetches and decodes the
			// data before pagination starts; clones inserted during layout then
			// resolve from cache immediately.
			if (img.complete && img.naturalWidth > 0) {
				resolve();
				return;
			}
			const finish = () => resolve();
			const timeout = setTimeout(finish, IMAGE_PRELOAD_TIMEOUT_MS);
			const loader = new Image();
			loader.addEventListener(
				"load",
				() => {
					clearTimeout(timeout);
					finish();
				},
				{ once: true },
			);
			loader.addEventListener(
				"error",
				() => {
					clearTimeout(timeout);
					finish();
				},
				{ once: true },
			);
			loader.src = img.src;
		});
	}
	/**
	 * Cleans up and removes all rendered elements and templates.
	 */
	destroy(): void {
		this.pagesArea!.remove();
		this.pageTemplate!.remove();
	}
}

EventEmitter(Chunker.prototype);

interface Chunker extends PagedEventEmitter {}

export default Chunker;
