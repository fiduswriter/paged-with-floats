import Handler from "../handler.js";
import type { HandlerSource } from "../handler.js";
import type { CssNode, List } from "css-tree";
interface DimensionValue {
    value: number | string;
    unit: string;
}
interface SizeSpec {
    width?: DimensionValue;
    height?: DimensionValue;
    orientation?: string;
    format?: string;
}
interface BleedSides {
    top: DimensionValue;
    right: DimensionValue;
    bottom: DimensionValue;
    left: DimensionValue;
}
type MarginSide = Partial<DimensionValue>;
type MarginSides = Record<string, MarginSide>;
type BorderSides = Record<string, string | MarginSide>;
type CssList = List & {
    append(item: CssNode, ref?: List.Cursor): void;
    appendList(items: List): void;
    copy(): CssList;
    createItem(data: CssNode): List.Cursor;
};
interface CssBlockNode {
    type: string;
    loc?: unknown;
    children: CssList;
}
interface PageModel {
    selector: string;
    name?: string;
    psuedo?: string;
    nth?: string;
    marginalia: Record<string, CssNode>;
    width?: DimensionValue;
    height?: DimensionValue;
    orientation?: string;
    format?: string;
    size?: SizeSpec;
    bleed?: BleedSides;
    marks?: string[];
    margin: MarginSides;
    padding: MarginSides;
    border: BorderSides;
    backgroundOrigin?: unknown;
    block: CssBlockNode;
    notes?: Record<string, CssNode>;
    added: boolean;
}
interface MarginaliaEntry {
    page: PageModel;
    selector: string;
    block: CssNode;
    hasContent: boolean;
}
interface ParsedDeclarations {
    size?: SizeSpec;
    bleed?: Array<DimensionValue | "auto">;
    marks?: string[];
    margin?: MarginSides;
    padding?: MarginSides;
    border?: BorderSides;
}
interface SheetLike {
    insertRule(rule: CssNode): CssNode;
}
interface OverflowEntry {
    node?: Node;
    topLevel?: boolean;
}
interface BreakTokenRef {
    node: Node;
    overflow: OverflowEntry[];
}
interface ChunkerPage {
    element: HTMLElement;
    wrapper?: HTMLElement;
    footnotesArea: HTMLElement;
    startToken?: BreakTokenRef;
    name?: string;
}
interface ChunkerSource {
    pages: ChunkerPage[];
}
/**
 *  A class to do all the @page conversion and update in the css.
 *
 */
