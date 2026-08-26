import Handler from "../handler.js";
import type { CssNode, List } from "css-tree";
import type { HandlerSource } from "../handler.js";
interface RuleContext {
    ruleNode: CssNode;
    [key: string]: any;
}
interface Breaker {
    property: string;
    value: string;
    selector: string;
    name?: string;
}
type BreaksMap = Record<string, Breaker[]>;
interface PageLike {
    splitFrom?: string;
    splitTo?: string;
    breakBefore?: string;
    breakAfter?: string;
    previousBreakAfter?: string;
    [key: string]: any;
}
declare class Breaks extends Handler {
    /**
     * Stores break rules keyed by CSS selector.
     * @type {Object.<string, Array.<Object>>}
     */
    breaks: BreaksMap;
    /**
     * Handles CSS break properties for paged media.
     * @param {Object} chunker - The chunker instance managing the pagination.
     * @param {Object} polisher - The polisher instance managing CSS and styles.
     * @param {Object} caller - The caller instance (optional, context info).
     */
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    onDeclaration(declaration: CssNode, dItem: List.Cursor | any, dList: List | any, rule: RuleContext): void;
    afterParsed(parsed: DocumentFragment): void;
    /**
     * Applies stored break rules to matching elements.
     *
     * @param {DocumentFragment} parsed - The parsed DOM fragment.
     * @param {Object.<string, Array.<Object>>} breaks - Break rules keyed by selectors.
     */
    processBreaks(parsed: DocumentFragment, breaks: BreaksMap): void;
    /**
     * Merges new break rules into existing break rules.
     *
     * @param {Object.<string, Array.<Object>>} pageBreaks - Existing break rules.
     * @param {Object.<string, Array.<Object>>} newBreaks - New break rules to merge.
     * @returns {Object.<string, Array.<Object>>} The merged break rules.
     */
    mergeBreaks(pageBreaks: BreaksMap, newBreaks: BreaksMap): BreaksMap;
    /**
     * Adds break-related data attributes from elements on the page to the page object.
     *
     * @param {Element} pageElement - The page DOM element.
     * @param {Object} page - The page metadata object to update.
     */
    addBreakAttributes(pageElement: HTMLElement, page: PageLike): void;
    afterPageLayout(pageElement: HTMLElement, page: PageLike): void;
}
export default Breaks;
