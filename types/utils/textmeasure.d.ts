import { type PreparedTextWithSegments, type LayoutCursor } from "@chenglou/pretext";
import { type PreparedRichInline, type RichInlineItem } from "@chenglou/pretext/rich-inline";
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
    /** CJK word breaking; pretext models `keep-all`, not `break-all`. */
    wordBreak?: "keep-all";
}
/**
 * Cache key covering every input that changes a prepared text's metrics.
 * Shared by the eager warm-up and the lazy prediction path so both hit the
 * same cache entries.
 */
export declare function fontKey(spec: FontSpec): string;
/**
 * Points pretext's segmenter at the document's locale (word breaking rules
 * differ per language). Call once per flow; safe to repeat.
 */
export declare function setMeasureLocale(locale?: string | null): void;
/**
 * Static measurements of a source element used by the column-span segment
 * height planner: everything needed to estimate a block's natural height
 * arithmetically once the source fragment is detached again.
 *
 * Captured while the source is temporarily attached (computed styles
 * resolve), keyed by the element's data-ref.
 */
export interface ElementMeasure {
    /** Canvas font spec for inline content, null when unmeasurable. */
    font: FontSpec | null;
    /** Computed display, e.g. `block`. */
    display: string;
    /** Whether the element establishes a block-level box. */
    block: boolean;
    /** Vertical margins in CSS px (collapsing is ignored by the planner). */
    marginTop: number;
    marginBottom: number;
    /** Horizontal and vertical padding + border sums in CSS px. */
    padBorderX: number;
    padBorderY: number;
}
/**
 * Captures the computed-style record for one element. The element must be
 * attached to the document for styles to resolve; detached elements get no
 * meaningful values from getComputedStyle.
 */
export declare function buildElementMeasure(el: Element): ElementMeasure | null;
/**
 * A contiguous run of inline text sharing one font specification; blocks
 * with mixed inline formatting (bold, italic, size changes) are estimated
 * as a sequence of these so line counts follow the real font metrics.
 */
export interface InlineRun {
    text: string;
    spec: FontSpec;
}
/**
 * Counts the lines a text wraps into at the given width, using the shared
 * pretext measurement cache (pure arithmetic once the text is prepared).
 * Returns null when the specification cannot be measured, so callers can
 * fall back to a DOM probe. Hyphenation is not modelled, so the count can
 * err on the high side for `hyphens: auto` text — never on the low side.
 */
export declare function measureTextLines(service: TextMeasureService, text: string, spec: FontSpec | null, width: number): number | null;
/**
 * Height of a block's inline content at the given width. Single-font blocks
 * go through the plain text path (sharing its cache with textBreak); blocks
 * mixing fonts are laid out as rich inline runs so each run is measured in
 * its own font. Line height is the largest run's (a line is as tall as its
 * tallest inline box). Returns null when the runs cannot be modelled
 * (e.g. pre-wrap mixed content), so the caller can fall back to a DOM probe.
 *
 * Lines are counted at a slightly narrower width than given: canvas and DOM
 * font metrics drift apart by a few percent (different fallback chains,
 * kerning), which would otherwise systematically underestimate the count.
 */
export declare function measureInlineRunsHeight(service: TextMeasureService, runs: InlineRun[], width: number): number | null;
export declare function measurementCapabilities(): boolean;
/**
 * Builds a canvas font specification from an element's computed style.
 * Returns null when the style cannot be mapped faithfully enough to bother
 * predicting (the caller then uses the legacy path).
 */
export declare function buildFontSpec(el: Element | null | undefined): FontSpec | null;
export declare class TextMeasureService {
    private cache;
    private richCache;
    constructor();
    /**
     * Prepares (and caches) a text for measurement. Cache keys include every
     * input that changes metrics.
     */
    prepare(text: string, spec: FontSpec): PreparedTextWithSegments;
    /**
     * Prepares (and caches) mixed-font inline content for measurement.
     */
    prepareRich(items: RichInlineItem[]): PreparedRichInline;
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
