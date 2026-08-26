import { UUID } from "../utils/utils.js";

/**
 * Parses and processes a flow of content (HTML or DOM nodes) offscreen.
 * Adds unique references to elements for later retrieval or tracking.
 */
class ContentParser {
	dom?: DocumentFragment | Node;
	refs?: Record<string, HTMLElement>;

	/**
	 * Create a new ContentParser instance.
	 *
	 * @param {string | Node} content - HTML string or DOM Node to be parsed.
	 * @param {Function} [cb] - Optional callback (currently unused).
	 * @returns {DocumentFragment | Node} The parsed DOM fragment or node.
	 */
	constructor(content: string | Node, cb?: unknown) {
		if (content && (content as Node).nodeType) {
			// Handle DOM Node input
			this.dom = this.add(content as Node);
		} else if (typeof content === "string") {
			// Handle HTML string input
			this.dom = this.parse(content);
		}

		return this.dom as unknown as ContentParser;
	}

	/**
	 * Parses an HTML string into a DocumentFragment and adds `data-ref` attributes.
	 *
	 * @param {string} markup - The HTML markup to parse.
	 * @param {string} [mime] - Optional MIME type (currently unused).
	 * @returns {DocumentFragment} A document fragment with processed nodes.
	 */
	parse(markup: string, mime?: unknown): DocumentFragment {
		const range = document.createRange();
		const fragment = range.createContextualFragment(markup);

		this.addRefs(fragment);

		return fragment;
	}

	/**
	 * Processes a DOM Node by cloning its structure (if needed) and adding `data-ref` attributes.
	 *
	 * @param {Node} contents - A DOM Node or DocumentFragment to process.
	 * @returns {Node} The processed content with references.
	 */
	add(contents: Node): Node {
		this.addRefs(contents);

		return contents;
	}

	/**
	 * Walks the content tree and adds a `data-ref` attribute (UUID) to each element.
	 * Also preserves original `id` attributes via `data-id`.
	 *
	 * @param {Node} content - A DOM Node or DocumentFragment to annotate.
	 */
	addRefs(content: Node): void {
		const treeWalker = document.createTreeWalker(
			content,
			NodeFilter.SHOW_ELEMENT,
		);

		let node = treeWalker.nextNode();
		while (node) {
			const element = node as Element;
			if (!element.hasAttribute("data-ref")) {
				const uuid = UUID();
				element.setAttribute("data-ref", uuid);
			}

			if (element.id) {
				element.setAttribute("data-id", element.id);
			}

			node = treeWalker.nextNode();
		}
	}

	/**
	 * Finds a DOM node by its reference ID (this.refs must be pre-populated externally).
	 *
	 * @param {string} ref - The `data-ref` UUID to search for.
	 * @returns {HTMLElement|undefined} The associated element, if found.
	 */
	find(ref: string): HTMLElement | undefined {
		return this.refs?.[ref];
	}

	/**
	 * Cleans up the parser's references and DOM structure.
	 */
	destroy(): void {
		this.refs = undefined;
		this.dom = undefined;
	}
}

export default ContentParser;
