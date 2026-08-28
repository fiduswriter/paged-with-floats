import Handler from "../handler.js";
import type { HandlerSource } from "../handler.js";
import type { Hook } from "../../utils/hook.js";
import type BreakToken from "../../chunker/breaktoken.js";
import type { CssNode, List } from "css-tree";
interface FloatsPage {
    element: HTMLElement;
    createWrapper: () => HTMLDivElement;
}
interface FloatsChunker {
    stopped?: boolean;
    addPage(): FloatsPage;
    hooks: {
        beforePageLayout: Hook<any[]>;
        afterPageLayout: Hook<any[]>;
        finalizePage: Hook<any[]>;
    };
    emit(type: string, ...args: any[]): void;
}
interface DeferredFloat {
    element: HTMLElement;
    side: string;
    anchorRef?: string;
}
interface PlacedFloat {
    element: HTMLElement;
    side: string;
    outerHeight: number;
    anchorRef?: string;
}
/**
 * Handles CSS page floats (`float-reference: page` combined with
 * `float: top | bottom | block-start | block-end`).
 *
 * Following https://drafts.csswg.org/css-page-floats/ within the limits
 * of paged.js's measure-and-split layout engine:
 *
 * - Floats are stacked blocks; text does not wrap around them.
 * - Top floats stack above the flow content, bottom floats pin to the
 *   bottom of the page content area.
 * - A float that does not fit on the current page defers alone to the
 *   next page; following content keeps filling the current page.
 * - If the float's anchor is moved forward by fragmentation (e.g.
 *   break-inside avoid), the float moves with it.
 * - Bare `float: top | bottom` without `float-reference` also activates
 *   page floats; `left | right` with `float-reference: page` degrade to
 *   top placement.
 *
 * @class
 */
