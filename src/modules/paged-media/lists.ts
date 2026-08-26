import Handler from "../handler.js";
import type { HandlerSource } from "../handler.js";

/**
 * Handles ordered list (`<ol>`) processing across paginated content.
 * Extends the base Handler class to manage list item numbering before and after pagination.
 */
class Lists extends Handler {
	/**
	 * Constructs a Lists handler.
	 * @param {Object} chunker - The chunker instance used for splitting content into pages.
	 * @param {Object} polisher - The polisher instance for style processing.
	 * @param {Object} caller - The caller instance managing lifecycle hooks.
	 */
	constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource) {
		super(chunker, polisher, caller);
	}

	/**
	 * Hook called after the entire content is parsed but before layout.
	 * Adds `data-item-num` attributes to `<li>` elements in ordered lists for later processing.
	 * @param {Document|HTMLElement} content - The parsed document or element.
	 */
	afterParsed(content: DocumentFragment | HTMLElement) {
		const orderedLists = content.querySelectorAll("ol");

		for (var list of orderedLists) {
			this.addDataNumbers(list as HTMLOListElement);
		}
	}

	/**
	 * Hook called after a page is laid out.
	 * Updates the `start` attribute of `<ol>` elements to ensure numbering continuity across pages.
	 * @param {HTMLElement} pageElement - The DOM element for the current page.
	 * @param {Object} page - The page object with metadata.
	 * @param {Object|null} breakToken - The break token representing where content broke across pages.
	 * @param {Object} chunker - The chunker instance.
	 */
	afterPageLayout(pageElement: HTMLElement, page: any, breakToken: any, chunker: any) {
		var orderedLists = pageElement.getElementsByTagName("ol");
		for (var list of orderedLists) {
			if (list.firstElementChild) {
				list.start = (list.firstElementChild as HTMLElement).dataset
					.itemNum as unknown as number;
			}
		}
	}

	/**
	 * Adds `data-item-num` attributes to each `<li>` in an ordered list.
	 * This helps track correct numbering even when the list spans multiple pages.
	 * @param {HTMLOListElement} list - The ordered list to process.
	 */
	addDataNumbers(list: HTMLOListElement) {
		let start = 1;
		if (list.hasAttribute("start")) {
			start = parseInt(list.getAttribute("start")!, 10);
			if (isNaN(start)) {
				start = 1;
			}
		}
		let items = list.children;
		for (var i = 0; i < items.length; i++) {
			items[i].setAttribute("data-item-num", String(i + start));
		}
	}
}

export default Lists;
