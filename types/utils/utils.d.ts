/**
 * Gets the bounding client rectangle of an element.
 * Falls back to using Range if element.getBoundingClientRect is undefined.
 *
 * @param {Element | Range} element - The DOM element (or range) to get the bounding rectangle for.
 * @returns {DOMRect | undefined} The bounding client rectangle or undefined if no element.
 */
export declare function getBoundingClientRect(element?: Element | Range): DOMRect | undefined;
/**
 * Gets the client rectangles of an element.
 * Falls back to using Range if element.getClientRects is undefined.
 *
 * @param {Element | Range} element - The DOM element (or range) to get client rectangles for.
 * @returns {DOMRectList | undefined} The client rectangles or undefined if no element.
 */
export declare function getClientRects(element?: Element | Range): DOMRectList | undefined;
/**
 * Generates a UUID (version 4).
 * Based on: http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
 *
 * @returns {string} A UUID string.
 */
export declare function UUID(): string;
/**
 * Find the position of an element in a NodeList.
 *
 * @param {Element} element - The element to find.
 * @param {NodeList} nodeList - The NodeList to search within.
 * @returns {number} The index of the element in the NodeList, or -1 if not found.
 */
export declare function positionInNodeList(element: Element, nodeList: ArrayLike<Element>): number;
/**
 * Finds a unique CSS selector for a given element.
 * The selector is unique within the element's document.
 *
 * @param {Element} ele - The element to find a selector for.
 * @returns {string} A unique CSS selector string.
 */
export declare function findCssSelector(ele: Element): string;
/**
 * Returns the value of the first attribute found from the given list on the element.
 *
 * @param {Element} element - The element to check attributes on.
 * @param {string[]} attributes - Array of attribute names to look for.
 * @returns {string | undefined} The attribute value, or undefined if none found.
 */
export declare function attr(element: Element, attributes: string[]): string | undefined;
/**
 * Escapes a string for use in a CSS selector.
 * Allows # and . characters.
 *
 * @param {string} value - The string to escape.
 * @returns {string} The escaped string.
 * @throws {TypeError} If no argument is provided.
 */
export declare function querySelectorEscape(value?: unknown): string;
/** A minimal shape shared by legacy "CSSValue" objects. */
export interface CSSValue {
    value: unknown;
    unit?: string;
}
/**
 * Creates a deferred object with promise, resolve, and reject.
 */
export declare class defer<T = void> {
    resolve: (...args: any[]) => void;
    reject: (...args: any[]) => void;
    id: string;
    promise: Promise<T>;
    constructor();
}
/**
 * Uses requestIdleCallback if available, otherwise falls back to requestAnimationFrame.
 */
type FrameRequestCallbackShim = (cb: () => void) => number;
export declare const requestIdleCallback: FrameRequestCallbackShim | undefined;
/**
 * Converts a CSSValue object to a string representation.
 *
 * @param {CSSValue} obj - The CSSValue object.
 * @returns {string} The combined CSS value and unit string.
 */
export declare function CSSValueToString(obj: CSSValue): string;
export {};
