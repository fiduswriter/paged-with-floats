import Layout from "./layout.js";
import BreakToken from "./breaktoken.js";
import type { ChunkerHooks } from "./chunker.js";
import type { PagedEventEmitter } from "../types/emitter.js";
/**
 * Represents a single page in a paginated document.
 * Handles rendering, layout, overflow detection, and DOM interactions.
 *
 * @class
 */
declare class Page {
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
    constructor(pagesArea: HTMLElement, pageTemplate: HTMLTemplateElement, blank: boolean | undefined, hooks: ChunkerHooks, options?: Record<string, unknown>);
    /**
     * Creates a new page element from the template and inserts it into the DOM.
     *
     * @param {HTMLTemplateElement} template - The template to use for page creation.
     * @param {HTMLElement} [after] - Optional reference element to insert after.
     * @returns {HTMLElement} The newly created page element.
     */
    create(template?: HTMLTemplateElement, after?: HTMLElement): HTMLDivElement;
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
    createWrapper(): HTMLDivElement;
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
    private buildManualColumns;
    /**
     * Sets the page index and updates relevant attributes and classes.
     *
     * @param {number} pgnum - The page index number (0-based).
     */
    index(pgnum: number): void;
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
    setLayoutActive(active: boolean): void;
    /**
     * Drops cached sizing state that depended on skipped layout while the
     * page was inactive (placeholder intrinsic size), forcing fresh
     * measurement once contents are forced visible again.
     */
    private invalidateActiveSize;
    /**
     * Start to layout page
     *
     * @param {HTML} contents - HTML content
     * @param {BreakToken} breakToken - Previous Breaktoken
     * @param {Page} prevPage - Previous Page
     * @returns {BreakToken | null} - Null if breaktoken is equal to previous one
     */
    layout(contents: DocumentFragment, breakToken: BreakToken | undefined, prevPage?: Page): Promise<BreakToken | undefined>;
    /**
     * Appends content to the existing layout using the current layout method.
     *
     * @async
     * @param {DocumentFragment} contents - The contents to append.
     * @param {Object} breakToken - The token to continue rendering from.
     * @returns {Promise<Object>} A new breakToken after rendering.
     */
    append(contents: DocumentFragment, breakToken: BreakToken | undefined): Promise<BreakToken | undefined>;
    /**
     * Finds a DOM element by its `data-ref` attribute in a list of elements.
     *
     * @param {string} ref - The reference string to look for.
     * @param {HTMLElement[]} entries - A list of elements to search.
     * @returns {HTMLElement|undefined} The matching element, if found.
     */
    getByParent(ref: string, entries: HTMLElement[]): HTMLElement | undefined;
    /**
     * Registers a callback to run when content overflows the page.
     *
     * @param {Function} func - The overflow callback function.
     */
    onOverflow(func: (token: BreakToken) => void): void;
    /**
     * Registers a callback to run when content underflows the page.
     *
     * @param {Function} func - The underflow callback function.
     */
    onUnderflow(func: (token: BreakToken) => void): void;
    /**
     * Clears the wrapper and listeners, resetting the layout state.
     *
     * For manual-columns pages the flow host and its float containers are
     * preserved (floats placed before layout must survive), while content
     * and column rows are removed and the columns rebuilt. Single-column
     * pages keep the classic full recreate.
     */
    clear(): void;
    /**
     * Adds event listeners for scroll and resize to monitor overflows.
     *
     * @param {DocumentFragment} contents - The content being rendered (used in resize checks).
     * @returns {boolean} True if listeners were added.
     */
    addListeners(contents: DocumentFragment): boolean;
    /**
     * Removes event listeners related to overflow and resizing.
     */
    removeListeners(): void;
    /**
     * Adds a ResizeObserver to monitor wrapper size changes.
     *
     * @param {DocumentFragment} contents - The contents being observed for overflow changes.
     */
    addResizeObserver(contents: DocumentFragment): void;
    /**
     * Checks if the page content has overflowed after a resize.
     *
     * @param {DocumentFragment} contents - The content being checked.
     */
    checkOverflowAfterResize(contents: DocumentFragment): void;
    /**
     * Checks if the page content has underflowed (e.g., content was removed).
     *
     * @param {DocumentFragment} contents - The content being checked.
     */
    checkUnderflowAfterResize(contents: DocumentFragment): void;
    /**
     * Cleans up the page, removing all DOM elements and listeners.
     */
    destroy(): void;
}
interface Page extends PagedEventEmitter {
}
export default Page;
