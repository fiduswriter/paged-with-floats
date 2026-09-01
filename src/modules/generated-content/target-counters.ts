import Handler, { type HandlerSource } from "../handler.js";
import { attr, querySelectorEscape, UUID } from "../../utils/utils.js";
import csstree from "css-tree";
import type { CssNode, List } from "css-tree";

interface CounterTargetValue {
	func: string;
	args: string[];
	value: string;
	counter?: string;
	style?: string;
	selector: string;
	fullSelector: string;
	variable: string;
	separator?: string;
	plural?: boolean;
	urlValue?: string;
}

interface CounterTargetsData {
	[selector: string]: CounterTargetValue;
}

interface RuleContext {
	ruleNode: CssNode;
	ruleItem?: List.Cursor;
	rulelist?: List;
}

interface DeclarationContext {
	declarationNode: CssNode;
	dItem?: List.Cursor;
	dList?: List;
}

interface PolisherSource extends HandlerSource {
	styleSheet: CSSStyleSheet;
}

interface ChunkerLayout {
	pagesArea: ParentNode;
}

/**
 * Handler for processing CSS `target-counter()` and `target-counters()` functions.
 *
 * Parses CSS rules using these functions, replaces them with CSS counters or
 * custom properties, and dynamically manages values based on page layout.
 *
 * This allows counters to track values of elements targeted via attributes,
 * supporting complex page-based counters in paged media.
 *
 * @extends Handler
 */
class TargetCounters extends Handler {
	styleSheet: CSSStyleSheet;
	counterTargets: CounterTargetsData;

	/**
	 * Creates an instance of TargetCounters.
	 *
	 * @param {Object} chunker - The chunker instance managing pagination.
	 * @param {Object} polisher - The polisher instance responsible for CSS injection and post-processing.
	 * @param {Object} caller - The caller or controller managing this handler.
	 */
	constructor(
		chunker?: HandlerSource,
		polisher?: PolisherSource,
		caller?: HandlerSource,
	) {
		super(chunker, polisher, caller);

		/**
		 * Reference to the stylesheet where counter rules will be inserted.
		 * @type {CSSStyleSheet}
		 */
		this.styleSheet = polisher!.styleSheet;

		/**
		 * Stores parsed target counter definitions keyed by selector.
		 * @type {Object<string, Object>}
		 */
		this.counterTargets = {};
	}

	/**
	 * Processes CSS content function nodes to detect and handle `target-counter()`
	 * and `target-counters()` functions. Replaces the function with a CSS counter()
	 * or var() call and stores necessary metadata.
	 *
	 * @param {Object} funcNode - The CSS function node representing `target-counter()` or `target-counters()`.
	 * @param {Object} fItem - The current function node item (unused).
	 * @param {Object} fList - The function list (unused).
	 * @param {Object} declaration - The CSS declaration node.
	 * @param {Object} rule - The CSS rule node containing the declaration.
	 */
	onContent(funcNode: CssNode, fItem: List.Cursor, fList: List, declaration: DeclarationContext, rule: RuleContext) {
		if (funcNode.name === "target-counter") {
			this.handleTargetCounter(funcNode, rule);
		} else if (funcNode.name === "target-counters") {
			this.handleTargetCounters(funcNode, rule);
		}
	}

	/**
	 * Parses a `target-counter()` function and replaces it with a CSS `counter()` call.
	 *
	 * @param {Object} funcNode - The CSS function node.
	 * @param {Object} rule - The CSS rule node containing the declaration.
	 */
	handleTargetCounter(funcNode: CssNode, rule: RuleContext) {
		// Extract the selector for this rule
		let selector = csstree.generate(rule.ruleNode.prelude);

		// Parse the target function (attr() or url())
		let first = funcNode.children.first();
		let targetInfo = this.parseTarget(first);
		if (!targetInfo) {
			return;
		}

		// Full generated CSS value of the target-counter function
		let value = csstree.generate(funcNode);

		let counter: string | undefined, style: string | undefined, styleIdentifier: CssNode | undefined;

		// Extract counter name and optional style identifier
		funcNode.children.forEach((child: CssNode) => {
			if (child.type === "Identifier") {
				if (!counter) {
					counter = child.name;
				} else if (!style) {
					styleIdentifier = csstree.clone(child);
					style = child.name;
				}
			}
		});

		// Generate a unique CSS variable name for this counter
		let variable = "target-counter-" + UUID();

		// Support multiple selectors by splitting and adding each individually
		selector.split(",").forEach((s) => {
			this.counterTargets[s] = {
				func: targetInfo!.func,
				args: targetInfo!.args,
				value: value,
				counter: counter,
				style: style,
				selector: s,
				fullSelector: selector,
				variable: variable,
				urlValue: targetInfo!.urlValue,
			};
		});

		// Replace the original target-counter() function with a CSS counter() function
		funcNode.name = "counter";
		funcNode.children = new csstree.List();
		funcNode.children.appendData({
			type: "Identifier",
			loc: 0,
			name: variable,
		});

		// If a style identifier was provided, append it as a second argument
		if (styleIdentifier) {
			funcNode.children.appendData({
				type: "Operator",
				loc: null,
				value: ",",
			});
			funcNode.children.appendData(styleIdentifier);
		}
	}

