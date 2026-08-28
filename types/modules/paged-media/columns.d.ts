import Handler, { type HandlerSource } from "../handler.js";
import type { CssNode, List } from "css-tree";
interface RuleContext {
    ruleNode: CssNode;
    [key: string]: any;
}
/** Root-level column configuration captured from `body`/`html` rules. */
interface RootColumnCssConfig {
    count?: number;
    gap?: string;
    fill?: "auto" | "balance";
    ruleColor?: string;
    ruleStyle?: string;
    ruleWidth?: string;
}
/**
 * Tracks multi-column rules from author CSS.
 *
 * For content-level selectors the declarations are left in place so that
 * cloned page content receives the browser's native multi-column
 * formatting; this handler records which selectors produce fragmentainers
 * and hands that knowledge to the chunker for use during layout.
 *
 * Column declarations on `body`/`html` are treated as *root-level* column
 * configuration instead: they are captured into `rootColumnsFromCss` for
 * the chunker (which applies them to each page's flow wrapper) and removed
 * from the stylesheet. Shipping them would restyle the host document —
 * most visibly turning the rendered page list itself into a browser
 * multicol container.
 *
 * Nested multicol (a fragmentainer inside another fragmentainer) is not
 * supported; the layout stage degrades the inner container to a single
 * column and warns.
 */
declare class Columns extends Handler {
    /** Selectors seen in author CSS that declare multi-column formatting. */
    multicolSelectors: Set<string>;
    /** Selectors declaring `column-span: all` (full-width rows). */
    columnSpanSelectors: Set<string>;
    /** Root-level config assembled from body/html column declarations. */
    rootColumnsFromCss: RootColumnCssConfig;
    /**
     * Whether an `!important` root column-count was seen; further
     * non-important declarations must not override it.
     */
    private rootColumnsCountLocked;
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    /**
     * Whether a selector targets the document root elements, making its
     * column declarations a root-level configuration rather than styling
     * for flow content.
     */
    private isRootSelector;
    /**
     * Extracts the column count from a `column-count` / `columns`
     * declaration value, or undefined when the value carries none
     * (e.g. `columns: <width>` alone).
     */
    private countFromDeclaration;
    onDeclaration(declaration: CssNode, dItem: List.Cursor, dList: List, rule: RuleContext): void;
}
export default Columns;
