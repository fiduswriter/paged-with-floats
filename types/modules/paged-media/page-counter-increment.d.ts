import Handler from "../handler.js";
import type { CssNode, List } from "css-tree";
import type { HandlerSource } from "../handler.js";
interface PolisherSource extends HandlerSource {
    styleSheet: CSSStyleSheet;
}
interface RuleContext {
    ruleNode: CssNode;
    [key: string]: any;
}
interface IncrementRecord {
    selector: string;
    number: number;
}
interface PageCounterState {
    name: string;
    increments: Record<string, IncrementRecord>;
    resets: Record<string, unknown>;
}
/**
 * Handles `counter-increment` rules related to the `page` counter.
 *
 * This class identifies `counter-increment: page` declarations that appear outside
 * of the `@page` context and applies them by inserting equivalent CSS custom property
 * rules. This allows for controlling page-based counters from regular content.
 *
 * Reference: https://www.w3.org/TR/css-page-3/#page-based-counters
 */
declare class PageCounterIncrement extends Handler {
    styleSheet: CSSStyleSheet;
    /**
     * Tracks page counter increments and resets by selector.
     * Only the "page" counter is processed.
     * @type {{
     *   name: string,
     *   increments: Object.<string, {selector: string, number: number}>,
     *   resets: Object
     * }}
     */
    pageCounter: PageCounterState;
    /**
     * Constructs a PageCounterIncrement handler.
     *
     * @param {Object} chunker - The chunker instance used during pagination.
     * @param {Object} polisher - The polisher instance used for styling.
     * @param {Object} caller - The caller coordinating the handlers.
     */
    constructor(chunker?: HandlerSource, polisher?: PolisherSource, caller?: HandlerSource);
    /**
     * Handles CSS declarations during parsing.
     * Specifically looks for `counter-increment: page` and collects them.
     *
     * @param {Object} declaration - The CSS declaration AST node.
     * @param {Object} dItem - The item in the declaration list.
     * @param {Object} dList - The list of declarations.
     * @param {Object} rule - The parent rule node.
     */
    onDeclaration(declaration: CssNode, dItem: List.Cursor | any, dList: List | any, rule: RuleContext): void;
    /**
     * Applies the processed counter-increments as CSS custom properties.
     *
     * @param {*} _ - Unused parameter (parsed content).
     */
    afterParsed(_: unknown): void;
    /**
     * Parses a `counter-increment` declaration and determines if it's relevant.
     *
     * @param {Object} declaration - The `counter-increment` declaration node.
     * @param {Object} rule - The parent rule node.
     * @returns {Object|undefined} The parsed increment object or undefined if ignored.
     */
    handleIncrement(declaration: CssNode, rule: RuleContext): IncrementRecord | undefined;
    /**
     * Inserts a rule into the active stylesheet.
     *
     * @param {string} rule - The CSS rule string to insert.
     */
    insertRule(rule: string): void;
}
export default PageCounterIncrement;
