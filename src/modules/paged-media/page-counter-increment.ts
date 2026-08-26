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

interface IncrementRecord {
	selector: string;
	number: number;
}

interface PageCounterState {
	name: string;
	increments: Record<string, IncrementRecord>;
	resets: Record<string, unknown>;
}

/**
 * Handles `counter-increment` rules related to the `page` counter.
 *
 * This class identifies `counter-increment: page` declarations that appear outside
 * of the `@page` context and applies them by inserting equivalent CSS custom property
 * rules. This allows for controlling page-based counters from regular content.
 *
 * Reference: https://www.w3.org/TR/css-page-3/#page-based-counters
 */
class PageCounterIncrement extends Handler {
	styleSheet: CSSStyleSheet;

	/**
	 * Tracks page counter increments and resets by selector.
	 * Only the "page" counter is processed.
	 * @type {{
	 *   name: string,
	 *   increments: Object.<string, {selector: string, number: number}>,
	 *   resets: Object
	 * }}
	 */
	pageCounter: PageCounterState;

	/**
	 * Constructs a PageCounterIncrement handler.
	 *
	 * @param {Object} chunker - The chunker instance used during pagination.
	 * @param {Object} polisher - The polisher instance used for styling.
	 * @param {Object} caller - The caller coordinating the handlers.
	 */
	constructor(chunker?: HandlerSource, polisher?: PolisherSource, caller?: HandlerSource) {
		super(chunker, polisher, caller);

		/** @type {CSSStyleSheet} */
		this.styleSheet = polisher!.styleSheet;

		this.pageCounter = {
			name: "page",
			increments: {},
			resets: {}, // Not used yet
		};
	}

	/**
	 * Handles CSS declarations during parsing.
	 * Specifically looks for `counter-increment: page` and collects them.
	 *
	 * @param {Object} declaration - The CSS declaration AST node.
	 * @param {Object} dItem - The item in the declaration list.
	 * @param {Object} dList - The list of declarations.
	 * @param {Object} rule - The parent rule node.
	 */
	onDeclaration(declaration: CssNode, dItem: List.Cursor | any, dList: List | any, rule: RuleContext) {
		const property = declaration.property;

		if (property === "counter-increment") {
			let inc = this.handleIncrement(declaration, rule);
			if (inc) {
				dList.remove(dItem); // Remove original declaration
			}
		}
	}

	/**
	 * Applies the processed counter-increments as CSS custom properties.
	 *
	 * @param {*} _ - Unused parameter (parsed content).
	 */
	afterParsed(_: unknown) {
		for (const inc in this.pageCounter.increments) {
			const increment = this.pageCounter.increments[inc];
			this.insertRule(
				`${increment.selector} { --paged-page-counter-increment: ${increment.number} }`,
			);
		}
	}

	/**
	 * Parses a `counter-increment` declaration and determines if it's relevant.
	 *
	 * @param {Object} declaration - The `counter-increment` declaration node.
	 * @param {Object} rule - The parent rule node.
	 * @returns {Object|undefined} The parsed increment object or undefined if ignored.
	 */
	handleIncrement(declaration: CssNode, rule: RuleContext): IncrementRecord | undefined {
		const identifier = declaration.value.children.first();
		const number =
			declaration.value.children.getSize() > 1
				? declaration.value.children.last().value
				: 1;
		const name = identifier && identifier.name;

		// Skip target-counter-* pseudo counters
		if (name && name.indexOf("target-counter-") === 0) {
			return;
		}

		// Only process 'page' counter
		if (name !== "page") {
			return;
		}

		// Skip if declaration is already inside @page rule
		if (rule.ruleNode.name === "page" && rule.ruleNode.type === "Atrule") {
			return;
		}

		// Convert selector to string
		const selector = csstree.generate(rule.ruleNode.prelude);

		// Store for later rule insertion
		return (this.pageCounter.increments[selector] = {
			selector: selector,
			number,
		});
	}

	/**
	 * Inserts a rule into the active stylesheet.
	 *
	 * @param {string} rule - The CSS rule string to insert.
	 */
	insertRule(rule: string) {
		this.styleSheet.insertRule(rule, this.styleSheet.cssRules.length);
	}
}

export default PageCounterIncrement;
