import Handler from "../handler.js";
import type { CssNode, List } from "css-tree";
import type { HandlerSource } from "../handler.js";
interface PolisherSource extends HandlerSource {
    styleSheet: CSSStyleSheet;
}
interface RuleContext {
    ruleNode: CssNode;
    [key: string]: any;
}
interface CounterIncrementRecord {
    selector: string;
    number: number;
}
interface CounterResetRecord {
    selector: string;
    number: number | string;
}
interface CounterEntry {
    name: string;
    increments: Record<string, CounterIncrementRecord>;
    resets: Record<string, CounterResetRecord>;
}
type CountersMap = Record<string, CounterEntry>;
declare class Counters extends Handler {
    /** @type {CSSStyleSheet} */
    styleSheet: CSSStyleSheet;
    /**
     * Stores counters keyed by counter name.
     * Each counter has increments and resets keyed by selector.
     * @type {Object.<string, {name:string, increments:Object.<string,Object>, resets:Object.<string,Object>}>}
     */
    counters: CountersMap;
    /**
     * Map tracking counters that have been reset by element reference.
     * @type {Map<string, string>}
     */
    resetCountersMap: Map<string, string>;
    /**
     * Handles CSS counter properties for paged media.
     * @param {Object} chunker - The chunker instance managing pagination.
     * @param {Object} polisher - The polisher instance managing CSS and styles.
     * @param {Object} caller - The caller instance (optional, context info).
     */
    constructor(chunker?: HandlerSource, polisher?: PolisherSource, caller?: HandlerSource);
    onDeclaration(declaration: CssNode, dItem: List.Cursor | any, dList: List | any, rule: RuleContext): void;
    /**
     * Helper to check if node children contain non-whitespace tokens.
     * @param {Object} children - The children node list.
     * @returns {boolean} True if any non-whitespace tokens found.
     */
    hasNonWhitespaceChildren(children: List): boolean;
    afterParsed(parsed: DocumentFragment): void;
    /**
     * Adds a new counter to the counters map or returns existing one.
     * @param {string} name - The name of the counter.
     * @returns {Object} The counter object.
     */
    addCounter(name: string): CounterEntry;
    /**
     * Parses and handles counter-increment declarations.
     * Updates counters with increment info.
     * @param {Object} declaration - The CSS declaration node.
     * @param {Object} rule - The CSS rule node.
     * @returns {Array<Object>} List of increments parsed.
     */
    handleIncrement(declaration: CssNode, rule: RuleContext): CounterIncrementRecord[];
    /**
     * Parses and handles counter-reset declarations.
     * Updates counters with reset info.
     * @param {Object} declaration - The CSS declaration node.
     * @param {Object} rule - The CSS rule node.
     */
    handleReset(declaration: CssNode, rule: RuleContext): void;
    /**
     * Processes all counters on the parsed fragment.
     * Calls handlers for increments, resets, and value assignment.
     * @param {DocumentFragment} parsed - The parsed DOM fragment.
     * @param {Object} counters - The counters map.
     */
    processCounters(parsed: DocumentFragment, counters: CountersMap): void;
    /**
     * Adds counter-reset CSS rules scoped on pages to allow cross page scope.
     * @param {Object} counters - The counters map.
     */
    scopeCounters(counters: CountersMap): void;
    /**
     * Inserts a CSS rule into the stylesheet.
     * @param {string} rule - The CSS rule string.
     */
    insertRule(rule: string): void;
    /**
     * Adds data attributes for counter increments to matching elements.
     * @param {DocumentFragment} parsed - The parsed DOM fragment.
     * @param {Object} counter - The counter object.
     */
    processCounterIncrements(parsed: DocumentFragment, counter: CounterEntry): void;
    /**
     * Adds data attributes for counter resets to matching elements.
     * Resolves CSS variables when possible.
     * @param {DocumentFragment} parsed - The parsed DOM fragment.
     * @param {Object} counter - The counter object.
     */
    processCounterResets(parsed: DocumentFragment, counter: CounterEntry): void;
    /**
     * Calculates and adds counter values on elements.
     * @param {DocumentFragment} parsed - The parsed DOM fragment.
     * @param {Object} counter - The counter object.
     */
    addCounterValues(parsed: DocumentFragment, counter: CounterEntry): void;
    /**
     * Ensures the footnote marker counter is included in the counter list.
     * If "footnote-maker" is already present, it does nothing.
     *
     * @param {Object} list - The CSS AST list node to modify.
     */
    addFootnoteMarkerCounter(list: List): void;
    /**
     * Increment the CSS counters for a specific element, merging with existing increments.
     *
     * @param {HTMLElement} element - The element to update.
     * @param {string[]} incrementArray - Array of counter-increment strings, e.g. ['c1 1', 'c2 -3'].
     */
    incrementCounterForElement(element: HTMLElement, incrementArray: string[]): void;
    /**
     * Merge multiple values of a counter-increment CSS rule, using the specified operator.
     *
     * @param {Array} incrementArray the values to merge, e.g. ['c1 1', 'c1 -7 c2 1']
     * @param {Function} operator the function used to merge counter values (e.g. keep the last value of a counter or sum
     *					the counter values)
     * @return {string} the merged value of the counter-increment CSS rule
     */
    mergeIncrements(incrementArray: string[], operator: (prev: string | undefined, next: string | undefined) => string | number | undefined): string;
    afterPageLayout(pageElement: HTMLElement, page: any): void;
}
export default Counters;
