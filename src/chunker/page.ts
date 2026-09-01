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
	/** Set when a page made zero layout progress; the chunker may drop it. */
	zeroProgress?: boolean;
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

		let size = area.getBoundingClientRect();

		// Single-column pages: the content area is a single-column multicol
		// with an off-page spill column, so the flow wrapper and the top
		// float container stack as multicol items — content is pushed below
		// top floats and any overflow spills into the hidden column where
		// the layout stage detects it. Manual-columns pages handle floats
		// inside the flow host and must not fragment it.
		const rootColumns = this.settings.rootColumns as
			| { count: number; gap?: string; ruleColor?: string; ruleStyle?: string; ruleWidth?: string }
			| undefined;
		if (!(rootColumns && rootColumns.count > 1)) {
			area.style.columnWidth = Math.round(size.width) + "px";
			area.style.columnGap =
				"calc(var(--paged-margin-right) + var(--paged-margin-left) + var(--paged-bleed-right) + var(--paged-bleed-left) + var(--paged-column-gap-offset))";
		}

		this.width = Math.round(size.width);
		this.height = Math.round(size.height);

		this.element = page;
		this.pagebox = pagebox;
		this.area = area;
		this.footnotesArea = footnotesArea;
		this.floatTopArea = page.querySelector(
			".paged_float_top",
		) as HTMLElement | null;
		this.floatBottomArea = page.querySelector(
			".paged_float_bottom",
		) as HTMLElement | null;

		// Build the flow host (with float containers) right away so hooks
		// that run before layout (e.g. placing deferred floats) find them;
		// layout()/clear() recreates it as needed.
		this.createWrapper();

		return page;
	}

	/**
	 * Creates a wrapper element inside the page's content area.
	 *
	 * Single-column pages keep the classic structure: a plain wrapper
	 * between the template's float containers. Root-level multicol pages
	 * use a *flow host* instead: the float containers move inside it and N
	 * `.paged_column` boxes are built between them. Columns are cut and
	 * positioned by the layout engine rather than the browser's
	 * `column-count`, so measurement always matches the final rendering.
	 *
	 * @returns {HTMLElement} The wrapper element.
	 */
	createWrapper(): HTMLDivElement {
		let wrapper = document.createElement("div");
		wrapper.classList.add("paged_flow");

		const rootColumns = this.settings.rootColumns as
			| { count: number; gap?: string; ruleColor?: string; ruleStyle?: string; ruleWidth?: string }
			| undefined;
		const useManualColumns = !!(rootColumns && rootColumns.count > 1);

		if (useManualColumns) {
			// Move the template's float containers inside the flow host so
			// the column boxes start below top floats and above bottom
			// floats without relying on the outer content area fragmenting.
			if (this.floatTopArea) {
				wrapper.appendChild(this.floatTopArea);
			} else {
				let floatTopArea = document.createElement("div");
				floatTopArea.classList.add("paged_float_top");
				wrapper.appendChild(floatTopArea);
				this.floatTopArea = floatTopArea;
			}
			this.buildManualColumns(wrapper, rootColumns);
			if (this.floatBottomArea) {
				wrapper.appendChild(this.floatBottomArea);
			} else {
				let floatBottomArea = document.createElement("div");
				floatBottomArea.classList.add("paged_float_bottom");
				wrapper.appendChild(floatBottomArea);
				this.floatBottomArea = floatBottomArea;
			}
			this.area!.appendChild(wrapper);
		} else {
			// Single-column: classic plain wrapper between the float
			// containers (which stay direct children of the content area).
			this.area!.insertBefore(wrapper, this.floatBottomArea!);
		}

		this.wrapper = wrapper;
		return wrapper;
	}

	/**
	 * Populates the flow host with explicit column boxes.
	 *
	 * Each column is a plain block sized to `calc((100% - (N-1)*gap) / N)`
	 * and laid out in a flex row; the engine fills them sequentially. The
	 * host keeps `height: inherit` so the outer content area (and the page
	 * float containers above it) fragment exactly as before.
	 *
	 * @param {HTMLDivElement} wrapper - The flow host.
	 * @param {Object} rootColumns - Root column configuration.
	 * @returns {void}
	 */
	private buildManualColumns(
		wrapper: HTMLDivElement,
		rootColumns: { count: number; gap?: string; fill?: "auto" | "balance"; ruleColor?: string; ruleStyle?: string; ruleWidth?: string },
	): void {
		const count = Math.floor(rootColumns.count);
		const gap =
			rootColumns.gap !== undefined && rootColumns.gap !== "normal"
				? rootColumns.gap
				: "1em";
		const fill = rootColumns.fill || "balance";

		wrapper.dataset.rootColumns = String(count);
		wrapper.dataset.rootColumnFill = fill;

		const columnsHost = document.createElement("div");
		columnsHost.classList.add("paged_columns");
		columnsHost.style.gap = gap;
		columnsHost.dataset.pagedColumnFill = fill;

		for (let i = 0; i < count; i++) {
			const column = document.createElement("div");
			column.classList.add("paged_column");
			column.dataset.pagedColumn = String(i);
			column.style.width = `calc((100% - ${count - 1} * ${gap}) / ${count})`;
			if (i > 0 && rootColumns.ruleWidth) {
				column.style.borderLeft =
					`${rootColumns.ruleWidth} ${rootColumns.ruleStyle || "solid"}` +
					(rootColumns.ruleColor ? ` ${rootColumns.ruleColor}` : "");
			}
			columnsHost.appendChild(column);
		}

		wrapper.appendChild(columnsHost);
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
			page.classList.remove("paged_left_page", "paged_verso_page");
			page.classList.add("paged_right_page", "paged_recto_page");
		} else {
			page.classList.remove("paged_right_page", "paged_recto_page");
			page.classList.add("paged_left_page", "paged_verso_page");
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
	 * Marks or unmarks this page as the one currently being laid out.
	 *
	 * While active, `content-visibility: visible` is forced so every
	 * geometry read during pagination sees real boxes — even when consumer
	 * CSS keeps off-screen pages skipped (e.g. demos injecting
	 * `content-visibility: auto`, which would otherwise make word rects,
	 * scrollWidth and friends read as placeholders for pages near the
	 * viewport threshold). The inline override is removed afterwards so
	 * author/demo rules apply again to the finished page.
	 *
	 * @param {boolean} active - Whether layout on this page is running.
	 */
	setLayoutActive(active: boolean): void {
		const el = this.element;
		if (!el) {
			return;
		}
		if (active) {
			el.setAttribute("data-paged-active", "true");
			el.style.setProperty("content-visibility", "visible");
			this.invalidateActiveSize();
		} else {
			el.removeAttribute("data-paged-active");
			el.style.removeProperty("content-visibility");
		}
	}

	/**
	 * Drops cached sizing state that depended on skipped layout while the
	 * page was inactive (placeholder intrinsic size), forcing fresh
	 * measurement once contents are forced visible again.
	 */
	private invalidateActiveSize(): void {
		this.width = undefined;
		this.height = undefined;
	}

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

		this.setLayoutActive(true);

		this.startToken = breakToken;

		this.layoutMethod = new Layout(this.area!, this.hooks, this.settings);

		let renderResult: RenderResult = await this.layoutMethod.renderTo(
			this.wrapper!,
			contents,
			breakToken,
			prevPage as unknown as HTMLElement,
		);
		let newBreakToken = renderResult.breakToken as BreakToken | undefined;

		this.setLayoutActive(false);

		if (breakToken && newBreakToken && breakToken.equals(newBreakToken)) {
			// Zero progress this page: pagination would loop forever, so it
			// stops here. Diagnosable via `window.__PAGED_DEBUG = { stops: true }`.
			this.zeroProgress = true;
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

		if (
			!newBreakToken &&
			breakToken &&
			breakToken.isFinished() &&
			this.isBlank()
		) {
			// The incoming token was already finished, so nothing could be
			// laid out here; this page exists only because pagination needs a
			// place to stop. Treated like a zero-progress page so the chunker
			// can drop it.
			this.zeroProgress = true;
		}

		this.addListeners(contents);

		this.endToken = newBreakToken;

		return newBreakToken;
	}

	/**
	 * Whether the page's flow wrapper holds no displayable content.
	 *
	 * Float scaffolding (top/bottom float containers, spacers) and
	 * undisplayed nodes don't count as content.
	 *
	 * @returns {boolean} True when the flow wrapper is empty or holds only
	 *   invisible scaffolding.
	 */
	isBlank(): boolean {
		const wrapper = this.wrapper;
		if (!wrapper) {
			return true;
		}
		return !Array.from(wrapper.children).some((child) => {
			if (!(child instanceof HTMLElement)) {
				return true;
			}
			if (child.dataset.undisplayed) {
				return false;
			}
			return (
				!child.classList.contains("paged_float_top") &&
				!child.classList.contains("paged_float_bottom") &&
				!child.classList.contains("paged_float_spacer")
			);
		});
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

		this.setLayoutActive(true);

		let renderResult: RenderResult = await this.layoutMethod.renderTo(
			this.wrapper!,
			contents,
			breakToken,
		);
		let newBreakToken = renderResult.breakToken as BreakToken | undefined;

		this.setLayoutActive(false);

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
	 *
	 * For manual-columns pages the flow host and its float containers are
	 * preserved (floats placed before layout must survive), while content
	 * and column rows are removed and the columns rebuilt. Single-column
	 * pages keep the classic full recreate.
	 */
	clear(): void {
		this.removeListeners();

		const rootColumns = this.settings.rootColumns as
			| { count: number; gap?: string; ruleColor?: string; ruleStyle?: string; ruleWidth?: string }
			| undefined;
		const useManualColumns = !!(rootColumns && rootColumns.count > 1);

		if (!useManualColumns) {
			this.wrapper && this.wrapper.remove();
			this.createWrapper();
			return;
		}

		if (!this.wrapper) {
			this.createWrapper();
			return;
		}

		Array.from(this.wrapper.children).forEach((child) => {
			if (
				!(child instanceof HTMLElement) ||
				(!child.classList.contains("paged_float_top") &&
					!child.classList.contains("paged_float_bottom"))
			) {
				child.remove();
			}
		});

		this.buildManualColumns(this.wrapper, rootColumns);
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
		this.setLayoutActive(false);

		this.element!.remove();

		this.element = undefined;
		this.wrapper = undefined;
	}
}

// Add event emitter capabilities
EventEmitter(Page.prototype);

interface Page extends PagedEventEmitter {}

export default Page;
