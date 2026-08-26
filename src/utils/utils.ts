/**
 * Gets the bounding client rectangle of an element.
 * Falls back to using Range if element.getBoundingClientRect is undefined.
 *
 * @param {Element | Range} element - The DOM element (or range) to get the bounding rectangle for.
 * @returns {DOMRect | undefined} The bounding client rectangle or undefined if no element.
 */
export function getBoundingClientRect(
	element?: Element | Range,
): DOMRect | undefined {
	if (!element) {
		return;
	}
	let rect: DOMRect;
	if (typeof element.getBoundingClientRect !== "undefined") {
		rect = element.getBoundingClientRect();
	} else {
		const range = document.createRange();
		range.selectNode(element as unknown as Node);
		rect = range.getBoundingClientRect();
	}
	return rect;
}

/**
 * Gets the client rectangles of an element.
 * Falls back to using Range if element.getClientRects is undefined.
 *
 * @param {Element | Range} element - The DOM element (or range) to get client rectangles for.
 * @returns {DOMRectList | undefined} The client rectangles or undefined if no element.
 */
export function getClientRects(
	element?: Element | Range,
): DOMRectList | undefined {
	if (!element) {
		return;
	}
	let rects: DOMRectList;
	if (typeof element.getClientRects !== "undefined") {
		rects = element.getClientRects();
	} else {
		const range = document.createRange();
		range.selectNode(element as unknown as Node);
		rects = range.getClientRects();
	}
	return rects;
}

/**
 * Generates a UUID (version 4).
 * Based on: http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
 *
 * @returns {string} A UUID string.
 */
export function UUID(): string {
	let d = new Date().getTime();
	if (
		typeof performance !== "undefined" &&
		typeof performance.now === "function"
	) {
		d += performance.now(); //use high-precision timer if available
	}
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
		const r = ((d + Math.random() * 16) % 16) | 0;
		d = Math.floor(d / 16);
		return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
	});
}

/**
 * Find the position of an element in a NodeList.
 *
 * @param {Element} element - The element to find.
 * @param {NodeList} nodeList - The NodeList to search within.
 * @returns {number} The index of the element in the NodeList, or -1 if not found.
 */
export function positionInNodeList(
	element: Element,
	nodeList: ArrayLike<Element>,
): number {
	for (let i = 0; i < nodeList.length; i++) {
		if (element === nodeList[i]) {
			return i;
		}
	}
	return -1;
}

/**
 * Finds a unique CSS selector for a given element.
 * The selector is unique within the element's document.
 *
 * @param {Element} ele - The element to find a selector for.
 * @returns {string} A unique CSS selector string.
 */
export function findCssSelector(ele: Element): string {
	const doc = ele.ownerDocument;

	const cssEscape = window.CSS.escape;

	if (
		ele.id &&
		doc.querySelectorAll("#" + cssEscape(ele.id)).length === 1
	) {
		return "#" + cssEscape(ele.id);
	}

	const tagName = ele.localName;
	if (tagName === "html") {
		return "html";
	}
	if (tagName === "head") {
		return "head";
	}
	if (tagName === "body") {
		return "body";
	}

	let selector: string | undefined,
		index: number | undefined,
		matches: NodeListOf<Element>;
	if (ele.classList.length > 0) {
		for (let i = 0; i < ele.classList.length; i++) {
			selector = "." + cssEscape(ele.classList.item(i)!);
			matches = doc.querySelectorAll(selector);
			if (matches.length === 1) {
				return selector;
			}
			selector = cssEscape(tagName!) + selector;
			matches = doc.querySelectorAll(selector);
			if (matches.length === 1) {
				return selector;
			}
			index = positionInNodeList(ele, ele.parentNode!.children) + 1;
			selector = selector + ":nth-child(" + index + ")";
			matches = doc.querySelectorAll(selector);
			if (matches.length === 1) {
				return selector;
			}
		}
	}

	if (ele.parentNode !== doc && ele.parentNode?.nodeType === 1) {
		index = positionInNodeList(ele, ele.parentNode.children) + 1;
		selector =
			findCssSelector(<Element>ele.parentNode) +
			" > " +
			cssEscape(tagName!) +
			":nth-child(" +
			index +
			")";
	}

	return selector!;
}

