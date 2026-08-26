import Handler from "../handler.js";
import type { CssNode, List } from "css-tree";
import type { HandlerSource } from "../handler.js";
interface PolisherSource extends HandlerSource {
    styleSheet: CSSStyleSheet;
}
/**
 * Handler for emulating pseudo-selectors like `:first-of-type`, `:last-of-type`, and `:nth-of-type`
 * by converting them into attribute-based selectors that can be used for styling after layout.
 */
declare class NthOfType extends Handler {
    styleSheet: CSSStyleSheet;
    /**
     * Map of selectors and their associated UUID and declarations.
     * @type {Object}
     */
    selectors: Record<string, [string, string]>;
    /**
     * Constructs the NthOfType handler.
     * @param {Object} chunker - The chunker instance used to split content into pages.
     * @param {Object} polisher - The polisher instance for handling styles.
     * @param {Object} caller - The caller instance managing lifecycle hooks.
     */
    constructor(chunker?: HandlerSource, polisher?: PolisherSource, caller?: HandlerSource);
    /**
     * Hook called during CSS rule parsing.
     * Intercepts `:first-of-type`, `:last-of-type`, and `:nth-of-type` selectors,
     * removes the rule, and stores the relevant declarations and a UUID for later use.
     *
     * @param {Object} ruleNode - The AST node representing the CSS rule.
     * @param {Object} ruleItem - The rule item in the CSS rule list.
     * @param {Object} rulelist - The list of all CSS rules.
     */
    onRule(ruleNode: CssNode, ruleItem: List.Cursor | any, rulelist: List | any): void;
    /**
     * Hook called after the entire content is parsed but before layout.
     * Applies the transformed attribute-based selectors to relevant elements.
     *
     * @param {Document|HTMLElement} parsed - The parsed document or content element.
     */
    afterParsed(parsed: DocumentFragment): void;
    /**
     * Applies unique `data-nth-of-type` attributes to elements matching selectors,
     * and dynamically inserts the converted rules into the stylesheet.
     *
     * @param {Document|HTMLElement} parsed - The parsed content.
     * @param {Object} selectors - Map of selectors and their UUID + declarations.
     */
    processSelectors(parsed: DocumentFragment, selectors: Record<string, [string, string]>): void;
}
export default NthOfType;
