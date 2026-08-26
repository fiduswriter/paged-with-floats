import Handler from "../handler.js";
import type { HandlerSource } from "../handler.js";
/**
 * Handler that removes all <script> elements from the content.
 *
 * @class
 * @extends Handler
 */
declare class ScriptsFilter extends Handler {
    /**
     * Create a ScriptsFilter instance.
     *
     * @param {Object} chunker - Responsible for managing document chunks during rendering.
     * @param {Object} polisher - Handles post-processing and styling of content.
     * @param {Object} caller - The entity invoking this handler (e.g., layout controller).
     */
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    /**
     * Removes all <script> elements from the given DOM content.
     *
     * @param {DocumentFragment | HTMLElement} content - The DOM content to sanitize.
     */
    filter(content: DocumentFragment | HTMLElement): void;
}
export default ScriptsFilter;
