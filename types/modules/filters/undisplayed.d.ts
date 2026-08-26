import Handler from "../handler.js";
import type { HandlerSource } from "../handler.js";
import type { CssNode, List } from "css-tree";
interface DisplayRule {
    value: string;
    selector: string;
    specificity: number;
    important: boolean;
}
/**
 * Handler that identifies and marks elements styled with `display: none` from CSS or inline styles.
 *
 * @class
 * @extends Handler
 */
declare class UndisplayedFilter extends Handler {
    displayRules: Record<string, DisplayRule>;
    /**
     * Creates an instance of UndisplayedFilter.
     *
     * @param {Object} chunker - The chunker managing document flow.
     * @param {Object} polisher - The polisher managing post-processing.
     * @param {Object} caller - The entity invoking the handler.
     */
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    /**
     * Captures display declarations during CSS parsing.
     *
     * @param {Object} declaration - The CSS declaration node.
     * @param {Object} dItem - The declaration item in the AST.
     * @param {Array} dList - The list of declarations.
     * @param {Object} rule - The associated CSS rule.
     */
    onDeclaration(declaration: CssNode, dItem: List.Cursor, dList: List, rule: {
        ruleNode: CssNode;
    }): void;
    /**
     * Filters out or marks elements that are not meant to be displayed.
     *
     * @param {HTMLElement | DocumentFragment} content - The DOM content to be filtered.
     */
    filter(content: HTMLElement | DocumentFragment): void;
    /**
     * Sorts display rules based on `!important` and specificity, used for resolving conflicts.
     *
     * @private
     * @param {Object} a - First display rule.
     * @param {Object} b - Second display rule.
     * @returns {number} Sort order.
     */
    sorter(a: DisplayRule, b: DisplayRule): number;
    /**
     * Matches display rules against elements and sorts them by specificity and importance.
     *
     * @param {HTMLElement | DocumentFragment} content - The DOM content to search.
     * @param {Object.<string, Object>} displayRules - CSS display rules to apply.
     * @returns {{ matches: HTMLElement[], selectors: Object[][] }} Matched elements and their rules.
     */
    sortDisplayedSelectors(content: HTMLElement | DocumentFragment, displayRules?: Record<string, DisplayRule>): {
        matches: HTMLElement[];
        selectors: DisplayRule[][];
    };
    /**
     * Determines whether an element is removable based on its inline display style.
     *
     * @param {HTMLElement} element - The element to check.
     * @returns {boolean} True if the element is considered removable.
     */
    removable(element: HTMLElement): boolean;
}
export default UndisplayedFilter;
