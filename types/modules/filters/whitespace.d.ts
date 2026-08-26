import Handler from "../handler.js";
import type { HandlerSource } from "../handler.js";
/**
 * Filters and normalizes whitespace-only text nodes that are not visually meaningful.
 *
 * Removes or replaces ignorable text nodes (e.g., extra line breaks, tabs, or spaces)
 * except in contexts where whitespace is meaningful (e.g., inside `<pre>` tags).
 *
 * @class
 * @extends Handler
 */
declare class WhiteSpaceFilter extends Handler {
    /**
     * Create a WhiteSpaceFilter instance.
     *
     * @param {Object} chunker - Handles document chunking.
     * @param {Object} polisher - Handles CSS polishing/styling.
     * @param {Object} caller - The invoking processor or engine.
     */
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    /**
     * Filters out or normalizes ignorable whitespace-only text nodes from content.
     *
     * @param {DocumentFragment | HTMLElement} content - The DOM content to filter.
     */
    filter(content: DocumentFragment | HTMLElement): void;
    /**
     * Determines whether a text node should be removed or normalized.
     * Replaces content with a single space if it's between significant siblings,
     * and removes the node if it's safe to do so.
     *
     * @param {Text} node - The text node to evaluate.
     * @returns {number} A NodeFilter constant indicating filter behavior.
     */
    filterEmpty(node: Text): number;
}
export default WhiteSpaceFilter;
