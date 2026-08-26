/**
 * Represents an overflow area in a document or visual element.
 * Used to track positions and dimensions when content exceeds bounds.
 */
class Overflow {
	node: Node;
	offset?: number;
	overflowHeight?: number;
	range?: Range;
	topLevel?: boolean;
	/** Set later by layout when the overflow fragment has been extracted. */
	ancestor?: Element | null;
	/** Set later by layout: extracted content for this overflow entry. */
	content?: DocumentFragment;

	/**
	 * Creates an instance of Overflow.
	 *
	 * @param {Node} node - The DOM node associated with the overflow.
	 * @param {number} [offset] - The offset within the node where overflow begins.
	 * @param {number} [overflowHeight] - The height of the overflow content.
	 * @param {Range} [range] - The range object representing the overflow area.
	 * @param {boolean} [topLevel] - Indicates if this overflow is at the top level.
	 */
	constructor(
		node: Node,
		offset?: number,
		overflowHeight?: number,
		range?: Range,
		topLevel?: boolean,
	) {
		this.node = node;
		this.offset = offset;
		this.overflowHeight = overflowHeight;
		this.range = range;
		this.topLevel = topLevel;
	}

	/**
	 * Checks if this overflow object is equal to another based on node and offset.
	 *
	 * Offsets are compared with explicit undefined checks: offset 0 is a
	 * meaningful position (a break at the very start of a node), not an
	 * absent one — treating it as falsy here made distinct breaks compare
	 * equal, which stalled pagination with a silently dropped remainder.
	 *
	 * @param {Object} otherOffset - Another object with `node` and `offset` properties to compare against.
	 * @returns {boolean} True if both node and offset match, false otherwise.
	 */
	equals(
		otherOffset?: Partial<Pick<Overflow, "node" | "offset">> | null,
	): boolean {
		if (!otherOffset) {
			return false;
		}
		if (
			this.node &&
			otherOffset.node !== undefined &&
			this.node !== otherOffset.node
		) {
			return false;
		}
		if (
			this.offset !== undefined &&
			otherOffset.offset !== undefined &&
			this.offset !== otherOffset.offset
		) {
			return false;
		}
		return true;
	}
}

export default Overflow;