declare class AtPage extends Handler {
    pages: Record<string, PageModel>;
    width?: DimensionValue;
    height?: DimensionValue;
    orientation?: string;
    format?: string;
    marginalia: Record<string, MarginaliaEntry>;
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    pageModel(selector: string): PageModel;
    /**
     * Processes a CSS `@page` rule node and integrates it into the internal `pages` model.
     * Handles merging of existing page data, extracting selectors, marginalia, size, bleed,
     * marks, margins, padding, and borders. Also removes the processed item from the rule list.
     *
     * @param {Object} node - The AST node representing the `@page` rule.
     * @param {Object} item - The list item in the AST that contains the rule (used for removal).
     * @param {Object} list - The parent list of rules, typically from the CSS AST (csstree.List).
     */
    onAtPage(node: CssNode, item: List.Cursor, list: List): void;
    /**
     * Finalizes processing after the CSS AST tree has been walked.
     * Applies page-level classes and, if a default `@page` rule (`*`) is marked as dirty (i.e., changed),
     * it updates root-level CSS variables and emits size and page-related metadata.
     *
     * @param {Object} ast - The full CSS AST (typically from csstree) representing the stylesheet.
     * @param {Object} sheet - The current stylesheet being processed (contextual information, optional).
     */
    afterTreeWalk(ast: CssNode, sheet: SheetLike): void;
    /**
     * Extracts the type selector (page name) from the `@page` rule prelude.
     * For example, in `@page myPage {}`, this returns `"myPage"`.
     *
     * @param {Object} ast - The AST node for the `@page` rule (should contain a `prelude`).
     * @returns {string|undefined} The type selector name if found, otherwise `undefined`.
     */
    getTypeSelector(ast: CssNode): string | undefined;
    /**
     * Extracts a pseudo-class selector from the `@page` prelude.
     * Looks for values like `:left`, `:right`, `:first`, etc., and returns the name.
     * Skips `:nth` pseudo-classes (handled separately).
     *
     * @param {Object} ast - The AST node for the `@page` rule.
     * @returns {string|undefined} The pseudo-class name if found, otherwise `undefined`.
     */
    getPsuedoSelector(ast: CssNode): string | undefined;
    /**
     * Extracts the argument of an `:nth` pseudo-class selector, if present.
     * For example, in `@page :nth(3n) {}`, this returns `"3n"`.
     *
     * @param {Object} ast - The AST node for the `@page` rule.
     * @returns {string|undefined} The `:nth` selector argument if found, otherwise `undefined`.
     */
    getNthSelector(ast: CssNode): string | undefined;
    /**
     * Extracts and removes `@margin-*` style at-rules from the block of a `@page` rule.
     * These are stored in a dictionary keyed by their normalized region names.
     *
     * @param {Object} ast - The AST node for the `@page` rule.
     * @returns {Object} A dictionary of marginalia region names to their blocks.
     */
    replaceMarginalia(ast: CssNode): Record<string, CssNode>;
    /**
     * Extracts and removes `@footnote` at-rules from the block of a `@page` rule.
     * Returns a dictionary of extracted footnote blocks.
     *
     * @param {Object} ast - The AST node for the `@page` rule.
     * @returns {Object} A dictionary of note names (currently only `footnote`) to their blocks.
     */
    replaceNotes(ast: CssNode): Record<string, CssNode>;
    /**
     * Extracts and removes relevant declarations from the `@page` block such as:
     * - size
     * - bleed
     * - marks
     * - margin / margin-*
     * - padding / padding-*
     * - border / border-*
     *
     * Converts them into structured objects for internal processing.
     *
     * @param {Object} ast - The AST node for the `@page` rule.
     * @returns {Object} A parsed object containing size, bleed, marks, margin, padding, and border properties.
     */
    replaceDeclarations(ast: CssNode): ParsedDeclarations;
    getSize(declaration: CssNode): SizeSpec;
    /**
     * Parses a shorthand or longhand `margin` declaration and expands it into
     * individual `top`, `right`, `bottom`, and `left` sides.
     *
     * Supports values like:
     * - `margin: 10px`
     * - `margin: 10px 20px`
     * - `margin: 10px 20px 30px`
     * - `margin: 10px 20px 30px 40px`
     *
     * @param {Object} declaration - The AST node representing the `margin` declaration.
     * @returns {Object} An object with `top`, `right`, `bottom`, and `left` properties.
     */
    getMargins(declaration: CssNode): MarginSides;
    /**
     * Parses a shorthand or longhand `padding` declaration and expands it into
     * `top`, `right`, `bottom`, and `left` properties.
     *
     * Supports values like:
     * - `padding: 10px`
     * - `padding: 10px 20px`
     * - `padding: 10px 20px 30px`
     * - `padding: 10px 20px 30px 40px`
     *
     * @param {Object} declaration - The AST node representing the `padding` declaration.
     * @returns {Object} An object with `top`, `right`, `bottom`, and `left` properties.
     */
    getPaddings(declaration: CssNode): MarginSides;
    /**
     * Parses border-related declarations (`border`, `border-top`, etc.)
     * and expands them into an object representing each side.
     *
     * This is used to apply page-level borders on generated content (e.g. `.paged_area`).
     *
     * @param {Object} declaration - A declaration node with a `prop` and `value`.
     * @returns {Object} An object with `top`, `right`, `bottom`, and `left` properties.
     */
    getBorders(declaration: CssNode): BorderSides;
    /**
     * Adds dynamically generated page classes (rules) to the stylesheet.
     * These are based on parsed `@page` rules with selectors like:
     * - `*` (default)
     * - `:left`, `:right`, `:first`, `:blank`
     * - `:nth(...)`
     * - Named pages (e.g., `@page chapter`)
     *
     * Ensures each rule is only added once.
     *
     * @param {Object} pages - A dictionary of parsed `@page` definitions.
     * @param {Object} ast - The stylesheet AST (typically from `csstree`).
     * @param {Object} sheet - The stylesheet object that supports `insertRule()`.
     */
    addPageClasses(pages: Record<string, PageModel>, ast: CssNode, sheet: SheetLike): void;
    /**
     * Creates a CSS rule for a page, applying margin, padding, border, and
     * dimension variables. Also adds marginalia and notes if present.
     *
     * @param {Object} page - The page object containing properties like `width`, `margin`, etc.
     * @param {Object} ruleList - The list of AST rules to which new rules may be appended.
     * @param {Object} sheet - The stylesheet object used to insert rules.
     * @returns {Object} A CSS rule representing the page.
     */
    createPage(page: PageModel, ruleList: List, sheet: SheetLike): CssNode;
    /**
     * Adds CSS custom properties (variables) for page margins to the rule block.
     *
     * @param {Object} margin - An object with `top`, `right`, `bottom`, and `left` values.
     * @param {Object} list - The list of declarations (typically from a Block AST node).
     * @param {Object} item - Reference item used for insertion position.
     */
    addMarginVars(margin: MarginSides, list: CssList, item: List.Cursor): void;
    /**
     * Adds CSS custom properties (variables) for page padding to the rule block.
     *
     * @param {Object} padding - An object with `top`, `right`, `bottom`, and `left` values.
     * @param {Object} list - The list of declarations.
     * @param {Object} item - Reference node for insertion.
     */
    addPaddingVars(padding: MarginSides, list: CssList, item: List.Cursor): void;
    /**
     * Adds CSS custom properties (variables) for page borders to the rule block.
     *
     * @param {Object} border - An object with string values for `top`, `right`, `bottom`, and `left`.
     * @param {Object} list - The list of declarations.
     * @param {Object} item - Reference node for insertion.
     */
    addBorderVars(border: BorderSides, list: CssList, item: List.Cursor): void;
    /**
     * Adds CSS custom properties for page width and height based on orientation.
     *
     * @param {Object} width - Width value (e.g., {value: 210, unit: "mm"}).
     * @param {Object} height - Height value (same structure as width).
     * @param {string} orientation - Either 'portrait' or 'landscape'.
     * @param {Object} list - Declaration list to which variables are added.
     * @param {Object} item - Reference node.
     */
    addDimensions(width: DimensionValue, height: DimensionValue, orientation: string | undefined, list: List, item: List.Cursor): void;
    /**
     * Adds marginalia rules (styles) for specified page regions (e.g., top-left, right-middle).
     * Handles:
     * - Content detection
     * - Vertical alignment conversion
     * - max-width/max-height additions
     *
     * @param {Object} page - The page object containing marginalia blocks.
     * @param {Object} list - Rule list to append to.
     * @param {Object} item - The current rule or rule block.
     * @param {Object} sheet - The stylesheet to insert rules into.
     */
    addMarginaliaStyles(page: PageModel, list: List, item: CssNode, sheet: SheetLike): void;
    /**
     * Generates the content-only display rules for marginalia.
     * Adds `display: none` or `display: block` for margin content depending on whether `content: none` is used.
     *
     * @param {Object} page - Page object with marginalia blocks.
     * @param {Object} list - Rule list.
     * @param {Object} item - Rule being built.
     * @param {Object} sheet - Stylesheet to which rules are inserted.
     */
    addMarginaliaContent(page: PageModel, list: List, item: CssNode, sheet: SheetLike): void;
    addRootVars(ast: CssNode, width: DimensionValue, height: DimensionValue, orientation: string | undefined, bleed: BleedSides | undefined, bleedrecto: BleedSides | undefined, bleedverso: BleedSides | undefined, marks: string[] | undefined): void;
    /**
     * Appends CSS rules for footnotes, sidenotes, or other types of page notes.
     *
     * Each note rule targets a `.paged_<type>_content` class inside the given page selector.
     *
     * @param {Object} notes - Object where each key is a note type (e.g. "footnote") and value is a Block node.
     * @param {Object} page - The page object.
     * @param {Object} list - The CSS rule list to append new note rules to.
     * @param {Object} item - Not used here, but may be for future insertion reference.
     * @param {Object} sheet - The stylesheet object (not used in this function).
     */
    addNotesStyles(notes: Record<string, CssNode>, page: PageModel, list: List, item: CssNode, sheet: SheetLike): void;
    addRootPage(ast: CssNode, size: SizeSpec, bleed?: BleedSides, bleedrecto?: BleedSides, bleedverso?: BleedSides): void;
    /**
     * Parses an nth selector string (e.g., "2n+1") into its components.
     *
     * @param {string} nth - The nth selector string.
     * @returns {object} Parsed nth object in An+B format.
     */
    getNth(nth: string): CssNode;
    /**
     * Adds page-specific classes based on dataset attributes.
     *
     * @param {object} page - The page object.
     * @param {HTMLElement} start - The element marking the start of the page.
     * @param {Array} pages - The array of all pages.
     */
    addPageAttributes(page: ChunkerPage, start: Element, pages: ChunkerPage[]): void;
    /**
     * Determines the start element for content on a new page.
     *
     * @param {HTMLElement} content - The content container.
     * @param {object} breakToken - The token representing where the break occurred.
     * @returns {HTMLElement|undefined} The starting element.
     */
    getStartElement(content: Element | Document | undefined, breakToken: BreakTokenRef | undefined): Element | null | undefined;
    beforePageLayout(page: ChunkerPage, contents: Element | Document | undefined, breakToken: BreakTokenRef | undefined, chunker: ChunkerSource): void;
    afterPageLayout(page: ChunkerPage, contents: Element | Document | undefined, breakToken: BreakTokenRef | undefined, chunker: ChunkerSource): void;
    finalizePage(fragment: Element, page: ChunkerPage, breakToken: BreakTokenRef | undefined, chunker: ChunkerSource): void;
    /**
     * Builds a list of CSS selectors for a given page.
     * @param {object} page - The page object.
     * @returns {csstree.List} A list of CSS selector nodes.
     */
    selectorsForPage(page: PageModel): List;
    /**
     * Builds CSS selectors for a specific margin area of a page.
     * @param {object} page - The page object.
     * @param {string} margin - The margin position (e.g. "top", "bottom").
     * @returns {csstree.List} A list of CSS selector nodes for the margin.
     */
    selectorsForPageMargin(page: PageModel, margin: string): List;
    /**
     * Creates a CSS declaration for a property with a simple identifier value.
     * @param {string} property - The CSS property name.
     * @param {string} value - The CSS value.
     * @param {boolean} important - Whether the declaration is !important.
     * @returns {object} A CSSTree declaration node.
     */
    createDeclaration(property: string, value: string, important?: boolean): {
        type: string;
        loc: null;
        important: boolean | undefined;
        property: string;
        value: {
            type: string;
            loc: null;
            children: List<CssNode>;
        };
    };
    /**
     * Creates a raw CSS variable declaration.
     * @param {string} property - The variable name.
     * @param {string} value - The raw CSS value.
     * @returns {object} A CSSTree declaration node.
     */
    createVariable(property: string, value: string): {
        type: string;
        loc: null;
        property: string;
        value: {
            type: string;
            value: string;
        };
    };
    /**
     * Creates a CSS calc() declaration from multiple dimensions.
     * @param {string} property - The CSS property name.
     * @param {Array} items - Array of {value, unit} objects.
     * @param {boolean} important - Whether the declaration is !important.
     * @param {string} [operator='+'] - Math operator (e.g. '+', '-', etc.).
     * @returns {object} A CSSTree declaration node.
     */
    createCalculatedDimension(property: string, items: DimensionValue[], important?: boolean, operator?: string): {
        type: string;
        loc: null;
        important: boolean | undefined;
        property: string;
        value: {
            type: string;
            loc: null;
            children: List<CssNode>;
        };
    };
    /**
     * Creates a CSS dimension-based declaration.
     * @param {string} property - The CSS property.
     * @param {object} cssValue - Object with `value` and `unit` keys.
     * @param {boolean} important - Whether the declaration is !important.
     * @returns {object} A CSSTree declaration node.
     */
    createDimension(property: string, cssValue: DimensionValue, important?: boolean): {
        type: string;
        loc: null;
        important: boolean | undefined;
        property: string;
        value: {
            type: string;
            loc: null;
            children: List<CssNode>;
        };
    };
    /**
     * Creates a CSSTree Block node from an array of declarations.
     * @param {Array} declarations - Array of CSSTree declaration nodes.
     * @returns {object} A CSSTree block node.
     */
    createBlock(declarations: CssNode[]): {
        type: string;
        loc: null;
        children: List<CssNode>;
    };
    /**
     * Creates a CSSTree Rule node from selectors and a block.
     * @param {csstree.List} selectors - List of selector nodes.
     * @param {object|Array} block - A block node or array of declarations.
     * @returns {object} A CSSTree rule node.
     */
    createRule(selectors: List, block: CssNode | CssNode[]): {
        type: string;
        prelude: {
            type: string;
            children: List<CssNode>;
        };
        block: CssNode;
    };
}
export default AtPage;
