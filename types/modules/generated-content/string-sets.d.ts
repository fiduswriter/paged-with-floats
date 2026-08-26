import Handler, { type HandlerSource } from "../handler.js";
import type { CssNode, List } from "css-tree";
interface StringSetValue {
    identifier: string;
    func: string;
    value: string;
    selector: string;
}
interface StringSetData {
    [identifier: string]: StringSetValue;
}
interface PageLastStringData {
    [name: string]: string | null;
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
/**
 * Handles CSS string-set properties to create and manage CSS custom properties for first, last, start, and first-except string values on paged content.
 * Parses the `string-set` CSS declaration, transforms `string()` function content, and updates CSS variables on each page after layout.
 *
 * @class
 * @extends Handler
 */
declare class StringSets extends Handler {
    stringSetSelectors: StringSetData;
    type?: string;
    pageLastString?: PageLastStringData;
    /**
     * Creates an instance of StringSets.
     *
     * @param {Object} chunker - Chunker instance to manage content chunking.
     * @param {Object} polisher - Polisher instance for post-processing.
     * @param {Object} caller - Calling controller instance.
     */
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    /**
     * Handles CSS declarations, looking specifically for `string-set` declarations.
     * Parses identifiers and functions, storing them with selectors.
     *
     * @param {Object} declaration - The CSS declaration node.
     * @param {Object} dItem - Declaration item (unused here).
     * @param {Object} dList - Declaration list (unused here).
     * @param {Object} rule - The CSS rule node containing the declaration.
     */
    onDeclaration(declaration: CssNode, dItem: List.Cursor, dList: List, rule: RuleContext): void;
    /**
     * Processes `string()` CSS function nodes within content declarations,
     * transforming them into CSS variables referencing paged-with-floats-generated custom properties.
     *
     * @param {Object} funcNode - The function node representing `string()`.
     * @param {Object} fItem - Function item node (unused here).
     * @param {Object} fList - Function list node (unused here).
     * @param {Object} declaration - The CSS declaration node.
     * @param {Object} rule - The CSS rule node.
     */
    onContent(funcNode: CssNode, fItem: List.Cursor, fList: List, declaration: DeclarationContext, rule: RuleContext): void;
    /**
     * Called after page layout to update CSS custom properties for string-set variables.
     * Computes first, last, start, and first-except string values and sets them as CSS variables.
     *
     * @param {DocumentFragment} fragment - The DOM fragment for the current page.
     */
    afterPageLayout(fragment: HTMLElement): void;
}
export default StringSets;
