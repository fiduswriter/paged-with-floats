import { type EmitMetadata, type EmitOptions } from "./pdf/pdf-emitter.js";
export { printHTML, type PrintHTMLConfig, } from "./print.js";
export { emitPdfFromPagedjsWindow, } from "./pdf/pdf-emitter.js";
/**
 * Options for {@link htmlToPDF}: pagination/print configuration combined
 * with the PDF emission extras.
 */
export interface HtmlToPDFOptions {
    /** Applied to the paginated iframe document and default PDF title. */
    title?: string;
    /** URL of the paged-with-floats polyfill bundle for the print frame. */
    polyfillURL?: string;
    /** Extra Previewer settings (textMeasurement etc.). */
    settings?: Record<string, unknown>;
    /** Source HTML embedded as a PDF file attachment when provided. */
    sourceHtml?: string;
    /** Document metadata (title/author/subject/keywords/language). */
    metadata?: EmitMetadata;
    /** Base URL for resolving fonts and assets in the paginated output. */
    baseUrl?: string;
    /** Where the WOFF2 decoder wasm lives (string URL or raw bytes). */
    woff2WasmUrl?: string | ArrayBuffer;
    /** Additional files to attach to the PDF. */
    attachments?: import("./pdf/pdf-emitter.js").EmitAttachment[];
    /** Print-level extras passed through to the emitter. */
    printOptions?: EmitOptions["printOptions"];
}
/**
 * Paginates `html` with paged-with-floats and returns real vector PDF bytes —
 * no print dialog involved. Composition of `printHTML` and
 * `emitPdfFromPagedjsWindow`, with iframe cleanup handled internally.
 *
 * @param html - A complete HTML document string.
 * @param options - Pagination and emission options.
 * @returns The PDF file bytes.
 */
export declare function htmlToPDF(html: string, options?: HtmlToPDFOptions): Promise<Uint8Array>;
