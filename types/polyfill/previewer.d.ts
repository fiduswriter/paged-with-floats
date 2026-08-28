import Hook from "../utils/hook.js";
import Chunker from "../chunker/chunker.js";
import Polisher from "../polisher/polisher.js";
import type { PolisherHooks } from "../polisher/polisher.js";
import { type OverflowViolation } from "../chunker/layout.js";
import type Page from "../chunker/page.js";
import { initializeHandlers } from "../utils/handlers.js";
import type Handler from "../modules/handler.js";
import type { PagedEventEmitter } from "../types/emitter.js";
import type { PagedConfig } from "./polyfill.js";
export interface PageSize {
    value: number;
    unit: string;
}
export interface Size {
    width: PageSize;
    height: PageSize;
    format?: string;
    orientation?: string;
}
export type FlowResult = Chunker & {
    pages: Page[];
    performance?: number;
    size?: Size;
    /** Pages with content outside its designated space (post-render audit). */
    overflowViolations?: OverflowViolation[];
};
/**
 * The main class responsible for preparing, chunking, styling, and rendering content into paginated previews.
 *
 * Emits events:
 * - `page`: when a page is rendered
 * - `rendering`: when rendering starts
 * - `rendered`: when rendering finishes
 * - `size`: when page size is set
 * - `atpages`: when @page rules are processed
 */
declare class Previewer {
    settings: Record<string, unknown>;
    polisher: Polisher;
    chunker: Chunker;
    hooks: {
        beforePreview: Hook<[unknown, unknown]>;
        afterPreview: Hook<[Page[]]>;
    };
    size: Size;
    atpages?: unknown[];
    handlers?: ReturnType<typeof initializeHandlers>;
    /**
     * Create a new Previewer instance.
     * @param {Object} [options] - Optional configuration settings for rendering.
     */
    constructor(options?: Record<string, unknown>);
    /**
     * Initializes handler modules (like footnotes, counters, etc.) and sets up relevant events.
     * @returns {Object} - The handler system that manages internal processing hooks.
     */
    initializeHandlers(): import("../utils/handlers.js").Handlers;
    /**
     * Registers handlers with custom logic or extensions.
     * @returns {*} - The result of the registerHandlers function.
     */
    registerHandlers(...args: Array<typeof Handler>): void;
    /**
     * Retrieve a query parameter from the current URL.
     * @param {string} name - Name of the parameter.
     * @returns {string | undefined} - Parameter value if found.
     */
    getParams(name: string): string | undefined;
    /**
     * Wraps the contents of the `<body>` in a `<template>` element if not already present.
     * This is used to preserve the original content for chunking and layout.
     *
     * @returns {DocumentFragment} - The wrapped content.
     */
    wrapContent(): DocumentFragment;
    /**
     * Removes stylesheets and inline `<style>` elements that should not be processed.
     * Also returns the list of removed styles for reprocessing later.
     *
     * @param {Document} [doc=document] - The document to process styles from.
     * @returns {Array} - Array of stylesheet hrefs or inline style objects.
     */
    removeStyles(doc?: Document): Array<string | Record<string, string> | undefined>;
    /**
     * Harvests stylesheets embedded in the content itself — `<style>`
     * elements and stylesheet `<link>`s that live inside the body/fragment
     * rather than the document head.
     *
     * Manual `Previewer` callers typically pass a fragment whose CSS is
     * embedded in it (demos, editable previews). Without harvesting, that
     * CSS never reaches the polisher: handlers never see the declarations
     * (page floats go untagged, `@page` rules stay dead) and the raw rules
     * apply globally once rendered. The elements are removed from the
     * content and returned for polisher processing.
     *
     * @param {DocumentFragment|HTMLElement} content - The content to harvest from.
     * @returns {Array} - Stylesheet hrefs / inline style objects, in document order.
     */
    removeContentStyles(content?: DocumentFragment | HTMLElement | string | null): Array<string | Record<string, string> | undefined>;
    /**
     * Main method for rendering content into paginated preview.
     * Triggers hooks and events, applies stylesheets, chunks the content, and returns the flow result.
     *
     * @param {HTMLElement|DocumentFragment|string} [content] - The content to render.
     * @param {Array<string|Object>} [stylesheets] - List of stylesheet hrefs or inline styles to apply.
     * @param {HTMLElement|string} [renderTo] - Element or selector where rendered content will be inserted.
     * @returns {Promise<Object>} - Resolves to the rendered flow object with performance and size metadata.
     */
    preview(content?: HTMLElement | DocumentFragment | string, stylesheets?: Array<string | Record<string, string> | undefined>, renderTo?: HTMLElement | string): Promise<FlowResult>;
}
interface Previewer extends PagedEventEmitter {
}
export default Previewer;
export type { PolisherHooks };
export type { PagedConfig };
