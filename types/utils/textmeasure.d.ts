import { type PreparedTextWithSegments, type LayoutCursor } from "@chenglou/pretext";
/**
 * Canvas/Intl-backed text measurement used to predict text break offsets
 * arithmetically instead of probing the DOM once per word.
 *
 * Pretext measures segment widths through the browser's own font engine
 * (canvas measureText) and caches them, so repeated line-layout passes are
 * pure arithmetic. Predicted break offsets are verified against real DOM
 * geometry by the caller.
 *
 * TEMPORARY: the legacy DOM-walking fallback in Layout.textBreak exists
 * only until parity testing shows this predictor handles every case; it is
 * then removed along with these capability gates.
 */
export interface FontSpec {
    /** Canvas font shorthand, e.g. `400 16px "Times New Roman"`. */
    font: string;
    /** Resolved letter-spacing in CSS px (0 when normal). */
    letterSpacing: number;
    /** Whitespace handling matched to the element's computed style. */
    whiteSpace: "normal" | "pre-wrap";
    /** Used line height in CSS px. */
    lineHeight: number;
}
export declare function measurementCapabilities(): boolean;
/**
 * Builds a canvas font specification from an element's computed style.
 * Returns null when the style cannot be mapped faithfully enough to bother
 * predicting (the caller then uses the legacy path).
 */
export declare function buildFontSpec(el: Element | null | undefined): FontSpec | null;
export declare class TextMeasureService {
    private cache;
    constructor();
    /**
     * Prepares (and caches) a text for measurement. Cache keys include every
     * input that changes metrics.
     */
    prepare(text: string, spec: FontSpec): PreparedTextWithSegments;
    /**
     * Lays out successive lines of `prepared` at the given widths, invoking
     * `onLine` with each range. Returns the number of lines produced.
     *
     * `firstMaxWidth` allows the first line to be partially occupied (when a
     * node continues mid-line after inline siblings). `startCursor` resumes
     * layout from a previous position (continuation reuse).
     */
    walkLines(prepared: PreparedTextWithSegments, firstMaxWidth: number, maxWidth: number, onLine: (line: {
        start: LayoutCursor;
        end: LayoutCursor;
        width: number;
    }) => boolean | void, startCursor?: LayoutCursor): number;
    /**
     * Maps a layout cursor to a UTF-16 code-unit offset in the original
     * string. Cursors mid-cluster resolve to the cluster start (the extra
     * grapheme fraction is approximated proportionally within the cluster).
     */
    cursorToOffset(prepared: PreparedTextWithSegments, cursor: LayoutCursor): number;
    /**
     * Maps a character offset to a layout cursor via prefix sums.
     */
    offsetToCursor(prepared: PreparedTextWithSegments, offset: number): LayoutCursor;
}
export declare function getTextMeasureService(): TextMeasureService;
