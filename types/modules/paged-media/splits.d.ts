import Handler from "../handler.js";
import type { HandlerSource } from "../handler.js";
/**
 * Handles split content across paginated pages.
 *
 * When content is split across pages (e.g., footnotes or paragraphs),
 * this handler links the split parts together using data attributes
 * (`data-split-from`, `data-split-to`, etc.) to assist layout engines
 * or post-processing logic.
 */
declare class Splits extends Handler {
    /**
     * Create a new Splits handler instance.
     *
     * @param {Object} chunker - The chunker instance used for page breaking.
     * @param {Object} polisher - The polisher instance used for styling.
     * @param {Object} caller - The orchestrating object coordinating handlers.
     */
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
    /**
     * Called after the layout of each page is completed.
     *
     * - Detects elements on the current page that have been split from a previous page.
     * - Finds the original element on the previous page and adds metadata to link them.
     * - Applies alignment adjustments to the original element.
     *
     * @param {HTMLElement} pageElement - The root element of the current page.
     * @param {Object} page - Page metadata object.
     * @param {Object|null} breakToken - Information about the point where the content was split.
     * @param {Object} chunker - The chunker instance.
     */
    afterPageLayout(pageElement: HTMLElement, page: any, breakToken: any, chunker: any): void;
    /**
     * Adjusts alignment metadata for a split element to preserve proper justification.
     *
     * This ensures that the last line of split content aligns correctly,
     * particularly when text-align is set to `justify`.
     *
     * @param {HTMLElement} node - The original DOM node that was split.
     */
    handleAlignment(node: HTMLElement): void;
}
export default Splits;