	/**
	 * Parses a `target-counters()` function and replaces it with a CSS `var()` call
	 * referencing a generated custom property.
	 *
	 * @param {Object} funcNode - The CSS function node.
	 * @param {Object} rule - The CSS rule node containing the declaration.
	 */
	handleTargetCounters(funcNode: CssNode, rule: RuleContext) {
		let selector = csstree.generate(rule.ruleNode.prelude);

		let first = funcNode.children.first();
		let targetInfo = this.parseTarget(first);
		if (!targetInfo) {
			return;
		}

		let counter: string | undefined;
		let separator = ".";
		let separatorSet = false;
		let style: string | undefined;

		funcNode.children.forEach((child: CssNode) => {
			if (child.type === "Identifier") {
				if (!counter) {
					counter = child.name;
				} else if (!style) {
					style = child.name;
				}
			} else if (
				!separatorSet &&
				(child.type === "String" || child.type === "Raw")
			) {
				separator = String(child.value).replace(/["']/g, "");
				separatorSet = true;
			}
		});

		let variable = "target-counters-" + UUID();

		selector.split(",").forEach((s) => {
			this.counterTargets[s] = {
				func: targetInfo!.func,
				args: targetInfo!.args,
				value: csstree.generate(funcNode),
				counter: counter,
				style: style,
				selector: s,
				fullSelector: selector,
				variable: variable,
				separator: separator,
				plural: true,
				urlValue: targetInfo!.urlValue,
			};
		});

		// Replace target-counters() with var(--target-counters-<uuid>)
		funcNode.name = "var";
		funcNode.children = new csstree.List();
		funcNode.children.appendData({
			type: "Identifier",
			loc: 0,
			name: `--${variable}`,
		});
	}

	/**
	 * Parses the first argument of `target-counter()` / `target-counters()`,
	 * which may be `attr()`, `url()`, or a `Url` node.
	 *
	 * @param {Object} first - The first child of the function node.
	 * @returns {Object|null} Target descriptor, or null when unsupported.
	 */
	parseTarget(
		first: CssNode,
	): { func: string; args: string[]; urlValue?: string } | null {
		if (first.type === "Function" && first.name === "attr") {
			let args: string[] = [];
			first.children.forEach((child: CssNode) => {
				if (child.type === "Identifier") {
					args.push(child.name);
				}
			});
			return { func: "attr", args: args };
		}

		if (first.type === "Function" && first.name === "url") {
			let child = first.children.first();
			let urlValue = child
				? String(child.value).replace(/["']/g, "")
				: "";
			return { func: "url", args: [], urlValue: urlValue };
		}

		if (first.type === "Url") {
			return {
				func: "url",
				args: [],
				urlValue: String(first.value.value).replace(/["']/g, ""),
			};
		}

		return null;
	}

	/**
	 * Called after page layout to update CSS rules for counters targeting elements in the pages.
	 * Inserts CSS rules dynamically to reset counters on elements matching the target selectors.
	 *
	 * @param {DocumentFragment} fragment - The fragment of the current page.
	 * @param {Object} page - The page object (unused here).
	 * @param {Object} breakToken - The pagination break token (unused here).
	 * @param {Object} chunker - The chunker instance containing the pagesArea DOM.
	 */
	afterPageLayout(fragment: HTMLElement, page: unknown, breakToken: unknown, chunker: ChunkerLayout) {
		Object.keys(this.counterTargets).forEach((name) => {
			let target = this.counterTargets[name];
			// Split selector by pseudo elements/classes
			let split = target.selector.split(/::?/g);
			let query = split[0];

			// Select elements not yet processed (without the data attribute)
			let queried = chunker.pagesArea.querySelectorAll(
				query + ":not([data-" + target.variable + "])",
			);

			queried.forEach((selected) => {
				let element: Element | null = null;

				if (target.func === "attr") {
					let val = attr(selected, target.args);
					element = chunker.pagesArea.querySelector(querySelectorEscape(val));
				} else if (target.func === "url" && target.urlValue) {
					let fragment = target.urlValue.includes("#")
						? target.urlValue.split("#").pop()
						: target.urlValue;
					if (fragment) {
						element = chunker.pagesArea.querySelector(
							"#" + querySelectorEscape(fragment),
						);
					}
				}

				if (!element) {
					return;
				}

				// Generate a unique selector id for this instance
				let selector = UUID();

				// Mark the selected element as processed
				selected.setAttribute("data-" + target.variable, selector);

				// Handle pseudo elements if present
				let pseudo = "";
				if (split.length > 1) {
					pseudo += "::" + split[1];
				}

				if (target.plural) {
					// target-counters(): collect counter values from the target up
					// through its ancestors and join them with the separator.
					let values = this.collectCounterValues(
						element,
						target.counter,
					);
					if (values.length) {
						let joined = values.join(target.separator || ".");
						this.styleSheet.insertRule(
							`[data-${target.variable}="${selector}"]${pseudo} { --${target.variable}: "${joined}"; }`,
							this.styleSheet.cssRules.length,
						);
					}
				} else if (target.counter === "page") {
					// Calculate page counter value by checking page resets and increments
					let pages = chunker.pagesArea.querySelectorAll(".paged_page");
					let pg = 0;
					for (let i = 0; i < pages.length; i++) {
						let page = pages[i];
						let styles = window.getComputedStyle(page) as CSSStyleDeclaration &
							Record<string, string>;
						let reset = styles["counter-reset"].replace("page", "").trim();
						let increment = styles["counter-increment"]
							.replace("page", "")
							.trim();

						if (reset !== "none") {
							pg = parseInt(reset);
						}
						if (increment !== "none") {
							pg += parseInt(increment);
						}

						if (page.contains(element)) {
							break;
						}
					}

					// Insert CSS rule to reset the custom counter variable on the
					// targeted element. Counters reset on a pseudo-element are not
					// visible to counter() on that same pseudo-element, so reset on
					// the element itself even when the target-counter() is used in
					// ::after/::before content.
					this.styleSheet.insertRule(
						`[data-${target.variable}="${selector}"] { counter-reset: ${target.variable} ${pg}; }`,
						this.styleSheet.cssRules.length,
					);
				} else {
					// For other counters, get the value from a data attribute and set it
					let value = element.getAttribute(
						`data-counter-${target.counter}-value`,
					);
					if (value) {
						this.styleSheet.insertRule(
							`[data-${target.variable}="${selector}"] { counter-reset: ${target.variable} ${target.variable} ${parseInt(value)}; }`,
							this.styleSheet.cssRules.length,
						);
					}
				}

				// Force browser redraw by toggling display style
				let el = document.querySelector(
					`[data-${target.variable}="${selector}"]`,
				) as HTMLElement | null;
				if (el) {
					el.style.display = "none";
					el.clientHeight; // trigger reflow
					el.style.removeProperty("display");
				}
			});
		});
	}

	/**
	 * Collects counter values for `target-counters()` by walking from the
	 * target element up through its ancestors. Values are gathered for every
	 * element that carries a `data-counter-<name>-value` attribute, then
	 * reversed so the outermost value comes first.
	 *
	 * @param {Element} element - The targeted element.
	 * @param {string} [counter] - The counter name.
	 * @returns {string[]} Ordered counter values, outermost first.
	 */
	collectCounterValues(element: Element, counter?: string): string[] {
		if (!counter) {
			return [];
		}

		let values: string[] = [];
		let attrName = `data-counter-${counter}-value`;
		let current: Element | null = element;

		while (current) {
			let value = current.getAttribute(attrName);
			if (value) {
				values.push(value);
			}
			current = current.parentElement;
		}

		return values.reverse();
	}
}

export default TargetCounters;
