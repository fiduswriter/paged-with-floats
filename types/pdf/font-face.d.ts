/**
 * Derived from vivliostyle-pdf (https://github.com/fiduswriter/vivliostyle-pdf)
 * LGPL-3.0-or-later © Johannes Wilm. Adapted for paged-with-floats output.
 */
/**
 * `@font-face` discovery and CSS font matching.
 *
 * Mirrors how Fidus Writer delivers document-style fonts: the print exporter
 * inlines the style CSS (with asset filenames rewritten to absolute URLs) and
 * the browser loads each font via `@font-face { src: url(...) }`. So the fonts
 * a PDF needs are exactly the `@font-face` rules present in the paginated
 * document. This module enumerates those rules (from a document's stylesheets)
 * and selects the best rule for a text run using CSS font matching (family,
 * style, weight bands).
 */
export interface FontFaceSrc {
    url: string;
    /** The `format(...)` hint, lowercased, or null when absent. */
    format: string | null;
}
export interface FontFaceDescriptor {
    /** As written in `font-family` (quotes stripped). */
    family: string;
    /** Inclusive weight band from the `font-weight` descriptor. */
    weightLower: number;
    weightUpper: number;
    /** `normal` | `italic` | `oblique[ <angle>]`. */
    style: string;
    /** Ordered `src` candidates (later entries are lower priority). */
    srcs: FontFaceSrc[];
}
/**
 * Split a computed `font-family` value into its family tokens, stripping
 * quotes and vivliostyle's generated `Fnt_<n>` aliases (the original family
 * names always survive after them).
 */
export declare function parseFontFamilyList(fontFamily: string): string[];
/** Parse a `font-weight` descriptor value into an inclusive band. */
export declare function parseWeightRange(weight: string): {
    lower: number;
    upper: number;
};
/**
 * Extract `url(...)` (with optional `format(...)`) tokens from a `src`
 * descriptor string, in declaration order.
 */
export declare function parseSrc(src: string): FontFaceSrc[];
/** Resolve a possibly-relative src URL against a base (absolute URLs pass through). */
export declare function resolveSrcUrl(url: string, base: string): string;
/** Extract the descriptor from a CSSFontFaceRule, with src URLs resolved. */
export declare function parseFontFaceRule(rule: CSSFontFaceRule, baseUrl: string): FontFaceDescriptor | null;
/**
 * Collect every `@font-face` rule reachable from a document's stylesheets
 * (recursing through `@import` and grouping rules like `@media`). Cross-origin
 * sheets can throw on `cssRules` access; those are skipped so a locked-down
 * remote stylesheet cannot break export.
 */
export declare function collectFontFaceRules(doc: Document, baseUrl: string): FontFaceDescriptor[];
export declare const normalizeFamily: (family: string) => string;
/** Generic CSS family keywords — never `@font-face` family names. */
export declare const GENERIC_FAMILY_NAMES: Set<string>;
/**
 * Order a family's candidate rules best-first using simplified CSS Fonts
 * Level 4 matching for weight/style: style-matched rules come before any rule
 * that cannot render the requested style (rank 4); among equally ranked
 * candidates the closest weight band wins, ties prefer the heavier band.
 */
export declare function rankCandidates(candidates: FontFaceDescriptor[], requestedWeight: number, requestedStyle: string): FontFaceDescriptor[];
/**
 * CSS font matching (simplified CSS Fonts Level 4 for weight/style) over the
 * given rules:
 *
 * - family names are tried in the computed `font-family` order; a family with
 *   no rule (or no style that can satisfy the request) is skipped;
 * - within each family, candidates are ordered by {@link rankCandidates}.
 *
 * Returns the best `@font-face` descriptor, or null when nothing matches.
 */
export declare function selectFontFace(rules: FontFaceDescriptor[], familyList: string[], requestedWeight: number, requestedStyle: string): FontFaceDescriptor | null;
