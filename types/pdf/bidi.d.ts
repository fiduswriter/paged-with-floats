/**
 * Derived from vivliostyle-pdf (https://github.com/fiduswriter/vivliostyle-pdf)
 * LGPL-3.0-or-later © Johannes Wilm. Adapted for paged-with-floats output.
 */
/**
 * Minimal Unicode-direction run splitter.
 *
 * pdf-lib's drawText lays a whole string out with a single auto-detected
 * text direction (via fontkit), so a mixed-bidi string — e.g. an Arabic word
 * containing Latin letters or digits — would be shaped with one wrong
 * direction. The emitter therefore splits every "word" token into
 * direction-homogeneous runs and measures/draws each run at its own rect
 * (the browser has already run the full Unicode Bidi Algorithm, so per-run
 * rects are exact).
 *
 * This is a deliberately small approximation of the UBA: strong RTL / strong
 * LTR / digits are classified, neutral characters (spaces, punctuation)
 * inherit the direction of the preceding character, and leading neutrals
 * take the paragraph direction. It does not implement explicit formatting
 * characters or the embedding algorithm.
 */
export interface BidiRun {
    text: string;
    /** Offset of the run within the original string. */
    start: number;
    /** True when the run should be laid out right-to-left. */
    rtl: boolean;
}
/**
 * Split `text` into maximal runs whose characters share one direction.
 * Every character of the input is assigned to exactly one run (the runs
 * partition the string, so `slice(run.start, run.end)` is never empty and
 * offsets can be fed directly to Range.setStart/setEnd).
 *
 * @param baseRtl  paragraph direction (e.g. `direction: rtl`); true → RTL.
 */
export declare function splitBidiRuns(text: string, baseRtl?: boolean): BidiRun[];
