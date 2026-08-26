import Handler, { type HandlerSource } from "../handler.js";
import type { CssNode, List } from "css-tree";
interface CounterTargetValue {
    func: string;
    args: string[];
    value: string;
    counter?: string;
    style?: string;
    selector: string;
    fullSelector: string;
    variable: string;
}
interface CounterTargetsData {
    [selector: string]: CounterTargetValue;
}
interface RuleContext {
    ruleNode: CssNode;
    ruleItem?: List.Cursor;
    rulelist?: List;
}
interface DeclarationContext {
    declarationNode: CssNode;
    dItem?: List.Cursor;
    dList?: List;
}
interface PolisherSource extends HandlerSource {
    styleSheet: CSSStyleSheet;
}
interface ChunkerLayout {
    pagesArea: ParentNode;
}
/**
 * Handler for processing CSS target-counter() functions.
 *
 * Parses CSS rules using target-counter(), replaces them with CSS counters,
 * and dynamically manages counter-reset rules based on page layout.
 *
 * This allows counters to track values of elements targeted via attributes,
 * supporting complex page-based counters in paged media.
 *
 * @extends Handler
 */
declare class TargetCounters extends Handler {
    styleSheet: CSSStyleSheet;
    counterTargets: CounterTargetsData;
    /**
     * Creates an instance of TargetCounters.
     *
     * @param {Object} chunker - The chunker instance managing pagination.
     * @param {Object} polisher - The polisher instance responsible for CSS injection and post-processing.
     * @param {Object} caller - The caller or controller managing this handler.
     */
    constructor(chunker?: HandlerSource, polisher?: PolisherSource, caller?: HandlerSource);
    /**
     * Processes CSS content function nodes to detect and handle `target-counter()` functions.
     * Replaces the function with a CSS counter variable and stores necessary metadata.
     *
     * @param {Object} funcNode - The CSS function node representing `target-counter()`.
     * @param {Object} fItem - The current function node item (unused).
     * @param {Object} fList - The function list (unused).
     * @param {Object} declaration - The CSS declaration node.
     * @param {Object} rule - The CSS rule node containing the declaration.
     */
    onContent(funcNode: CssNode, fItem: List.Cursor, fList: List, declaration: DeclarationContext, rule: RuleContext): void;
    /**
     * Called after page layout to update CSS rules for counters targeting elements in the pages.
     * Inserts CSS rules dynamically to reset counters on elements matching the target selectors.
     *
     * @param {DocumentFragment} fragment - The fragment of the current page.
     * @param {Object} page - The page object (unused here).
     * @param {Object} breakToken - The pagination break token (unused here).
     * @param {Object} chunker - The chunker instance containing the pagesArea DOM.
     */
    afterPageLayout(fragment: HTMLElement, page: unknown, breakToken: unknown, chunker: ChunkerLayout): void;
}
export default TargetCounters;
