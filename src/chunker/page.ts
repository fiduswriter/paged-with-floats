import Layout from "./layout.js";
import EventEmitter from "event-emitter";
import BreakToken from "./breaktoken.js";
import type RenderResult from "./renderresult.js";
import type { ChunkerHooks } from "./chunker.js";
import type { PagedEventEmitter } from "../types/emitter.js";

/**
 * Represents a single page in a paginated document.
 * Handles rendering, layout, overflow detection, and DOM interactions.
 *
 * @class
 */
class Page {
	pagesArea: HTMLElement;
	pageTemplate: HTMLTemplateElement;
	blank: boolean | undefined;
	width?: number;
	height?: number;
	hooks: ChunkerHooks;
	settings: Record<string, unknown>;
	element?: HTMLDivElement;
	pagebox?: HTMLElement | null;
	area?: HTMLElement;
	wrapper?: HTMLDivElement;
	footnotesArea?: HTMLElement | null;
	floatTopArea?: Element | null;
	floatBottomArea?: Element | null;
	startToken?: BreakToken;
	endToken?: BreakToken;
	layoutMethod?: Layout;
	position?: number;
	id?: string;
	name?: string;
	listening?: boolean;
	ro?: ResizeObserver;
	_onOverflow?: (token: BreakToken) => void;
	_onUnderflow?: (token: BreakToken) => void;
	_checkOverflowAfterResize?: () => void;
	_onScroll?: () => void;

	/**
	 * Creates an instance of Page.
	 *
	 * @param {HTMLElement} pagesArea - The container element for all pages.
	 * @param {HTMLTemplateElement} pageTemplate - Template for creating new pages.
	 * @param {boolean} blank - Indicates if this is a blank page.
	 * @param {Object} hooks - Hook functions for custom behavior.
	 * @param {Object} options - Additional layout or rendering options.
	 */
	constructor(
		pagesArea: HTMLElement,
		pageTemplate: HTMLTemplateElement,
		blank: boolean | undefined,
		hooks: ChunkerHooks,
		options?: Record<string, unknown>,
	) {
		this.pagesArea = pagesArea;
		this.pageTemplate = pageTemplate;
		this.blank = blank;

		this.width = undefined;
		this.height = undefined;

		this.hooks = hooks;
		this.settings = options || {};
	}

	/**
	 * Creates a new page element from the template and inserts it into the DOM.
	 *
	 * @param {HTMLTemplateElement} template - The template to use for page creation.
	 * @param {HTMLElement} [after] - Optional reference element to insert after.
	 * @returns {HTMLElement} The newly created page element.
	 */
	create(template?: HTMLTemplateElement, after?: HTMLElement): HTMLDivElement {
		let clone = document.importNode(this.pageTemplate.content, true);

		let page: HTMLDivElement, index: number;
		if (after) {
			this.pagesArea.insertBefore(clone, after.nextElementSibling);
			index = Array.prototype.indexOf.call(
				this.pagesArea.children,
				after.nextElementSibling,
			);
			page = this.pagesArea.children[index] as HTMLDivElement;
		} else {
			this.pagesArea.appendChild(clone);
			page = this.pagesArea.lastChild as HTMLDivElement;
		}

		let pagebox = page.querySelector(".paged_pagebox") as HTMLElement | null;
		let area = page.querySelector(".paged_page_content") as HTMLElement;
		let footnotesArea = page.querySelector(
			".paged_footnote_area",
		) as HTMLElement | null;
		let floatTopArea = page.querySelector(".paged_float_top") as Element | null;
		let floatBottomArea = page.querySelector(
			".paged_float_bottom",
		) as Element | null;

		let size = area.getBoundingClientRect();

		area.style.columnWidth = Math.round(size.width) + "px";
		area.style.columnGap =
			"calc(var(--paged-margin-right) + var(--paged-margin-left) + var(--paged-bleed-right) + var(--paged-bleed-left) + var(--paged-column-gap-offset))";

		this.width = Math.round(size.width);
		this.height = Math.round(size.height);

		this.element = page;
		this.pagebox = pagebox;
		this.area = area;
		this.footnotesArea = footnotesArea;
		this.floatTopArea = floatTopArea;
		this.floatBottomArea = floatBottomArea;

		return page;
	}

