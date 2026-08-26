import Handler, { type HandlerSource } from "../handler.js";
import type { CssNode, List } from "css-tree";
interface RunningHeaderValue {
    identifier: string;
    value?: string;
    selector: string;
    first?: Element;
}
interface RunningHeadersData {
    [name: string]: RunningHeaderValue;
}
interface ElementContentValue {
    func: string;
    args: string[];
    value: string;
    style: string;
    selector: string;
    fullSelector: string;
}
interface ElementContentData {
    [selector: string]: ElementContentValue;
}
interface RuleContext {
    ruleNode: CssNode;
    ruleItem?: List.Cursor;
    rulelist?: List;
}
interface SheetSource {
    text?: string;
}
/**
 * Handles CSS Running Headers/Footers using the `position: running()` and `content: element()` CSS features.
 *
 * Tracks selectors with running headers, manages their capture and placement,
 * and applies them during page layout.
 *
 * @class
 * @extends Handler
 */
declare class RunningHeaders extends Handler {
    runningSelectors: RunningHeadersData;
    elements: ElementContentData;
    orderedSelectors?: string[];
    /**
     * Creates an instance of RunningHeaders.
     *
     * @param {Object} chunker - The chunker instance controlling content chunking.
     * @param {Object} polisher - The polisher instance controlling polishing/styling.
     * @param {Object} caller - The caller or controller invoking this handler.
     */
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    /**
     * Processes CSS declarations to find and store `position: running()` and `content: element()` rules.
     *
     * @param {Object} declaration - The CSS declaration node.
     * @param {Object} dItem - Declaration item (not used here).
     * @param {Object} dList - Declaration list (not used here).
     * @param {Object} rule - The CSS rule node that contains the declaration.
     */
    onDeclaration(declaration: CssNode, dItem: List.Cursor, dList: List, rule: RuleContext): void;
    afterParsed(fragment: ParentNode): void;
    afterPageLayout(fragment: HTMLElement): void;
    /**
     * Assigns a weight to @page selector classes for ordering.
     *
     * Weights:
     * 1) page
     * 2) left & right
     * 3) blank
     * 4) first & nth
     * 5) named page
     * 6) named left & right
     * 7) named first & nth
     *
     * @param {string} [s] - The selector string.
     * @returns {number} Weight value for ordering.
     */
    pageWeight(s: string): number;
    /**
     * Orders selectors based on their page weight.
     *
     * Does not deduplicate selectors; later selectors overwrite previous ones.
     *
     * @param {Object<string, any>} obj - The selectors object.
     * @returns {Array<string>} Ordered selectors array.
     */
    orderSelectors(obj: ElementContentData): string[];
    /**
     * Adjusts CSS text before parsing.
     *
     * Fixes parsing issues with `element()` by renaming it to `element-ident()`.
     *
     * @param {string} text - The CSS text to parse.
     * @param {Object} sheet - The CSS stylesheet object.
     */
    beforeTreeParse(text: string, sheet: SheetSource): void;
}
export default RunningHeaders;
