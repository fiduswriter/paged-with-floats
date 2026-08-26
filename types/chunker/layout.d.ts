import BreakToken from "./breaktoken.js";
import RenderResult from "./renderresult.js";
import Hook from "../utils/hook.js";
import Overflow from "./overflow.js";
import type { ChunkerHooks } from "./chunker.js";
import type { PagedEventEmitter } from "../types/emitter.js";
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
/** Diagnostics for the prediction path (counts only; negligible cost). */
export declare const predictStats: {
    prepareCalls: number;
    prepareMs: number;
    reuses: number;
    predicts: number;
    predictMs: number;
    fallbacks: number;
    quickFits: number;
    unverified: number;
    eagerEntries: number;
    rejects: Record<string, number>;
};
/**
 * Resets per-run prediction caches. Called once per flow so rerunning the
 * previewer on new content never matches stale entries.
 */
export declare function resetPredictionCaches(): void;
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
export declare function validateRenderedPages(pagesArea?: HTMLElement | null): OverflowViolation[];
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
export declare function rebalanceMulticolFinals(pagesArea?: HTMLElement | null): number;
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
export declare function prepareTextsEagerly(source: DocumentFragment | Node, settings: Record<string, unknown>): DocumentFragment | Node;
/**
 * Layout
 * @class
 */