	/**
	 * Creates a wrapper element inside the page's content area.
	 *
	 * When a root-level multicol configuration is present (via settings
	 * `rootColumns`), the wrapper becomes the fragmentainer: the browser
	 * fragments flow content into N visible columns and any content beyond
	 * the last column spills into an additional off-page column, which the
	 * layout stage detects as overflow.
	 *
	 * @returns {HTMLElement} The wrapper element.
	 */
	createWrapper(): HTMLDivElement {
		let wrapper = document.createElement("div");

		const rootColumns = this.settings.rootColumns as
			| { count: number; gap?: string; ruleColor?: string; ruleStyle?: string; ruleWidth?: string }
			| undefined;
		if (rootColumns && rootColumns.count > 1) {
			wrapper.style.columnCount = String(rootColumns.count);
			wrapper.style.columnFill = "auto";
			wrapper.style.columnGap =
				rootColumns.gap !== undefined ? rootColumns.gap : "normal";
			if (rootColumns.ruleWidth) {
				wrapper.style.columnRuleStyle = rootColumns.ruleStyle || "solid";
				wrapper.style.columnRuleWidth = rootColumns.ruleWidth;
				if (rootColumns.ruleColor) {
					wrapper.style.columnRuleColor = rootColumns.ruleColor;
				}
			}
		}

		this.area!.insertBefore(wrapper, this.floatBottomArea!);
		this.wrapper = wrapper;
		return wrapper;
	}

	/**
	 * Sets the page index and updates relevant attributes and classes.
	 *
	 * @param {number} pgnum - The page index number (0-based).
	 */
	index(pgnum: number): void {
		this.position = pgnum;

		let page = this.element!;
		let index = pgnum + 1;
		let id = `page-${index}`;

		this.id = id;
		page.dataset.pageNumber = `${index}`;
		page.setAttribute("id", id);

		if (this.name) {
			page.classList.add("paged_" + this.name + "_page");
		}

		if (this.blank) {
			page.classList.add("paged_blank_page");
		}

		if (pgnum === 0) {
			page.classList.add("paged_first_page");
		}

		if (pgnum % 2 !== 1) {
			page.classList.remove("paged_left_page");
			page.classList.add("paged_right_page");
		} else {
			page.classList.remove("paged_right_page");
			page.classList.add("paged_left_page");
		}
	}

	/*
	size(width, height) {
		if (width === this.width && height === this.height) {
			return;
		}
		this.width = width;
		this.height = height;

		this.element.style.width = Math.round(width) + "px";
		this.element.style.height = Math.round(height) + "px";
		this.element.style.columnWidth = Math.round(width) + "px";
	}
	*/

	/**
	 * Start to layout page
	 *
	 * @param {HTML} contents - HTML content
	 * @param {BreakToken} breakToken - Previous Breaktoken
	 * @param {Page} prevPage - Previous Page
	 * @returns {BreakToken | null} - Null if breaktoken is equal to previous one
	 */
	async layout(
		contents: DocumentFragment,
		breakToken: BreakToken | undefined,
		prevPage?: Page,
	): Promise<BreakToken | undefined> {
		this.clear();

		this.startToken = breakToken;

		this.layoutMethod = new Layout(this.area!, this.hooks, this.settings);

		let renderResult: RenderResult = await this.layoutMethod.renderTo(
			this.wrapper!,
			contents,
			breakToken,
			prevPage as unknown as HTMLElement,
		);
		let newBreakToken = renderResult.breakToken as BreakToken | undefined;

		if (breakToken && newBreakToken && breakToken.equals(newBreakToken)) {
			// Zero progress this page: pagination would loop forever, so it
			// stops here. Diagnosable via `window.__PAGED_DEBUG = { stops: true }`.
			const debug = (globalThis as unknown as {
				__PAGED_DEBUG?: { stops?: boolean };
			}).__PAGED_DEBUG;
			if (debug?.stops) {
				console.warn(
					"[paged-with-floats] zero-progress page; token:",
					JSON.stringify({
						nodeText: breakToken.node.textContent?.slice(0, 60),
						offset: breakToken.overflow[0]?.offset,
						overflowNodeText: (breakToken.overflow[0]?.node as Text | undefined)
							?.textContent?.slice(0, 60),
					}),
				);
			}
			return;
		}

		this.addListeners(contents);

		this.endToken = newBreakToken;

		return newBreakToken;
	}

	/**
	 * Appends content to the existing layout using the current layout method.
	 *
	 * @async
	 * @param {DocumentFragment} contents - The contents to append.
	 * @param {Object} breakToken - The token to continue rendering from.
	 * @returns {Promise<Object>} A new breakToken after rendering.
	 */
	async append(
		contents: DocumentFragment,
		breakToken: BreakToken | undefined,
	): Promise<BreakToken | undefined> {
		if (!this.layoutMethod) {
			return this.layout(contents, breakToken);
		}

		let renderResult: RenderResult = await this.layoutMethod.renderTo(
			this.wrapper!,
			contents,
			breakToken,
		);
		let newBreakToken = renderResult.breakToken as BreakToken | undefined;

		this.endToken = newBreakToken;

		return newBreakToken;
	}

