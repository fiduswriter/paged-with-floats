/**
 * Cleans pseudo-element content strings by:
 * - Trimming specified characters from the start and end (default: quotes and spaces).
 * - Escaping quotes.
 * - Replacing newlines with CSS-compatible `\00000A` notation.
 *
 * @param {string|null} el - The pseudo-element content string (e.g., from `content` CSS property).
 * @param {string} [trim="\"' "] - Characters to trim from both ends of the string.
 * @returns {string|undefined} The cleaned content string, or `undefined` if input is null or undefined.
 */
export declare function cleanPseudoContent(el: string | null, trim?: string): string | undefined;
/**
 * Removes specific pseudo-elements from a CSS selector string.
 * Currently strips:
 * - `::footnote-call`
 * - `::footnote-marker`
 *
 * @param {string|null} el - The CSS selector string to clean.
 * @returns {string|undefined} The cleaned selector string, or `undefined` if input is null or undefined.
 */
export declare function cleanSelector(el: string | null): string | undefined;
