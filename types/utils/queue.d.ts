import { defer } from "./utils.js";
type QueuedTask = (...args: any[]) => unknown;
interface QueuedItemTask {
    task: QueuedTask;
    args: any[];
    deferred: defer;
    promise: Promise<unknown>;
}
interface QueuedItemPromise {
    promise: Promise<unknown>;
    task?: undefined;
    args?: undefined;
    deferred?: undefined;
}
type QueueItem = QueuedItemTask | QueuedItemPromise;
declare class Queue {
    _q: QueueItem[];
    context: unknown;
    tick: (cb: () => void) => number;
    running: boolean | Promise<unknown> | undefined;
    paused: boolean;
    defered: defer;
    constructor(context: unknown);
    /**
     * Schedules a callback on the next animation frame, with a timer
     * fallback for environments that stop producing frames.
     *
     * Occluded or minimized windows pause requestAnimationFrame
     * indefinitely; without the fallback, pagination would stall forever
     * whenever the preview is not actually on screen. Whichever signal
     * arrives first wins; the other is cancelled.
     *
     * @param {Function} cb - The callback to schedule.
     * @returns {number} The animation frame handle.
     */
    private scheduleTick;
    /**
     * Add an item to the queue
     *
     * @return {Promise} enqueued
     */
    enqueue(task?: QueuedTask | Promise<unknown>, ...args: any[]): Promise<unknown>;
    /**
     * Run one item
     *
     * @return {Promise} dequeued
     */
    dequeue(): Promise<unknown>;
    dump(): void;
    /**
     * Run all tasks sequentially, at convenience
     *
     * @return {Promise} all run
     */
    run(): Promise<unknown>;
    /**
     * Flush all, as quickly as possible
     *
     * @return {Promise} ran
     */
    flush(): Promise<unknown> | undefined;
    /**
     * Clear all items in wait
     */
    clear(): void;
    /**
     * Get the number of tasks in the queue
     *
     * @return {number} tasks
     */
    length(): number;
    /**
     * Pause a running queue
     */
    pause(): void;
    /**
     * End the queue
     */
    stop(): void;
}
/**
 * Create a new task from a callback
 *
 * @param {function} task - Task to complete.
 * @param {any[]} [args] - Arguments for the task.
 * @param {unknown} [context] - Scope of the task.
 * @returns {function} A function returning a promise that resolves via a Node-style callback appended to the arguments.
 */
export declare function Task(task: (...args: any[]) => void, args?: any[], context?: unknown): (...cbArgs: any[]) => Promise<unknown>;
export default Queue;
