import Handler, { type HandlerSource } from "../handler.js";
import type { CssNode, List } from "css-tree";
interface TextTargetValue {
    func: string;
    args: string[];
    value: string;
    style: string;
    selector: string;
    fullSelector: string;
    variable: string;
}
interface TextTargetsData {
    [selector: string]: TextTargetValue;
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
interface SelectorContext {
    selectNode: CssNode;
    selectItem?: List.Cursor;
    selectList?: List;
}
interface PolisherSource extends HandlerSource {
    styleSheet: CSSStyleSheet;
}
declare class TargetText extends Handler {
    styleSheet: CSSStyleSheet;
    textTargets: TextTargetsData;
    beforeContent: string;
    afterContent: string;
    selector: string;
    constructor(chunker?: HandlerSource, polisher?: PolisherSource, caller?: HandlerSource);
    /**
     * Processes `target-text()` CSS function.
     * Extracts selector, arguments, and optional style,
     * then replaces the function with a CSS variable reference.
     *
     * @param {Object} funcNode - AST node for the CSS function.
     * @param {Object} fItem - function node item (unused here).
     * @param {Object} fList - function list (unused here).
     * @param {Object} declaration - CSS declaration node (unused).
     * @param {Object} rule - CSS rule node containing the declaration.
     */
    onContent(funcNode: CssNode, fItem: List.Cursor, fList: List, declaration: DeclarationContext, rule: RuleContext): void;
    /**
     * Extracts content strings from ::before and ::after pseudo-elements,
     * used to populate dynamic CSS variables later.
     *
     * @param {Object} pseudoNode - AST node for the pseudo-element selector.
     * @param {Object} pItem - pseudo node item (unused).
     * @param {Object} pList - pseudo list (unused).
     * @param {string} selector - The selector string for this rule.
     * @param {Object} rule - The CSS rule node containing properties.
     */
    onPseudoSelector(pseudoNode: CssNode, pItem: List.Cursor, pList: List, selector: SelectorContext, rule: RuleContext): void;
    /**
     * Called after the document fragment is parsed.
     * Queries elements matching the stored selectors,
     * extracts text or pseudo content, and injects
     * corresponding CSS custom properties with sanitized values.
     *
     * @param {DocumentFragment} fragment - The current page fragment.
     */
    afterParsed(fragment: ParentNode): void;
}
export default TargetText;