/**
 * Returns the value of the first attribute found from the given list on the element.
 *
 * @param {Element} element - The element to check attributes on.
 * @param {string[]} attributes - Array of attribute names to look for.
 * @returns {string | undefined} The attribute value, or undefined if none found.
 */
export function attr(
	element: Element,
	attributes: string[],
): string | undefined {
	for (let i = 0; i < attributes.length; i++) {
		if (element.hasAttribute(attributes[i])) {
			return element.getAttribute(attributes[i])!;
		}
	}
}

/**
 * Escapes a string for use in a CSS selector.
 * Allows # and . characters.
 *
 * @param {string} value - The string to escape.
 * @returns {string} The escaped string.
 * @throws {TypeError} If no argument is provided.
 */
export function querySelectorEscape(value?: unknown): string {
	if (arguments.length == 0) {
		throw new TypeError("`CSS.escape` requires an argument.");
	}
	const string = String(value);

	const length = string.length;
	let index = -1;
	let codeUnit: number;
	let result = "";
	const firstCodeUnit = string.charCodeAt(0);
	while (++index < length) {
		codeUnit = string.charCodeAt(index);

		if (codeUnit == 0x0000) {
			result += "\uFFFD";
			continue;
		}

		if (
			(codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
			codeUnit == 0x007f ||
			(index == 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
			(index == 1 &&
				codeUnit >= 0x0030 &&
				codeUnit <= 0x0039 &&
				firstCodeUnit == 0x002d)
		) {
			result += "\\" + codeUnit.toString(16) + " ";
			continue;
		}

		if (index == 0 && length == 1 && codeUnit == 0x002d) {
			result += "\\" + string.charAt(index);
			continue;
		}

		if (codeUnit == 0x002e) {
			if (string.charAt(0) == "#") {
				result += "\\.";
				continue;
			}
		}

		if (
			codeUnit >= 0x0080 ||
			codeUnit == 0x002d ||
			codeUnit == 0x005f ||
			codeUnit == 35 || // Allow #
			codeUnit == 46 || // Allow .
			(codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
			(codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
			(codeUnit >= 0x0061 && codeUnit <= 0x007a)
		) {
			result += string.charAt(index);
			continue;
		}

		result += "\\" + string.charAt(index);
	}
	return result;
}

/** A minimal shape shared by legacy "CSSValue" objects. */
export interface CSSValue {
	value: unknown;
	unit?: string;
}

/**
 * Creates a deferred object with promise, resolve, and reject.
 */
export class defer<T = void> {
	resolve!: (...args: any[]) => void;
	reject!: (...args: any[]) => void;
	id: string;
	promise: Promise<T>;

	constructor() {
		this.id = UUID();

		this.promise = new Promise<T>((resolve, reject) => {
			this.resolve = resolve as (...args: any[]) => void;
			this.reject = reject as (...args: any[]) => void;
		});
		Object.freeze(this);
	}
}

/**
 * Uses requestIdleCallback if available, otherwise falls back to requestAnimationFrame.
 */
type FrameRequestCallbackShim = (cb: () => void) => number;

const idleWindow = (
	typeof window !== "undefined" ? window : undefined
) as unknown as
	| { requestIdleCallback?: FrameRequestCallbackShim; requestAnimationFrame: FrameRequestCallbackShim }
	| undefined;

export const requestIdleCallback: FrameRequestCallbackShim | undefined =
	idleWindow && idleWindow.requestIdleCallback
		? idleWindow.requestIdleCallback
		: idleWindow
			? idleWindow.requestAnimationFrame
			: undefined;

/**
 * Converts a CSSValue object to a string representation.
 *
 * @param {CSSValue} obj - The CSSValue object.
 * @returns {string} The combined CSS value and unit string.
 */
export function CSSValueToString(obj: CSSValue): string {
	return String(obj.value) + (obj.unit || "");
}
