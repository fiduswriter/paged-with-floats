import type { FontkitFont } from "fontkit";
import { PDFFont } from "@pdfme/pdf-lib";
import { type FontFaceDescriptor } from "./font-face.js";
type FontCut = "regular" | "bold" | "italic" | "boldItalic";
interface FontMetrics {
    /** ascent and descent in px for a given font size (from fontkit, em-scaled) */
    ascent(sizePx: number): number;
    descent(sizePx: number): number;
}
/** A font embedded into the PDF (from @font-face discovery or the fallback set). */
interface LoadedFont {
    pdfFont: PDFFont;
    metrics: FontMetrics;
    key: FontKey;
    /** fontkit instance of the same font file — used for glyph coverage queries. */
    fkFont: FontkitFont;
}
/** Stable key identifying an embedded font file. */
type FontKey = string;
/**
 * Everything the emitter needs to resolve a text run's font: the discovered
 * `@font-face` rules, the embedded font per rule, and the bundled fallbacks.
 */
interface FontSelectionContext {
    rules: FontFaceDescriptor[];
    /** embedded-font key per rule; only rules that loaded successfully are present. */
    keyByRule: Map<FontFaceDescriptor, FontKey>;
    /** every embedded font (discovered + fallback), keyed by FontKey. */
    byKey: Map<FontKey, LoadedFont>;
    /** bundled last-resort fonts per generic family (serif / monospace / universal). */
    fallback: Map<string, Partial<Record<FontCut, FontKey>>>;
    /** memoizes per-glyph fallback resolutions across runs. */
    glyphFallbackCache: Map<string, FontKey | null>;
}
export type DecorationStyle = "solid" | "double" | "dotted" | "dashed" | "wavy";
/** A piece of a word run drawn with a single embedded font. */
interface WordSegment {
    text: string;
    fontKey: FontKey;
}
/** Document metadata to embed (sourced from the original HTML head — the
    paginated iframe DOM does not retain the source <head>). */
export interface EmitMetadata {
    title?: string;
    author?: string;
    subject?: string;
    /** comma-separated */
    keywords?: string;
    language?: string;
    /** PDF /Creator string. Defaults to the library's own string. */
    creator?: string;
    /** PDF /Producer string. Defaults to the library's own string. */
    producer?: string;
}
export interface PrintOptions {
    /** Draw registration/crop marks around each page. */
    cropMarks?: boolean;
    /** Include a PDF TrimBox matching the final page size. */
    trimBox?: boolean;
    /** Include a PDF BleedBox enlarged by bleedMm on every side. */
    bleedBox?: boolean;
    /** Bleed margin in millimetres (default 3). */
    bleedMm?: number;
    /** Draw a visible border around each Link annotation. */
    linkAnnotationBorders?: boolean;
    /** Rasterize SVG images at 2x instead of emitting them as vector PDF. */
    rasterizeSvgs?: boolean;
}
/** A file to embed as a PDF attachment (e.g. a Fidus .fidus source file). */
export interface EmitAttachment {
    filename: string;
    bytes: Uint8Array | ArrayBuffer;
    mimeType: string;
    description?: string;
}
/** Optional extras for emitPdfFromPagedWindow. */
export interface EmitOptions {
    /**
     * The document's HTML source. Used for `@font-face` discovery when the
     * paginated iframe did not retain them. Only embedded as a PDF attachment
     * when `embedSourceHtml` is set.
     */
    sourceHtml?: string;
    /**
     * Whether to embed `sourceHtml` as a file attachment in the PDF. Off by
     * default. Pass `true` to embed it under a default name
     * ("document.html"), or a string to choose the attachment filename (e.g.
     * "my-document.html").
     */
    embedSourceHtml?: boolean | string;
    /** Document metadata from the original HTML head. */
    metadata?: EmitMetadata;
    /** Print-production options (crop marks, trim/bleed boxes). */
    printOptions?: PrintOptions;
    /**
     * Base URL for the library's bundled static assets (fallback fonts,
     * woff2.wasm). Defaults to Vite's BASE_URL (demo) or the page base URL.
     */
    baseUrl?: string;
    /**
     * Where the WOFF2 decoder's wasm lives: a URL string or an `ArrayBuffer`
     * of the wasm bytes. Defaults to `<baseUrl>woff2/woff2.wasm`.
     */
    woff2WasmUrl?: string | ArrayBuffer;
    /** Additional files to attach to the PDF (besides `sourceHtml`). */
    attachments?: EmitAttachment[];
}
/**
 * Emit a PDF from the window of a vivliostyle-print iframe after pagination
 * has completed.
 *
 * @param win  the iframe window passed to printCallback
 * @param onProgress  optional status callback for UI feedback
 * @param options  optional extras (HTML source attachment)
 * @returns the PDF file bytes
 */
export declare function emitPdfFromPagedWindow(win: Window, onProgress?: (message: string) => void, options?: EmitOptions): Promise<Uint8Array>;
/**
 * Split a run's text into segments per font so every character is drawn with
 * a font that actually contains its glyph: the CSS-selected primary font
 * wherever it covers the text, and a fallback font (see
 * {@link resolveGlyphFallbackFontKey}) for the characters it lacks.
 */
export declare function buildWordSegments(ctx: FontSelectionContext, fontFamily: string, fontWeight: string, fontStyle: string, primaryKey: FontKey, text: string): WordSegment[];
export {};
