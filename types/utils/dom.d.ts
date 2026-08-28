type NodeWithRefs = Node & {
    indexOfRefs?: Record<string, HTMLElement>;
};
/**
 * Checks if a given node is an Element node.
 *
 * @param {Node} node - The node to check.
 * @returns {boolean} True if the node is an Element (nodeType === 1), else false.
 */
export declare function isElement(node: Node | null | undefined): node is Element;
/**
 * Checks if a given node is a Text node.
 *
 * @param {Node} node - The node to check.
 * @returns {boolean} True if the node is a Text node (nodeType === 3), else false.
 */
export declare function isText(node: Node | null | undefined): node is Text;
/**
 * Generator function that walks the DOM tree starting from the given node,
 * traversing depth-first and yielding nodes until the limiter node is reached (if provided).
 *
 * @param {Node} start - The starting node for traversal.
 * @param {Node} [limiter] - Optional node at which traversal stops.
 * @yields {Node} Nodes in the DOM tree in depth-first order.
 */
export declare function walk(start: Node, limiter?: Node): Generator<Node>;
/**
 * Finds the next significant node after the given node, optionally descending into children.
 * Returns undefined if the limiter node is reached.
 *
 * @param {Node} node - The reference node.
 * @param {Node} [limiter] - Optional node at which traversal stops.
 * @param {boolean} [descend=false] - Whether to descend into child nodes.
 * @returns {Node|undefined} The next significant node or undefined if none found.
 */
export declare function nodeAfter(node: Node, limiter?: Node, descend?: boolean, skipIgnorable?: boolean): Node | undefined;
/**
 * Finds the previous significant node before the given node, optionally descending into children.
 * Returns undefined if the limiter node is reached.
 *
 * @param {Node} node - The reference node.
 * @param {Node} [limiter] - Optional node at which traversal stops.
 * @param {boolean} [descend=false] - Whether to descend into child nodes.
 * @returns {Node|undefined} The previous significant node or undefined if none found.
 */
export declare function nodeBefore(node: Node, limiter?: Node, descend?: boolean): Node | undefined;
/**
 * Finds the next Element node after the given node.
 * Skips non-element nodes.
 *
 * @param {Node} node - The reference node.
 * @param {Node} [limiter] - Optional node at which traversal stops.
 * @param {boolean} [descend=false] - Whether to descend into child nodes.
 * @returns {Element|undefined} The next Element node or undefined if none found.
 */
export declare function elementAfter(node: Node, limiter?: Node, descend?: boolean): Element | undefined;
/**
 * Finds the previous Element node before the given node.
 * Skips non-element nodes.
 *
 * @param {Node} node - The reference node.
 * @param {Node} [limiter] - Optional node at which traversal stops.
 * @param {boolean} [descend=false] - Whether to descend into child nodes.
 * @returns {Element|undefined} The previous Element node or undefined if none found.
 */
export declare function elementBefore(node: Node, limiter?: Node, descend?: boolean): Element | undefined;
/**
 * Finds the next displayed Element node after the given node.
 * Skips elements marked as undisplayed via `dataset.undisplayed`.
 *
 * @param {Node} node - The reference node.
 * @param {Node} [limiter] - Optional node at which traversal stops.
 * @param {boolean} [descend=false] - Whether to descend into child nodes.
 * @returns {Element|undefined} The next displayed Element node or undefined if none found.
 */
export declare function displayedElementAfter(node: Node, limiter?: Node, descend?: boolean): Element | undefined;
/**
 * Finds the previous displayed Element node before the given node.
 * Skips elements marked as undisplayed via `dataset.undisplayed`.
 *
 * @param {Node} node - The reference node.
 * @param {Node} [limiter] - Optional node at which traversal stops.
 * @param {boolean} [descend=false] - Whether to descend into child nodes.
 * @returns {Element|undefined} The previous displayed Element node or undefined if none found.
 */
export declare function displayedElementBefore(node: Node, limiter?: Node, descend?: boolean): Element | undefined;
/**
 * Recursively builds a stack (array) of a node and all its descendant elements,
 * in depth-first order, starting with the current node at the front.
 *
 * @param {Element} currentNode - The current node to add and process.
 * @param {Element[]} [stacked] - The accumulator array to hold stacked nodes.
 * @returns {Element[]} An array with the current node and all descendants stacked.
 */
