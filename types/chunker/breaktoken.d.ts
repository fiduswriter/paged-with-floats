import Overflow from "./overflow.js";
/**
 * Represents a token used to manage breaks (e.g., page or line breaks) in layout rendering.
 * Holds information about the current node, overflow content, and break requirements.
 */
declare class BreakToken {
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
    constructor(node: Node, overflowArray?: Overflow[]);
    /**
     * Compares this BreakToken to another to determine equality.
     *
     * @param {BreakToken} otherBreakToken - Another BreakToken to compare with.
     * @returns {boolean} True if both BreakTokens are equivalent; otherwise, false.
     */
    equals(otherBreakToken: BreakToken): boolean;
    /**
     * Marks the BreakToken as finished (i.e., no further processing required).
     */
    setFinished(): void;
    /**
     * Checks whether the BreakToken has been marked as finished.
     *
     * @returns {boolean} True if finished, otherwise false.
     */
    isFinished(): boolean;
    /**
     * Adds a DOM node that requires a break (e.g., forced page break).
     *
     * @param {Node} needsBreak - A DOM node where a break is required.
     */
    addNeedsBreak(needsBreak: Node): void;
    /**
     * Retrieves and removes the next node that needs a break.
     *
     * @returns {Node | undefined} The next node requiring a break, or undefined if none remain.
     */
    getNextNeedsBreak(): Node | undefined;
    /**
     * Gets the current queue of nodes where breaks are needed.
     *
     * @returns {Node[]} An array of nodes requiring breaks.
     */
    getForcedBreakQueue(): Node[];
    /**
     * Sets the queue of nodes where breaks are needed.
     *
     * @param {Node[]} queue - The new queue of nodes requiring breaks.
     * @returns {Node[]} The updated queue.
     */
    setForcedBreakQueue(queue: Node[]): Node[];
}
export default BreakToken;
