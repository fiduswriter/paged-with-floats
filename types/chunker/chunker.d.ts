import Page from "./page.js";
import Hook from "../utils/hook.js";
import Queue from "../utils/queue.js";
import BreakToken from "./breaktoken.js";
import Layout from "./layout.js";
import type { PagedEventEmitter } from "../types/emitter.js";
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
declare class Chunker {
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
    constructor(content?: HTMLElement | DocumentFragment | string, renderTo?: HTMLElement, options?: Record<string, unknown>);
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
    detectRootColumns(content?: HTMLElement | DocumentFragment | string): RootColumnConfig | undefined;
    /**
     * Sets up the page container and page template structure.
     *
     * @param {HTMLElement} renderTo - The DOM node to which pages should be rendered.
     */
    setup(renderTo?: HTMLElement): void;
    /**
     * Gathers and records rules that should be disabled during rendering.
     */
    rulesToDisable: Array<string | Record<string, string>>;
    recordRulesToDisable(): void;
    /**
     * Disables specific CSS rules that may interfere with rendering.
     *
     * @param {HTMLElement} rendered - The rendered content container.
     */
    disableRules(rendered: DocumentFragment | HTMLElement): void;
    /**
     * Re-enables the CSS rules that were previously disabled.
     *
     * @param {HTMLElement} rendered - The rendered content container.
     */
    enableRules(rendered: DocumentFragment | HTMLElement): void;
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
    flow(content: HTMLElement | DocumentFragment | string | undefined, renderTo?: HTMLElement): Promise<Chunker>;
    /**
     * Renders the parsed html into paginated content and adds references (UUID data-ref attributes)
     *
     * @param {HTML} parsed - parsed html content with data-refs for later use
     * @param {Element} startAt - HTML node to start rendering
     * @returns Pages
     */
    render(parsed: DocumentFragment | Node, startAt?: BreakToken): Promise<RenderStep>;
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
    renderBudgeted(renderer: AsyncGenerator<BreakToken | undefined>, budgetMs?: number): Promise<RenderStep>;
    /**
     * Resets the rendering state.
     */
    start(): void;
    /**
     * Stop the rendering process.
     */
    stop(): void;
    /**
     * Renders a chunk of content when the browser is idle.
     *
     * @param {AsyncGenerator} renderer - The renderer iterator.
     * @returns {Promise<Object>} - Result of rendering.
     */
    renderOnIdle(renderer: AsyncGenerator<BreakToken | undefined>): Promise<RenderStep>;
    /**
     * Performs one asynchronous rendering step.
     *
     * @param {AsyncGenerator} renderer - The renderer iterator.
     * @returns {Promise<Object>} - Result of rendering.
     */
    renderAsync(renderer: AsyncGenerator<BreakToken | undefined>): Promise<RenderStep>;
    /**
     * Handling page breaks and adds new Pages if required
     *
     * @param {Element} node - breaking node
     * @param {bool} force - force page break
     * @returns {null}
     */
    handleBreaks(node: Node | undefined | null, force?: boolean): Promise<void>;
    /**
     * Generator that performs the layout step-by-step, yielding break tokens.
     *
     * @async
     * @param {Document|HTMLElement} content - The parsed content.
     * @param {Object} [startAt] - Optional starting break token.
     * @yields {Object} - The current break token.
     */
    layout(content: Node | string, startAt?: BreakToken): AsyncGenerator<BreakToken | undefined, void, void>;
    /**
     * Records the number of characters per page for average calculation.
     *
     * @param {number} length - Number of characters on the page.
     */
    recoredCharLength(length: number): void;
    /**
     * Removes rendered pages starting from the specified index.
     *
     * @param {number} [fromIndex=0] - Index to start removing pages from.
     */
    removePages(fromIndex?: number): void;
    /**
     * Per-page settings snapshot, extended with the current multi-column
     * configuration so that Page and Layout can set up fragmentainers.
     */
    pageSettings(): Record<string, unknown>;
    /**
     * Adds a new page to the render flow.
     *
     * @param {boolean} [blank=false] - Whether to add a blank page.
     * @returns {Page} - The newly added Page instance.
     */
    addPage(blank?: boolean): Page;
    /**
     * Clones an existing page and appends it to the document.
     *
     * @async
     * @param {Page} originalPage - The page to clone.
     */
    clonePage(originalPage: Page): Promise<void>;
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
    loadFonts(): Promise<string[]>;
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
    loadImages(parsed: DocumentFragment | Node): Promise<void>;
    /**
     * Awaits a single image's data, bounded by IMAGE_PRELOAD_TIMEOUT_MS so a
     * hanging request cannot stall rendering forever. Also forces eager
     * loading: clones of the node keep that attribute and never measure
     * against an empty lazy box.
     *
     * @param {HTMLImageElement} img - The image to preload.
     * @returns {Promise<void>} - Resolves on load, error, or timeout.
     */
    private preloadImage;
    /**
     * Cleans up and removes all rendered elements and templates.
     */
    destroy(): void;
}
interface Chunker extends PagedEventEmitter {
}
export default Chunker;