export declare function stackChildren(currentNode: Element, stacked?: Element[]): Element[];
/**
 * Rebuilds a table row element by cloning and adjusting its columns, including handling rowspans.
 * Uses an existing rendered DOM tree to maintain styles and structure.
 *
 * @param {HTMLTableRowElement} node - The table row element to rebuild.
 * @param {Element} alreadyRendered - The root element containing the already rendered content for reference.
 * @param {number} [existingChildren] - Number of existing children in the container (optional).
 * @returns {HTMLTableRowElement} A new cloned and rebuilt table row element.
 */
export declare function rebuildTableRow(node: HTMLTableRowElement, alreadyRendered?: Element, existingChildren?: number): HTMLTableRowElement;
/**
 * Rebuilds the ancestor tree for a given node, appending clones or existing elements to a document fragment.
 * Handles table rows, siblings duplication, and other special cases.
 *
 * @param {Node} node - The starting node for rebuilding.
 * @param {DocumentFragment} [fragment] - Optional document fragment to append rebuilt nodes to. Created if omitted.
 * @param {Element} [alreadyRendered] - Root element with already rendered DOM for reference and style copying.
 * @returns {DocumentFragment} The fragment containing the rebuilt ancestor tree.
 */
export declare function rebuildTree(node: Node, fragment?: DocumentFragment, alreadyRendered?: Element): DocumentFragment;
/**
 * Rebuilds the ancestor tree of a given node as a document fragment.
 *
 * @param {Node} node The node for which ancestors are rebuilt.
 * @returns {DocumentFragment} A fragment containing cloned ancestors of the node.
 */
export declare function rebuildAncestors(node: Node): DocumentFragment;
/**
 * Checks if a node requires a break before it according to dataset.breakBefore attribute.
 *
 * @param {Node} node The node to check.
 * @returns {boolean} True if a break before is needed, false otherwise.
 */
export declare function needsBreakBefore(node: Node): boolean;
/**
 * Checks if a node requires a break before it according to dataset.breakBefore attribute.
 *
 * @param {Node} node The node to check.
 * @returns {boolean} True if a break before is needed, false otherwise.
 */
export declare function needsBreakAfter(node: Node): boolean;
/**
 * Checks if a node's previous sibling requires a break after it according to dataset.previousBreakAfter attribute.
 *
 * @param {Node} node The node to check.
 * @returns {boolean} True if the previous break after is needed, false otherwise.
 */
export declare function needsPreviousBreakAfter(node: Node): boolean;
/**
 * Determines if a page break is needed between the given node and the previous significant node.
 *
 * @param {Node} node The current node.
 * @param {Node} previousSignificantNode The previous significant node.
 * @returns {boolean} True if a page break is needed, false otherwise.
 */
export declare function needsPageBreak(node: Node, previousSignificantNode: Node): boolean;
/**
 * Generator function to yield word ranges from a text node.
 *
 * @param {Text} node The text node to extract words from.
 * @yields {Range} A Range object for each word found.
 */
export declare function words(node: Text): Generator<Range>;
/**
 * Generator function to yield letter ranges from a word range.
 *
 * @param {Range} wordRange The Range object representing a word.
 * @yields {Range} A Range object for each letter in the word.
 */
export declare function letters(wordRange: Range): Generator<Range>;
/**
 * Determines if a node is considered a container (block) element.
 *
 * @param {Node} node The node to check.
 * @returns {boolean} True if the node is a container, false if it is inline or hidden.
 */
export declare function isContainer(node: Node): boolean;
/**
 * Clones a node.
 *
 * @param {Node} n The node to clone.
 * @param {boolean} [deep=false] Whether to clone deeply.
 * @returns {Node} The cloned node.
 */
export declare function cloneNode(n: Node, deep?: boolean): Node;
/**
 * Retrieves the index of a node's reference in the document's indexOfRefs.
 *
 * @param {Node} node The node with a data-ref attribute.
 * @param {Document} doc The document containing indexOfRefs.
 * @returns {number|undefined} The index of the reference, or undefined if not found.
 */
