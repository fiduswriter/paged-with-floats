import Overflow from "./overflow.js";

/**
 * Represents a token used to manage breaks (e.g., page or line breaks) in layout rendering.
 * Holds information about the current node, overflow content, and break requirements.
 */
class BreakToken {
	node: Node;
	overflow: Overflow[];
	finished: boolean;
	breakNeededAt: Node[];

	/**
	 * Creates a new BreakToken instance.
	 *
	 * @param {Node} node - The DOM node this break token is associated with.
	 * @param {Overflow[]} [overflowArray] - An optional array of overflow items from layout.
	 */
	constructor(node: Node, overflowArray?: Overflow[]) {
		this.node = node;

		this.overflow = overflowArray || [];

		this.finished = false;

		this.breakNeededAt = [];
	}

	/**
	 * Compares this BreakToken to another to determine equality.
	 *
	 * @param {BreakToken} otherBreakToken - Another BreakToken to compare with.
	 * @returns {boolean} True if both BreakTokens are equivalent; otherwise, false.
	 */
	equals(otherBreakToken: BreakToken): boolean {
		if (this.node !== otherBreakToken.node) {
			return false;
		}

		if (otherBreakToken.overflow.length !== this.overflow.length) {
			return false;
		}

		for (const index in this.overflow) {
			if (!this.overflow[index].equals(otherBreakToken.overflow[index])) {
				return false;
			}
		}

		const otherQueue = otherBreakToken.getForcedBreakQueue();
		for (const index in this.breakNeededAt) {
			if (!this.breakNeededAt[index].isEqualNode(otherQueue[index])) {
				return false;
			}
		}

		return true;
	}

	/**
	 * Marks the BreakToken as finished (i.e., no further processing required).
	 */
	setFinished(): void {
		this.finished = true;
	}

	/**
	 * Checks whether the BreakToken has been marked as finished.
	 *
	 * @returns {boolean} True if finished, otherwise false.
	 */
	isFinished(): boolean {
		return this.finished;
	}

	/**
	 * Adds a DOM node that requires a break (e.g., forced page break).
	 *
	 * @param {Node} needsBreak - A DOM node where a break is required.
	 */
	addNeedsBreak(needsBreak: Node): void {
		this.breakNeededAt.push(needsBreak);
	}

	/**
	 * Retrieves and removes the next node that needs a break.
	 *
	 * @returns {Node | undefined} The next node requiring a break, or undefined if none remain.
	 */
	getNextNeedsBreak(): Node | undefined {
		return this.breakNeededAt.shift();
	}

	/**
	 * Gets the current queue of nodes where breaks are needed.
	 *
	 * @returns {Node[]} An array of nodes requiring breaks.
	 */
	getForcedBreakQueue(): Node[] {
		return this.breakNeededAt;
	}

	/**
	 * Sets the queue of nodes where breaks are needed.
	 *
	 * @param {Node[]} queue - The new queue of nodes requiring breaks.
	 * @returns {Node[]} The updated queue.
	 */
	setForcedBreakQueue(queue: Node[]): Node[] {
		return (this.breakNeededAt = queue);
	}
}

export default BreakToken;
