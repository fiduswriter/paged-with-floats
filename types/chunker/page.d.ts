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
     * When a root-level multicol configuration is present (via settings
     * `rootColumns`), the wrapper becomes the fragmentainer: the browser
     * fragments flow content into N visible columns and any content beyond
     * the last column spills into an additional off-page column, which the
     * layout stage detects as overflow.
     *
     * @returns {HTMLElement} The wrapper element.
     */
    createWrapper(): HTMLDivElement;
    /**
     * Sets the page index and updates relevant attributes and classes.
     *
     * @param {number} pgnum - The page index number (0-based).
     */
    index(pgnum: number): void;
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
