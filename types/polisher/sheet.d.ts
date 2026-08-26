import type { CssNode, List } from "css-tree";
import type { Dimension } from "./sizes.js";
import type { PolisherHooks } from "./polisher.js";
/**
 * Class representing a CSS stylesheet parser and processor.
 * Provides a hook-based system for analyzing and transforming CSS using csstree.
 */
declare class Sheet {
    hooks: PolisherHooks;
    url: URL;
    private _text;
    ast: CssNode & {
        children: List;
    };
    id: string;
    imported: string[];
    /** Populated externally by handlers processing `@page` size declarations. */
    width?: Dimension;
    /** Populated externally by handlers processing `@page` size declarations. */
    height?: Dimension;
    /** Populated externally by handlers processing `@page` size declarations. */
    orientation?: string;
    /**
     * Create a Sheet instance.
     * @param {string} url - The base URL for resolving relative paths.
     * @param {Object} [hooks] - Optional custom hook object.
     */
    constructor(url: string, hooks?: PolisherHooks);
    /**
     * Parses a CSS string and returns the AST.
     * @param {string} text - Raw CSS text to parse.
     * @returns {Promise<Object>} Parsed CSS AST.
     */
    parse(text: string): Promise<CssNode & {
        children: List;
    }>;
    /**
     * Inserts a new CSS rule into the AST.
     * @param {Object} rule - A csstree rule node.
     * @returns {Object} The inserted rule node.
     */
    insertRule(rule: CssNode): List.Cursor;
    /**
     * Triggers onUrl hook for each URL node.
     * @param {Object} ast - CSS AST.
     */
    urls(ast: CssNode): void;
    /**
     * Processes all at-rules and triggers relevant hooks.
     * @param {Object} ast - CSS AST.
     */
    atrules(ast: CssNode): void;
    /**
     * Processes rule nodes and triggers related hooks.
     * @param {Object} ast - CSS AST.
     */
    rules(ast: CssNode): void;
    /**
     * Triggers onDeclaration and onContent hooks for declarations.
     * @param {Object} ruleNode
     * @param {*} ruleItem
     * @param {*} rulelist
     */
    declarations(ruleNode: CssNode, ruleItem?: List.Cursor, rulelist?: List): void;
    /**
     * Handles selector and pseudo-selector hooks.
     * @param {Object} ruleNode
     * @param {*} ruleItem
     * @param {*} rulelist
     */
    onSelector(ruleNode: CssNode, ruleItem?: List.Cursor, rulelist?: List): void;
    /**
     * Resolves relative URLs in `url()` functions.
     * @param {Object} ast - CSS AST.
     */
    replaceUrls(ast: CssNode): void;
    /**
     * Scopes all selectors by prepending an ID selector.
     * @param {Object} ast - CSS AST.
     * @param {string} id - Scope ID.
     */
    addScope(ast: CssNode, id: string): void;
    /**
     * Extracts named @page selectors and modifies them.
     * @param {Object} ast - CSS AST.
     * @returns {Object} Named page selectors with their CSS selectors.
     */
    getNamedPageSelectors(ast: CssNode): Record<string, {
        name: string;
        selector: string;
    }>;
    /**
     * Converts ID selectors to [data-id="..."] format.
     * @param {Object} ast - CSS AST.
     */
    replaceIds(ast: CssNode): void;
    /**
     * Processes @import rules, adds valid URLs to `this.imported`, and removes them from AST.
     * @param {Object} node
     * @param {*} item
     * @param {*} list
     */
    imports(node: CssNode, item: List.Cursor, list: List): void;
    /** @param {string} t */
    set text(t: string);
    /** @returns {string} */
    get text(): string;
    /**
     * Generates a CSS string from AST.
     * @param {Object} [ast] - AST to stringify. Defaults to internal AST.
     * @returns {string} CSS code as string.
     */
    toString(ast?: CssNode): string;
}
export default Sheet;
