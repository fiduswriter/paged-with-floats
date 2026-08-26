import Handler, { type HandlerSource } from "../handler.js";
import type { CssNode, List } from "css-tree";
interface RuleContext {
    ruleNode: CssNode;
    [key: string]: any;
}
/**
 * Tracks multi-column rules from author CSS.
 *
 * The declarations themselves are left in place so that cloned page content
 * receives the browser's native multi-column formatting; this handler only
 * records which selectors produce fragmentainers and hands that knowledge to
 * the chunker for use during layout.
 *
 * Nested multicol (a fragmentainer inside another fragmentainer) is not
 * supported; the layout stage degrades the inner container to a single
 * column and warns.
 */
declare class Columns extends Handler {
    /** Selectors seen in author CSS that declare multi-column formatting. */
    multicolSelectors: Set<string>;
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    onDeclaration(declaration: CssNode, dItem: List.Cursor, dList: List, rule: RuleContext): void;
}
export default Columns;
