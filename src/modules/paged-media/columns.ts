import Handler, { type HandlerSource } from "../handler.js";
import csstree from "css-tree";
import type { CssNode, List } from "css-tree";

interface RuleContext {
	ruleNode: CssNode;
	[key: string]: any;
}

/**
 * Declaration properties that participate in CSS multi-column layout. When
 * any of them appears in a rule, the rule's selectors are recorded so that
 * the layout stage can identify rendered fragmentainer roots.
 */
const COLUMN_PROPERTIES = [
	"column-count",
	"column-width",
	"columns",
	"column-fill",
	"column-gap",
	"column-span",
	"column-rule",
	"column-rule-color",
	"column-rule-style",
	"column-rule-width",
];

/**
 * Tracks multi-column rules from author CSS.
 *
 * The declarations themselves are left in place so that cloned page content
 * receives the browser's native multi-column formatting; this handler only
 * records which selectors produce fragmentainers and hands that knowledge to
 * the chunker for use during layout.
 *
 * Nested multicol (a fragmentainer inside another fragmentainer) is not
 * supported; the layout stage degrades the inner container to a single
 * column and warns.
 */
class Columns extends Handler {
	/** Selectors seen in author CSS that declare multi-column formatting. */
	multicolSelectors: Set<string>;

	constructor(
		chunker?: HandlerSource,
		polisher?: HandlerSource,
		caller?: HandlerSource,
	) {
		super(chunker, polisher, caller);

		this.multicolSelectors = new Set();
	}

	onDeclaration(
		declaration: CssNode,
		dItem: List.Cursor,
		dList: List,
		rule: RuleContext,
	) {
		const property = declaration.property;

		if (!COLUMN_PROPERTIES.includes(property)) {
			return;
		}

		const prelude = rule.ruleNode.prelude;
		if (!prelude) {
			return;
		}

		const selector = csstree.generate(prelude);

		selector.split(",").forEach((s) => {
			s = s.trim();
			if (!s) {
				return;
			}
			this.multicolSelectors.add(s);

			// Share with the chunker so the layout stage can find the
			// rendered fragmentainer roots for each page.
			const chunker = this.chunker as unknown as
				| { multicolSelectors?: Set<string> }
				| null
				| undefined;
			if (chunker && chunker.multicolSelectors) {
				chunker.multicolSelectors.add(s);
			}
		});

		// `column-fill: balance` is ignored on fragmentainers that the layout
		// stage constrains to the remaining page height (an inline
		// `column-fill: auto` is applied alongside the height constraint).
		// Nothing to rewrite here on the CSS side.
		void dItem;
		void dList;
	}
}

export default Columns;
