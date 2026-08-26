/**
 * Parses and processes a flow of content (HTML or DOM nodes) offscreen.
 * Adds unique references to elements for later retrieval or tracking.
 */
declare class ContentParser {
    dom?: DocumentFragment | Node;
    refs?: Record<string, HTMLElement>;
    /**
     * Create a new ContentParser instance.
     *
     * @param {string | Node} content - HTML string or DOM Node to be parsed.
     * @param {Function} [cb] - Optional callback (currently unused).
     * @returns {DocumentFragment | Node} The parsed DOM fragment or node.
     */
    constructor(content: string | Node, cb?: unknown);
    /**
     * Parses an HTML string into a DocumentFragment and adds `data-ref` attributes.
     *
     * @param {string} markup - The HTML markup to parse.
     * @param {string} [mime] - Optional MIME type (currently unused).
     * @returns {DocumentFragment} A document fragment with processed nodes.
     */
    parse(markup: string, mime?: unknown): DocumentFragment;
    /**
     * Processes a DOM Node by cloning its structure (if needed) and adding `data-ref` attributes.
     *
     * @param {Node} contents - A DOM Node or DocumentFragment to process.
     * @returns {Node} The processed content with references.
     */
    add(contents: Node): Node;
    /**
     * Walks the content tree and adds a `data-ref` attribute (UUID) to each element.
     * Also preserves original `id` attributes via `data-id`.
     *
     * @param {Node} content - A DOM Node or DocumentFragment to annotate.
     */
    addRefs(content: Node): void;
    /**
     * Finds a DOM node by its reference ID (this.refs must be pre-populated externally).
     *
     * @param {string} ref - The `data-ref` UUID to search for.
     * @returns {HTMLElement|undefined} The associated element, if found.
     */
    find(ref: string): HTMLElement | undefined;
    /**
     * Cleans up the parser's references and DOM structure.
     */
    destroy(): void;
}
export default ContentParser;