declare class PageFloats extends Handler {
    pageFloats: Record<string, string>;
    floatReferences: Record<string, boolean>;
    deferred: DeferredFloat[];
    deferredCounts: Record<string, number>;
    placed: Map<string, PlacedFloat>;
    pendingSpacers: Set<HTMLElement>;
    /**
     * Creates an instance of PageFloats.
     * @param {object} chunker - The chunker instance handling content chunks.
     * @param {object} polisher - The polisher instance handling polishing/layout.
     * @param {object} caller - The caller instance managing handler orchestration.
     */
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    /**
     * Intercepts `float-reference` and `float` declarations, records page
     * float selectors and removes the declarations from the stylesheet.
     *
     * @param {object} declaration - The CSS declaration node.
     * @param {object} dItem - Declaration item in the list.
     * @param {object} dList - Declaration list.
     * @param {object} rule - The CSS rule node.
     * @returns {void}
     */
    onDeclaration(declaration: CssNode, dItem: List.Cursor, dList: List, rule: {
        ruleNode: CssNode;
    } | null | undefined): void;
    /**
     * Tags matching elements with page float attributes and assigns
     * document-order indices for stable stacking.
     *
     * @param {Document|Element} parsed - The parsed source content.
     * @returns {void}
     */
    afterParsed(parsed: Document | Element): void;
    /**
     * Relocates rendered page float clones into the page's float
     * containers. Also catches floats nested inside deep-cloned
     * ancestors, which never get their own renderNode call.
     *
     * @param {Element} clone - The cloned node appended to the page.
     * @returns {void}
     */
    renderNode(clone: Node): void;
    /**
     * Places any floats deferred from previous pages onto the freshly
     * started page, before its content is laid out.
     *
     * @param {object} page - The Page instance about to be laid out.
     * @returns {void}
     */
    beforePageLayout(page: FloatsPage): void;
    /**
     * Syncs spacers for pages whose wrapper was created after their
     * deferred floats were placed.
     *
     * @param {Element} wrapper - The page's flow content wrapper.
     * @returns {void}
     */
    layout(wrapper: HTMLElement): void;
    /**
     * When the source content has finished but floats are still queued
     * for the next page, the chunker would stop rendering. Appends one
     * more page and runs its layout pipeline so deferred floats land.
     *
     * @param {object} chunker - The chunker instance.
     * @returns {void}
     */
    continueForDeferred(chunker: FloatsChunker): void;
    /**
     * Runs after a page is finished. If no further content follows but
     * floats are still deferred, keeps the renderer going for them.
     *
     * @param {Element} pageElement - The page's root element in the DOM.
     * @param {object} page - The Page instance.
     * @param {object} breakToken - Token for the next content, if any.
     * @param {object} chunker - The chunker instance.
     * @returns {void}
     */
    afterPageLayout(pageElement: HTMLElement, page: FloatsPage, breakToken: BreakToken | null, chunker: FloatsChunker): void;
    /**
     * Follows anchors across fragmentation: when a placed float's anchor
     * is removed with the overflow, the float defers to the next page.
     * Also removes float spacers swept along with extracted overflow;
     * they belong to this page's flow only.
     *
     * @param {Element} removed - Fragment of overflow content removed.
     * @param {Element} rendered - Current page content.
     * @returns {void}
     */
    afterOverflowRemoved(removed: HTMLElement | null, rendered: HTMLElement): void;
    /**
     * Moves a float into its edge container, checking whether it fits in
     * the remaining space of the page. Non-fitting floats defer to the
     * next page; oversized floats are placed anyway to avoid loops.
     *
     * Both edges share one fit condition: after placement, the flow
     * content plus the float's height must stay above the bottom of the
     * content area reduced by the reserved bottom height.
     *
     * @param {Element} element - The rendered float element.
     * @param {string} side - "top" or "bottom".
     * @param {Element} pageElement - The .paged_page element.
     * @param {boolean} skipFitCheck - Place without checking for space.
     * @param {string} anchorRef - Known anchor ref, from a deferral.
     * @returns {void}
     */
    placeFloat(element: HTMLElement, side: string, pageElement: HTMLElement, skipFitCheck?: boolean, anchorRef?: string): void;
    /**
     * Finds the float's anchor: the ref of the closest preceding sibling
     * in the flow, or of its closest ancestor with a ref. The float
     * follows this anchor when fragmentation moves it forward.
     *
     * @param {Element} element - The rendered float element.
     * @returns {string|undefined} The anchor's data-ref, if any.
     */
    findAnchorRef(element: HTMLElement): string | undefined;
    /**
     * Queues a float for placement on the next page and counts
     * consecutive deferrals to guard against loops.
     *
     * @param {Element} element - The float element.
     * @param {string} side - "top" or "bottom".
     * @param {string} anchorRef - Ref of the float's anchor, if any.
     * @returns {void}
     */
    deferFloat(element: HTMLElement, side: string, anchorRef?: string): void;
    /**
     * Bottom edge of the rendered flow content within the page,
     * excluding the float spacer.
     *
     * For manual-columns pages the flow lives inside the column boxes; the
     * bottom is the deepest visible line across all columns (the column
     * boxes themselves are full-height and must not count as content).
     *
     * @param {Element} content - The .paged_page_content element.
     * @returns {number} Pixel coordinate of the flow's bottom edge.
     */
    flowBottom(content: HTMLElement): number;
    /**
     * Bottom edge of a manual column's *content*, excluding the column
     * box itself (which spans the full page height by design).
     *
     * @param {HTMLElement} column - The .paged_column element.
     * @returns {number} Pixel coordinate of the deepest content line.
     */
    private columnContentBottom;
    /**
     * Bottom edge of flow content sitting in a *visible* column of the
     * wrapper.
     *
     * A single union bounding rect over the whole wrapper is wrong under
     * multi-column layout: fragments continue into a hidden spill column to
     * the right of the last visible one, and that column's line bottoms
     * masquerade as flow content reaching the page bottom — which made top
     * floats defer (or force-place late) even when visible columns had room.
     * Client rects are therefore filtered to those starting left of the
     * spill-column edge before taking the maximum bottom.
     *
     * @param {HTMLElement} wrapper - The page's flow content wrapper.
     * @returns {number} Pixel coordinate of the visible flow's bottom edge.
     */
    private visibleFlowBottom;
    /**
     * The left edge of the wrapper's hidden spill column, or null when the
     * wrapper is not a multi-column fragmentainer.
     *
     * Mirrors the chunker's fragmentainer math (`column-gap: normal`
     * approximated via font size; fragmented boxes anchored at their first
     * client rect).
     *
     * @param {HTMLElement} wrapper - The flow content wrapper.
     * @returns {number|null} Spill column left edge in pixels, or null.
     */
    private spillColumnLeft;
    /**
     * The wrapper holding the normal flow content of a page.
     *
     * @param {Element} content - The .paged_page_content element.
     * @returns {Element|null} The flow wrapper.
     */
    flowWrapper(content: HTMLElement): HTMLElement | null;
    /**
     * Vertical space currently occupied by a page's bottom float
     * container.
     *
     * @param {Element} content - The .paged_page_content element.
     * @returns {number} Reserved height in pixels.
     */
    reservedHeight(content: HTMLElement): number;
    /**
     * Keeps an in-flow spacer as the last child of the flow wrapper so
     * that fragmentation reserves the space taken by bottom floats.
     * Overflow detection measures against the full page bounds, so the
     * reserved region has to occupy real space in the flow.
     *
     * @param {Element} content - The .paged_page_content element.
     * @returns {void}
     */
    syncSpacer(content: HTMLElement): void;
    /**
     * Border box height plus vertical margins of an element.
     *
     * Uses computed styles rather than bounding rects: floats live in a
     * multicol context, and a fragmented element's client rects span the
     * whole column area, which would grossly overstate its size.
     *
     * @param {Element} element - The element to measure.
     * @returns {number} Outer height in pixels.
     */
    outerHeight(element: HTMLElement): number;
}
export default PageFloats;