declare class Layout {
    element: HTMLElement;
    bounds: DOMRect;
    parentBounds: DOMRect | {
        left: number;
    };
    gap: number;
    hooks: LayoutHooks;
    settings: Record<string, unknown>;
    maxChars: number;
    forceRenderBreak: boolean;
    temporaryIndex: number;
    failed?: boolean;
    /** Selector strings that may produce fragmentainers (from author CSS). */
    multicolSelectors: Set<string>;
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
    private fragmentainerMeta;
    /** Saved inline heights of fragmentainers during unconstrained measuring. */
    private savedFragmentainerHeights;
    /** Whether this.bounds no longer reflects the mutated DOM. */
    private boundsDirty;
    /** Shared pretext-backed measurement service (predict fast path). */
    private measure;
    /** Text nodes for which prediction already proved unprofitable. */
    private predictFallbacks;
    /** Prepared originals keyed by parent ref, reusable by continuation suffixes. */
    private continuationPrepared;
    /**
     * Whether predicted breaks are verified against real DOM rects before
     * being accepted. Disable via settings `verifyTextPrediction: false` to
     * run pure-arithmetic breaking; output should then be audited
     * post-render with validateRenderedPages().
     */
    private predictionVerified;
    /**
     * Whether the final character of a text node renders outside its
     * fragmentainer / page bounds. Flow order is monotonic, so the tail
     * overflowing is equivalent to the node straddling the break.
     */
    private textEndOverflows;
    constructor(element: HTMLElement, hooks?: ChunkerHooks, options?: Record<string, unknown>);
    /**
     * Marks cached page bounds as stale after a DOM or style mutation.
     */
    invalidateBounds(): void;
    /**
     * Page content bounds, re-measured at most once per mutation batch.
     *
     * Appending a node only matters geometrically when something later
     * reads geometry; deferring the read here lets consecutive appends
     * share a single engine layout instead of forcing one per node.
     */
    refreshBounds(): DOMRect;
    /**
     * True when the element computes to more than one column.
     */
    isMulticolElement(el: Element): boolean;
    /**
     * Reads and caches the column geometry of a potential fragmentainer.
     *
     * `column-gap: normal` resolves to 1em per spec; computed styles may
     * report the keyword, so it is approximated via font-size when needed.
     */
    getFragmentainerMeta(el: Element): FragmentainerMeta;
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
    };
    /**
     * Finds multicol roots among the rendered descendants of `root`
     * (including itself) and registers them. Nested fragmentainers are not
     * supported: the inner container degrades to a single column with a
     * warning.
     */
    registerFragmentainers(root: HTMLElement | Node): void;
    /**
     * Registers a single fragmentainer unless it sits inside an already
     * registered one (nested multicol), which is degraded gracefully.
     */
    private registerFragmentainer;
    /**
     * The nearest registered fragmentainer ancestor of a node, or null when
     * the node flows directly within the page wrapper (single-column
     * semantics relative to the page bounds).
     */
    getFragmentainer(node: Node): Element | null;
    /**
     * Whether a single client rect of a node exceeds its fragmentainer.
     *
     * Without a fragmentainer this falls back to the classic page-bounds
     * comparison. Within a fragmentainer:
     * - a rect starting at or beyond the right edge lies in the hidden
     *   spill-over column and overflows;
     * - a rect starting in the last visible column must also fit vertically.
     */
    rectOverflows(rect: DOMRect, additions: number, frag: Element | null, bounds?: DOMRect): boolean;
    /**
     * Constrains a multicol block to the remaining vertical space on this
     * page so the browser fragments it internally instead of balancing it
     * past the bottom edge. Only applied when the block's natural height
     * does not fit.
     */
    constrainMulticolHeight(el: Element, bounds?: DOMRect): void;
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
    renderTo(wrapper: HTMLElement, source: DocumentFragment | Node, breakToken: BreakToken | undefined, prevPage?: HTMLElement | null, bounds?: DOMRect): Promise<RenderResult>;
    breakAt(node: Node | undefined, offset?: number, forcedBreakQueue?: Node[]): BreakToken;
    shouldBreak(node: Node, limiter?: Node): boolean;
    forceBreak(): void;
    getStart(source: DocumentFragment | Node, breakToken?: BreakToken): Node | undefined;
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
    addOverflowNodes(dest: HTMLElement, source: Node): void;
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
    addOverflowToPage(dest: HTMLElement, breakToken: BreakToken | undefined, alreadyRendered?: DocumentFragment | Node): void;
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
    append(node: Node, dest: HTMLElement, source: DocumentFragment | Node, breakToken: BreakToken | null | undefined, shallow?: boolean, rebuild?: boolean): ChildNode;
    rebuildTableFromBreakToken(breakToken: BreakToken | undefined, dest: HTMLElement, source: DocumentFragment | Node): void;
    waitForImages(imgs: NodeListOf<HTMLImageElement>): Promise<void>;
    awaitImageLoaded(image: HTMLImageElement): Promise<unknown>;
    avoidBreakInside(node: Node, limiter: Node): Element | undefined;
    createOverflow(overflow: Range, rendered: HTMLElement, source: DocumentFragment | Node): Overflow | undefined;
    /**
     * Recursively removes last child and it's ancestors if the nested parentElement is empty
     *
     * In case of empty table rows or similar
     *
     * @param {Element} parentElement
     * @param {Element} rootElement
     */
    lastChildCheck(parentElement: Element, rootElement: WithRefs): void;
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
    processOverflowResult(ranges: Range[], rendered: HTMLElement, source: DocumentFragment | Node, bounds: DOMRect, prevBreakToken: BreakToken | undefined, node: Node | null, extract?: boolean): BreakToken;
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
    findBreakToken(rendered: HTMLElement, source: DocumentFragment | Node, bounds?: DOMRect, prevBreakToken?: BreakToken, node?: Node | null, extract?: boolean): BreakToken | undefined;
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
    hasOverflow(element: HTMLElement, bounds?: DOMRect): boolean;
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
    getAncestorPaddingBorderAndMarginSums(element?: Element | null, stopAtFragmentainer?: boolean): Record<string, number>;
    /**
     * Checks whether an element is within a table and gets any THEAD sizes.
     */
    getAncestorTheadSizes(element?: Element | null): number;
    /**
     * Adds temporary data-split-to/from attribute where needed.
     *
     * @param DomElement element
     *   The deepest child, from which to start.
     */
    addTemporarySplit(element?: Element | null, isTo?: boolean): void;
    /**
     * Removes temporary data-split-to/from attribute where added.
     *
     * @param DomElement element
     *   The deepest child, from which to start.
     * @param boolean isTo
     *   Whether a split-to or -from was added.
     */
    deleteTemporarySplit(element?: Element | null, isTo?: boolean): void;
    /**
     * Client rects for any node: elements and ranges directly, text nodes
     * via a range around their contents.
     */
    nodeClientRects(node: Node): DOMRectList | undefined;
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
    firstOverflowingChild(node: Node, bounds: DOMRect): ChildNode | null | undefined;
    removeHeightConstraint(element: Element): void;
    restoreHeightConstraint(element: Element): void;
    getUnconstrainedElementHeight(element: Element, includeAncestors?: boolean, includeTableHead?: boolean): number;
    getRange(rangeStart: Node, offset: number, rangeEnd?: Node): Range;
    startOfNewOverflow(startNode: Node, rendered: HTMLElement, bounds: DOMRect): [ChildNode | null | undefined, boolean];
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
    tagAndCreateOverflowRange(startOfOverflow: Node, rangeStart: Node, rangeEnd?: Node, bounds?: DOMRect, rendered?: HTMLElement): Range | undefined;
    rowspanNeedsBreakAt(tableRow: Element, rendered: HTMLElement): Element | undefined;
    /**
     * Find the next overflow in the current layout. Tags overflowing content and returns the range of the overflowing content
     * -> Called by findBreakToken and afterLayout
     *
     * @param {Element} rendered - Current page rendered div
     * @param {DOMRect} bounds - ClientRect of the page
     * @param {HTML} source - Source html content
     * @returns {null | Range} range - null if there is no overflow.
     */
    findOverflow(rendered: HTMLElement, bounds: DOMRect, source?: DocumentFragment | Node): Range | undefined;
    findEndToken(rendered: HTMLElement, source: DocumentFragment | Node): BreakToken | undefined;
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
    textBreak(node: Text, start: number, end: number, vStart: number, vEnd: number): number | undefined;
    /**
     * Legacy word/letter walker measuring every word (and boundary-word
     * letters) through DOM rects.
     *
     * TEMPORARY FALLBACK: kept only until parity testing proves the
     * pretext predictor handles every supported case; remove together with
     * the `textMeasurement` escape hatch and capability gates then.
     */
    private legacyTextBreakCore;
    /**
     * Pretext-backed fast path: predicts the break offset from cached
     * arithmetic line layout and verifies the candidate with at most a
     * handful of DOM probes.
     *
     * @returns an offset when confidently predicted, `undefined` when the
     * text provably fits the remaining space, or `null` to request the
     * legacy fallback.
     */
    private predictTextBreak;
    private predictTextBreakInner;
    removeOverflow(overflow: Range, breakLetter?: string): DocumentFragment;
    hyphenateAtBreak(startContainer: Node, breakLetter?: string): void;
    equalTokens(a?: {
        node?: Node;
        offset?: number;
    } | null, b?: {
        node?: Node;
        offset?: number;
    } | null): boolean;
}
interface Layout extends PagedEventEmitter {
}
declare global {
    interface Window {
        __pagedPredictStats?: typeof predictStats;
    }
}
export default Layout;
