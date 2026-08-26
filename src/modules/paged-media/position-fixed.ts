import Handler from "../handler.js";
import csstree from "css-tree";
import type { CssNode, List } from "css-tree";
import type { HandlerSource } from "../handler.js";

interface PolisherSource extends HandlerSource {
	styleSheet: CSSStyleSheet;
}

interface RuleContext {
	ruleNode: CssNode;
	[key: string]: any;
}

/**
 * Handles `position: fixed` elements in paged media.
 *
 * Since fixed positioning does not behave as expected in paged outputs,
 * this handler collects all `position: fixed` elements during parsing,
 * removes them from the flow, and re-inserts them absolutely positioned
 * at the top of every page during layout.
 */
class PositionFixed extends Handler {
	styleSheet: CSSStyleSheet;

	/**
	 * Array of selectors that match `position: fixed` elements.
	 * @type {string[]}
	 */
	fixedElementsSelector: string[];

	/**
	 * Collected DOM elements that matched fixed position rules.
	 * These are inserted back on each page during layout.
	 * @type {HTMLElement[]}
	 */
	fixedElements: HTMLElement[];

	/**
	 * Creates an instance of PositionFixed.
	 *
	 * @param {Object} chunker - The chunker instance used for pagination.
	 * @param {Object} polisher - The polisher instance responsible for styles.
	 * @param {Object} caller - The object coordinating the handlers.
	 */
	constructor(chunker?: HandlerSource, polisher?: PolisherSource, caller?: HandlerSource) {
		super(chunker, polisher, caller);

		/** @type {CSSStyleSheet} */
		this.styleSheet = polisher!.styleSheet;

		this.fixedElementsSelector = [];
		this.fixedElements = [];
	}

	/**
	 * Intercepts `position: fixed` declarations, saves their selector,
	 * and removes the declaration from the stylesheet.
	 *
	 * @param {Object} declaration - The CSS AST node for the declaration.
	 * @param {Object} dItem - The item in the declaration list.
	 * @param {Object} dList - The full declaration list.
	 * @param {Object} rule - The rule containing this declaration.
	 */
	onDeclaration(declaration: CssNode, dItem: List.Cursor | any, dList: List | any, rule: RuleContext) {
		if (
			declaration.property === "position" &&
			declaration.value.children.first().name === "fixed"
		) {
			let selector = csstree.generate(rule.ruleNode.prelude);
			this.fixedElementsSelector.push(selector);
			dList.remove(dItem);
		}
	}

	/**
	 * After parsing the full document, this method finds all elements
	 * that matched `position: fixed`, applies `position: absolute` instead,
	 * removes them from the DOM flow, and stores them for re-insertion.
	 *
	 * @param {DocumentFragment} fragment - The parsed document fragment.
	 */
	afterParsed(fragment: DocumentFragment) {
		this.fixedElementsSelector.forEach((fixedEl) => {
			fragment.querySelectorAll<HTMLElement>(fixedEl).forEach((el) => {
				el.style.setProperty("position", "absolute");
				this.fixedElements.push(el);
				el.remove(); // remove from flow
			});
		});
	}

	/**
	 * After each page layout, this method re-inserts all collected fixed
	 * elements into the top of the page, effectively simulating `position: fixed`.
	 *
	 * @param {HTMLElement} pageElement - The DOM element for the current page.
	 * @param {Object} page - Metadata or state for the current page.
	 * @param {Object} breakToken - Information about content breaks (unused here).
	 */
	afterPageLayout(pageElement: HTMLElement, page: any, breakToken: any) {
		this.fixedElements.forEach((el) => {
			const clone = el.cloneNode(true) as HTMLElement;
			pageElement
				.querySelector(".paged_pagebox")!
				.insertAdjacentElement("afterbegin", clone);
		});
	}
}

export default PositionFixed;