export declare function inIndexOfRefs(node: Node, doc?: NodeWithRefs): HTMLElement | undefined;
/**
 * Replaces a child element in the parent node if a child with the same data-ref exists,
 * otherwise appends the child.
 *
 * @param {HTMLElement} parentNode The parent element.
 * @param {Node} child The child element to replace or append.
 */
export declare function replaceOrAppendElement(parentNode: HTMLElement, child: Node): void;
/**
 * Finds an element in the document by the node's data-ref attribute.
 *
 * @param {Node} node The node with a data-ref attribute.
 * @param {Document} doc The document to search in.
 * @param {boolean} [forceQuery=false] Whether to force a querySelector search.
 * @returns {Element|undefined} The found element or undefined.
 */
export declare function findElement(node: Node, doc?: NodeWithRefs, forceQuery?: boolean): Element | null | undefined;
/**
 * Finds an element in the document by data-ref value.
 *
 * @param {string} ref The data-ref string to find.
 * @param {Document} doc The document to search in.
 * @param {boolean} [forceQuery=false] Whether to force querySelector search.
 * @returns {Element|null} The found element or null.
 */
export declare function findRef(ref: string | null, doc: NodeWithRefs, forceQuery?: boolean): Element | null | undefined;
/**
 * Validates if a node is either a text node or an element with a data-ref attribute.
 *
 * @param {Node} node The node to validate.
 * @returns {boolean} True if valid, false otherwise.
 */
export declare function validNode(node: Node): boolean;
/**
 * Finds the previous valid node in the sibling/parent chain.
 *
 * @param {Node} node The starting node.
 * @returns {Node|null} The previous valid node or null.
 */
export declare function prevValidNode(node: Node): Node | null;
/**
 * Finds the next valid node in the sibling/parent chain.
 *
 * @param {Node} node The starting node.
 * @returns {Node|null} The next valid node or null.
 */
export declare function nextValidNode(node: Node): Node | null;
/**
 * Gets the index of a node among its siblings.
 *
 * @param {Node} node The node to find the index for.
 * @returns {number} The index of the node.
 */
export declare function indexOf(node: Node): number;
/**
 * Returns the child node at a specific index.
 *
 * @param {Node} node The parent node.
 * @param {number} index The index of the child.
 * @returns {Node} The child node.
 */
export declare function child(node: Node, index: number): Node;
/**
 * Checks if a node is visible (not display:none).
 *
 * @param {Node} node The node to check.
 * @returns {boolean} True if visible, false otherwise.
 */
export declare function isVisible(node: Node): boolean;
/**
 * Checks if a node has any content.
 * Returns true for element nodes or non-empty text nodes.
 *
 * @param {Node} node The node to check.
 * @returns {boolean} True if the node has content, false otherwise.
 */
export declare function hasContent(node: Node): boolean;
/**
 * Checks if a node or any of its immediate child text nodes have non-empty text content.
 *
 * @param {Node} node The node to check.
 * @returns {boolean} True if the node or any child text node has non-empty text content, false otherwise.
 */
export declare function hasTextContent(node: Node): boolean;
/**
 * Finds the index of a text node within its parent's child nodes.
 * If the text node has a previous sibling, tries to find the matching element by data-ref attribute
 * and returns its index + 1. Otherwise, matches by text content.
 * Optionally considers hyphenation removal in the text.
 *
 * @param {Node} node The text node to find the index for.
 * @param {Node} parent The parent node containing the child nodes.
 * @param {string} hyphen The hyphenation string to remove if present at the end of the text.
 * @returns {number} The index of the text node within the parent's child nodes, or -1 if not found.
 */
export declare function indexOfTextNode(node: Node, parent: Element, hyphen: string): number;
/**
 * Finds the index of a rendered text node within its source parent. Text
 * nodes are matched by their ordinal position among non-ignorable text-node
 * children, so the mapping stays correct even when footnote spans/calls have
 * changed the element's child list.
 *
 * @param {Node} node The rendered text node to map.
 * @param {Element} renderedParent The rendered parent (e.g. paragraph).
 * @param {Element} sourceParent The source parent.
 * @param {string} hyphen The hyphenation string to remove if present at the end of the text.
 * @returns {{index: number; offsetAdjustment: number}} The index of the source text node and any offset adjustment needed.
 */