	/**
	 * Finds a DOM element by its `data-ref` attribute in a list of elements.
	 *
	 * @param {string} ref - The reference string to look for.
	 * @param {HTMLElement[]} entries - A list of elements to search.
	 * @returns {HTMLElement|undefined} The matching element, if found.
	 */
	getByParent(ref: string, entries: HTMLElement[]): HTMLElement | undefined {
		for (let i = 0; i < entries.length; i++) {
			if (entries[i].dataset.ref === ref) {
				return entries[i];
			}
		}
	}

	/**
	 * Registers a callback to run when content overflows the page.
	 *
	 * @param {Function} func - The overflow callback function.
	 */
	onOverflow(func: (token: BreakToken) => void): void {
		this._onOverflow = func;
	}

	/**
	 * Registers a callback to run when content underflows the page.
	 *
	 * @param {Function} func - The underflow callback function.
	 */
	onUnderflow(func: (token: BreakToken) => void): void {
		this._onUnderflow = func;
	}

	/**
	 * Clears the wrapper and listeners, resetting the layout state.
	 */
	clear(): void {
		this.removeListeners();
		this.wrapper && this.wrapper.remove();
		this.createWrapper();
	}

	/**
	 * Adds event listeners for scroll and resize to monitor overflows.
	 *
	 * @param {DocumentFragment} contents - The content being rendered (used in resize checks).
	 * @returns {boolean} True if listeners were added.
	 */
	addListeners(contents: DocumentFragment): boolean {
		if (typeof ResizeObserver !== "undefined") {
			this.addResizeObserver(contents);
		} else {
			this._checkOverflowAfterResize = this.checkOverflowAfterResize.bind(
				this,
				contents,
			);
			this.element!.addEventListener(
				"overflow",
				this._checkOverflowAfterResize,
				false,
			);
			this.element!.addEventListener(
				"underflow",
				this._checkOverflowAfterResize,
				false,
			);
		}

		this._onScroll = () => {
			if (this.listening) {
				this.element!.scrollLeft = 0;
			}
		};

		this.element!.addEventListener("scroll", this._onScroll);
		this.listening = true;

		return true;
	}

	/**
	 * Removes event listeners related to overflow and resizing.
	 */
	removeListeners(): void {
		this.listening = false;

		if (typeof ResizeObserver !== "undefined" && this.ro) {
			this.ro.disconnect();
		} else if (this.element) {
			this.element.removeEventListener(
				"overflow",
				this._checkOverflowAfterResize!,
				false,
			);
			this.element.removeEventListener(
				"underflow",
				this._checkOverflowAfterResize!,
				false,
			);
		}

		this.element && this.element.removeEventListener("scroll", this._onScroll!);
	}

	/**
	 * Adds a ResizeObserver to monitor wrapper size changes.
	 *
	 * @param {DocumentFragment} contents - The contents being observed for overflow changes.
	 */
	addResizeObserver(contents: DocumentFragment): void {
		let wrapper = this.wrapper!;
		let prevHeight = wrapper.getBoundingClientRect().height;

		this.ro = new ResizeObserver((entries) => {
			if (!this.listening) return;

			requestAnimationFrame(() => {
				for (let entry of entries) {
					const cr = entry.contentRect;

					if (cr.height > prevHeight) {
						this.checkOverflowAfterResize(contents);
						prevHeight = wrapper.getBoundingClientRect().height;
					} else if (cr.height < prevHeight) {
						this.checkUnderflowAfterResize(contents);
						prevHeight = cr.height;
					}
				}
			});
		});

		this.ro.observe(wrapper);
	}

	/**
	 * Checks if the page content has overflowed after a resize.
	 *
	 * @param {DocumentFragment} contents - The content being checked.
	 */
	checkOverflowAfterResize(contents: DocumentFragment): void {
		if (!this.listening || !this.layoutMethod) return;

		let newBreakToken = this.layoutMethod.findBreakToken(
			this.wrapper!,
			contents,
			undefined,
			this.startToken,
		);

		if (newBreakToken) {
			this.endToken = newBreakToken as BreakToken;
			this._onOverflow && this._onOverflow(newBreakToken as BreakToken);
		}
	}

	/**
	 * Checks if the page content has underflowed (e.g., content was removed).
	 *
	 * @param {DocumentFragment} contents - The content being checked.
	 */
	checkUnderflowAfterResize(contents: DocumentFragment): void {
		if (!this.listening || !this.layoutMethod) return;

		let endToken = this.layoutMethod.findEndToken(this.wrapper!, contents);

		if (endToken) {
			this._onUnderflow && this._onUnderflow(endToken as BreakToken);
		}
	}

	/**
	 * Cleans up the page, removing all DOM elements and listeners.
	 */
	destroy(): void {
		this.removeListeners();

		this.element!.remove();

		this.element = undefined;
		this.wrapper = undefined;
	}
}

// Add event emitter capabilities
EventEmitter(Page.prototype);

interface Page extends PagedEventEmitter {}

export default Page;
