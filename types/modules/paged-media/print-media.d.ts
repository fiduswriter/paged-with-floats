import Handler from "../handler.js";
import type { CssNode, List } from "css-tree";
import type { HandlerSource } from "../handler.js";
/**
 * Handles `@media print` rules during the stylesheet parsing phase.
 *
 * - Extracts CSS rules inside `@media print` and appends them to the main stylesheet.
 * - Removes `@media` blocks that are neither `print`, `all`, nor explicitly ignored.
 */
declare class PrintMedia extends Handler {
    /**
     * Creates an instance of PrintMedia handler.
     *
     * @param {Object} chunker - The chunker instance used for pagination.
     * @param {Object} polisher - The polisher instance that processes stylesheets.
     * @param {Object} caller - The object that coordinates multiple handlers.
     */
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    /**
     * Called when a `@media` at-rule is encountered in the stylesheet.
     *
     * - If the media type includes `print`, the rules inside are extracted and appended
     *   to the main rule list (i.e. made global).
     * - If the media type is unsupported or not needed, the block is removed entirely.
     *
     * @param {Object} node - The AST node for the `@media` at-rule.
     * @param {Object} item - The item in the list representing this rule.
     * @param {Object} list - The list of all CSS rules being parsed.
     */
    onAtMedia(node: CssNode, item: List.Cursor | any, list: List | any): void;
    /**
     * Extracts all media type names from a `@media` at-rule node.
     *
     * @param {Object} node - The AST node representing a `@media` at-rule.
     * @returns {string[]} An array of media query identifiers (e.g. `["print"]`, `["screen"]`).
     */
    getMediaName(node: CssNode): string[];
}
export default PrintMedia;
