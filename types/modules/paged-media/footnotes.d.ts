import Handler from "../handler.js";
import type { HandlerSource } from "../handler.js";
import type BreakToken from "../../chunker/breaktoken.js";
import type { CssNode, List } from "css-tree";
interface FootnoteSelector {
    selector: string;
    policy: string;
    display: string;
}
interface FootnotePage {
    element: HTMLElement;
    footnotesArea: HTMLElement;
}
interface FootnoteChunker {
    settings: Record<string, any>;
    clonePage(page: FootnotePage): void;
}
/**
 * Handles the parsing, layout, and rendering of footnotes in paged content.
 *
 * Manages footnote policies, markers, calls, layout overflow, and alignment.
 * Extends the generic Handler class.
 */
declare class Footnotes extends Handler {
    footnotes: Record<string, FootnoteSelector>;
    needsLayout: Node[];
    overflow: HTMLElement[];
    footnotesPlaced: number;
    /**
     * Creates an instance of Footnotes.
     * @param {object} chunker - The chunker instance handling content chunks.
     * @param {object} polisher - The polisher instance handling polishing/layout.
     * @param {object} caller - The caller instance managing handler orchestration.
     */
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    /**
     * Handles CSS declarations related to footnotes during parsing.
     * Detects `float: footnote`, `footnote-policy`, and `footnote-display` properties.
     *
     * @param {object} declaration - The CSS declaration node.
     * @param {object} dItem - Declaration item in the list.
     * @param {object} dList - Declaration list.
     * @param {object} rule - The CSS rule node.
     */
    onDeclaration(declaration: CssNode, dItem: List.Cursor, dList: List, rule: {
        ruleNode: CssNode;
    }): void;
    /**
     * Transforms pseudo selectors `::footnote-marker` and `::footnote-call`
     * into attribute selectors with pseudo-elements to enable footnote rendering.
     *
     * @param {object} pseudoNode - The pseudo selector node.
     * @param {object} pItem - The item in pseudo selector list.
     * @param {object} pList - The pseudo selector list.
     * @param {string} selector - The full selector string.
     * @param {object} rule - The CSS rule node.
     */
    onPseudoSelector(pseudoNode: CssNode, pItem: List.Cursor, pList: List, selector: string, rule: {
        ruleNode: CssNode;
    }): void;
    /**
     * After parsing, processes and applies footnote attributes to matching elements.
     *
     * @param {Document} parsed - The parsed DOM document or fragment.
     */
    afterParsed(parsed: Document | Element): void;
    /**
     * Finds elements matching footnote selectors and adds footnote attributes.
     * Also marks their container parents with data attributes to indicate presence of notes.
     *
     * @param {Document|Element} parsed - The root parsed element.
     * @param {Object} notes - The footnotes configuration object.
     */
    processFootnotes(parsed: Document | Element, notes: Record<string, FootnoteSelector>): void;
    /**
     * Walks up the DOM from a footnote element to find its container.
     * Marks the closest container or last element with 'data-has-notes' attribute.
     *
     * @param {Element} node - The footnote element.
     */
    processFootnoteContainer(node: HTMLElement): void;
    /**
     * Processes a node during rendering to find and handle footnotes within it.
     *
     * @param {Node} node - The DOM node to render.
     */
    renderNode(node: Node): void;
    /**
     * Finds visible footnotes within a node and moves them into the footnote area.
     *
     * @param {NodeListOf<Element>} notes - List of footnote elements.
     * @param {Element} node - The container node to check visibility against.
     */
    findVisibleFootnotes(notes: NodeListOf<HTMLElement> | HTMLElement[], node: HTMLElement): void;
    /**
     * Sets the footnote area height on the page area, never below the
     * reserve the layout engine recorded for this page
     * (`data-paged-footnote-reserve`). While a page is being filled, the
     * columns are laid out against the reserved height; letting the actual
     * note content shrink the area back down would grow the columns again
     * and then re-shrink them with every further extraction, spilling
     * already-laid-out text.
     *
     * @param {HTMLElement} pageArea - The page's `.paged_area` element.
     * @param {number} px - The content-derived height in px.
     * @returns {void}
     */
    setFootnoteAreaHeight(pageArea: HTMLElement, px: number): void;
    /**
     * Releases the layout engine's footnote reserve at the end of the page:
     * the area is sized to the notes it actually holds, so an over-estimate
     * does not leave a reserved-but-empty band at the bottom of the page.
     *
     * @param {HTMLElement} pageArea - The page's `.paged_area` element.
     * @returns {void}
     */
    releaseFootnoteReserve(pageArea: HTMLElement): void;
    /**
     * Recalculates the height of footnote content and adjusts page CSS variables
     * to ensure proper layout according to footnote policy and overflow.
     *
     * @param {Element} node - The footnote node.
     * @param {Element} noteContent - The container of footnote content.
     * @param {Element} pageArea - The page area element.
     * @param {Element|null} noteCall - The footnote call element.
     * @param {boolean} needsNoteCall - Whether the footnote call should be rendered.
     */
    recalcFootnotesHeight(node: HTMLElement, noteContent: HTMLElement, pageArea: HTMLElement, noteCall: HTMLElement | null | undefined, needsNoteCall: boolean): void;
    /**
     * Moves a footnote node to the footnote area of a given page.
     * @param {Element} node - The footnote element to move.
     * @param {Element} pageArea - The page container element containing footnotes.
     * @param {boolean} needsNoteCall - Whether a footnote call link should be created.
     * @returns {void}
     */
    moveFootnote(node: Node, pageArea: HTMLElement, needsNoteCall: boolean): void;
    /**
     * Creates a footnote call (link) element that points to the footnote.
     * @param {Element} node - The footnote element to create a call for.
     * @returns {HTMLAnchorElement} The created footnote call anchor element.
     */
    createFootnoteCall(node: HTMLElement): HTMLAnchorElement;
    /**
     * Called after the page layout is complete to handle footnote overflow and layout.
     * @param {Element} pageElement - The page's root element in the DOM.
     * @param {Object} page - The page object containing footnotes and layout info.
     * @param {Object|null} breakToken - The token representing a page break, if any.
     * @param {Object} chunker - The chunker instance managing page chunks.
     * @returns {void}
     */
    afterPageLayout(pageElement: HTMLElement, page: FootnotePage, breakToken: BreakToken | null, chunker: FootnoteChunker): void;
    /**
     * Handles alignment properties for the last split footnote element.
     * @param {Element} node - The footnote element to apply alignment on.
     * @returns {void}
     */
    handleAlignment(node: HTMLElement): void;
    /**
     * Called before laying out a page, to process any pending footnotes that need moving.
     * @param {Object} page - The page object containing DOM and layout data.
     * @returns {void}
     */
    beforePageLayout(page: FootnotePage): void;
    /**
     * Called after overflow content is removed; updates footnotes accordingly.
     * @param {Element} removed - The DOM fragment containing removed overflow nodes.
     * @param {Element} rendered - The DOM element where content is currently rendered.
     * @returns {void}
     */
    afterOverflowRemoved(removed: HTMLElement, rendered: HTMLElement): void;
    /**
     * Called after overflow content is added; reattaches footnotes and recalculates heights.
     * @param {Element} rendered - The DOM element where new content has been rendered.
     * @returns {void}
     */
    afterOverflowAdded(rendered: HTMLElement): void;
    /**
     * Calculates the total vertical margin height of an element.
     * @param {Element} element - The DOM element to calculate margin height for.
     * @param {boolean} [total=true] - Whether to include bottom margin in the total.
     * @returns {number} The sum of the top (and optionally bottom) margin in pixels.
     */
    marginsHeight(element: HTMLElement, total?: boolean): number;
    /**
     * Calculates the total vertical padding height of an element.
     * @param {Element} element - The DOM element to calculate padding height for.
     * @param {boolean} [total=true] - Whether to include bottom padding in the total.
     * @returns {number} The sum of the top (and optionally bottom) padding in pixels.
     */
    paddingHeight(element: HTMLElement, total?: boolean): number;
    /**
     * Calculates the total vertical border height of an element.
     * @param {Element} element - The DOM element to calculate border height for.
     * @param {boolean} [total=true] - Whether to include bottom border in the total.
     * @returns {number} The sum of the top (and optionally bottom) border width in pixels.
     */
    borderHeight(element: HTMLElement, total?: boolean): number;
}
export default Footnotes;
