import Handler from "../handler.js";
import type { CssNode, List } from "css-tree";
import type { HandlerSource } from "../handler.js";
interface PolisherSource extends HandlerSource {
    styleSheet: CSSStyleSheet;
}
declare class Following extends Handler {
    styleSheet: CSSStyleSheet;
    /**
     * Stores selectors with their associated UUIDs and declarations.
     * Structure: { selector: [uuid, declarations] }
     */
    selectors: Record<string, [string, string]>;
    /**
     * Creates an instance of Following handler.
     *
     * @param {Object} chunker - The chunker instance.
     * @param {Object} polisher - The polisher instance.
     * @param {Object} caller - The caller instance.
     */
    constructor(chunker?: HandlerSource, polisher?: PolisherSource, caller?: HandlerSource);
    onRule(ruleNode: CssNode, ruleItem: List.Cursor | any, rulelist: List | any): void;
    afterParsed(parsed: DocumentFragment): void;
    /**
     * For each stored selector, finds matching elements in the parsed document,
     * adds a data-following attribute with the selector's UUID,
     * and inserts corresponding CSS rules into the stylesheet.
     *
     * @param {Document} parsed - The parsed document to query elements from.
     * @param {Object} selectors - Map of selectors with UUID and declarations.
     */
    processSelectors(parsed: DocumentFragment, selectors: Record<string, [string, string]>): void;
}
export default Following;
