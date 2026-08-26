export type FontFormat = "ttf" | "otf" | "woff" | "woff2" | "ttc" | "unknown";
/**
 * Configure where the WOFF2 decoder's wasm lives. Accepts a URL string or the
 * wasm's raw bytes as an `ArrayBuffer`. Passing `null` reverts to the default
 * (Node: the package's own `woff2.wasm`; browser: derived from the page base).
 */
export declare function setWoff2WasmUrl(url: string | ArrayBuffer | null): void;
/**
 * Decode a WOFF2 font into sfnt (TrueType/OpenType) bytes using
 * fonteditor-core's WASM decoder. Returns `null` when the decoder is
 * unavailable or the bytes are not a valid WOFF2 font.
 */
export declare function woff2ToSfnt(bytes: Uint8Array): Promise<Uint8Array | null>;
/** Sniff the font container format from its magic bytes. */
export declare function detectFontFormat(bytes: Uint8Array): FontFormat;
/** The two container formats pdf-lib can embed verbatim. */
export type EmbeddableFontFormat = "ttf" | "otf";
/**
 * A layout-independent signature of an sfnt font's *content*: the version
 * plus, per table, its tag, length and checksum (offset hashing is excluded,
 * so a font re-laid-out in a different physical order — e.g. a WOFF unwrapped
 * back to sfnt — produces the same signature as the original).
 */
export declare function sfntTableSignature(bytes: Uint8Array): string;
export type NormalizeResult = {
    ok: true;
    bytes: Uint8Array;
    format: EmbeddableFontFormat;
} | {
    ok: false;
    reason: string;
};
/**
 * Normalize arbitrary font bytes (data URI payload or fetched file) to
 * embeddable sfnt bytes. Returns an error object for formats we cannot embed
 * (TrueType collections, unknown binaries) or when WOFF2 decoding fails.
 */
export declare function normalizeFontBytes(bytes: Uint8Array): Promise<NormalizeResult>;
/**
 * Unwrap a WOFF container into an sfnt (TrueType/OpenType) file.
 *
 * Follows https://www.w3.org/TR/WOFF/: the table directory points at each
 * table's data, which is zlib-compressed when `compLength < origLength`. The
 * sfnt header, search parameters, per-table checksums (with the `head`
 * checkSumAdjustment per the OpenType spec) and 4-byte padding are rebuilt.
 */
export declare function woffToSfnt(woff: Uint8Array): Promise<Uint8Array>;