export declare function indexOfTextNodeForOverflow(node: Node, renderedParent: Element, sourceParent: Element, hyphen: string): {
    index: number;
    offsetAdjustment: number;
};
/**
 * Throughout, whitespace is defined as one of the characters
 *  "\t" TAB \u0009
 *  "\n" LF  \u000A
 *  "\r" CR  \u000D
 *  " "  SPC \u0020
 *
 * This does not use Javascript's "\s" because that includes non-breaking
 * spaces (and also some other characters).
 */
/**
 * Determine if a node should be ignored by the iterator functions.
 * taken from https://developer.mozilla.org/en-US/docs/Web/API/Document_Object_Model/Whitespace#Whitespace_helper_functions
 *
 * @param {Node} node An object implementing the DOM1 |Node| interface.
 * @return {boolean} true if the node is:
 *  1) A |Text| node that is all whitespace
 *  2) A |Comment| node
 *  and otherwise false.
 */
export declare function isIgnorable(node: Node): boolean;
/**
 * Determine whether a node's text content is entirely whitespace.
 *
 * @param {Node} node  A node implementing the |CharacterData| interface (i.e., a |Text|, |Comment|, or |CDATASection| node
 * @return {boolean} true if all of the text content of |nod| is whitespace, otherwise false.
 */
export declare function isAllWhitespace(node: Node): boolean;
/**
 * Version of |previousSibling| that skips nodes that are entirely
 * whitespace or comments.  (Normally |previousSibling| is a property
 * of all DOM nodes that gives the sibling node, the node that is
 * a child of the same parent, that occurs immediately before the
 * reference node.)
 *
 * @param {ChildNode} sib  The reference node.
 * @return {Node|null} Either:
 *  1) The closest previous sibling to |sib| that is not ignorable according to |is_ignorable|, or
 *  2) null if no such node exists.
 */
export declare function previousSignificantNode(sib: Node): Node | null;
/**
 * Finds the closest ancestor of a node with a dataset.breakInside attribute equal to "avoid".
 * Traverses up the DOM tree until such a node is found or root is reached.
 *
 * @param {Node} node - The starting node to search from.
 * @returns {Node|null} The closest ancestor node with dataset.breakInside === "avoid",
 *                      or null if none found.
 */
export declare function breakInsideAvoidParentNode(node: Node): Node | null;
/**
 * Find a parent with a given node name.
 * @param {Node} node - initial Node
 * @param {string} nodeName - node name (eg. "TD", "TABLE", "STRONG"...)
 * @param {Node} limiter - go up to the parent until there's no more parent or the current node is equals to the limiter
 * @returns {Node|undefined} - Either:
 *  1) The closest parent for a the given node name, or
 *  2) undefined if no such node exists.
 */
export declare function parentOf(node: Node, nodeName: string, limiter?: Node): Node | undefined;
/**
 * Version of |nextSibling| that skips nodes that are entirely
 * whitespace or comments.
 *
 * @param {ChildNode} sib  The reference node.
 * @return {Node|null} Either:
 *  1) The closest next sibling to |sib| that is not ignorable according to |is_ignorable|, or
 *  2) null if no such node exists.
 */
export declare function nextSignificantNode(sib: Node): Node | null;
/**
 * Traverses a DOM subtree and removes nodes that match a filter function.
 *
 * @param {Node} content - The root node to start traversal from. If falsy, defaults to `this.dom`.
 * @param {function(Node): number} [func] - Optional filter function used by the TreeWalker.
 *        Should return one of the constants from NodeFilter:
 *        - NodeFilter.FILTER_ACCEPT to keep the node,
 *        - NodeFilter.FILTER_REJECT or FILTER_SKIP to exclude it.
 * @param {number} [what=NodeFilter.SHOW_ALL] - Optional mask specifying which node types to show.
 *        Defaults to all nodes.
 */
export declare function filterTree(this: any, content: Node, func?: ((node: Node) => number) | null, what?: number): void;
export {};
