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
/**
 * Queue for handling tasks one at a time
 */

/** Fallback interval when animation frames are not being produced. */
const TICK_FALLBACK_MS = 100;

class Queue {

	_q: QueueItem[];
	context: unknown;
	tick: (cb: () => void) => number;
	running: boolean | Promise<unknown> | undefined;
	paused: boolean;
	defered!: defer;

	constructor(context: unknown) {
		this._q = [];
		this.context = context;
		this.tick = this.scheduleTick;
		this.running = false;
		this.paused = false;
	}

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
	private scheduleTick(cb: () => void): number {
		let fired = false;
		const once = () => {
			if (fired) {
				return;
			}
			fired = true;
			window.clearTimeout(fallback);
			cb();
		};
		const handle = requestAnimationFrame.call(window, once);
		const fallback = window.setTimeout(once, TICK_FALLBACK_MS);
		return handle;
	}
	/**
	 * Add an item to the queue
	 *
	 * @return {Promise} enqueued
	 */
	enqueue(
		task?: QueuedTask | Promise<unknown>,
		...args: any[]
	): Promise<unknown> {
		let deferred: defer;
		let promise: Promise<unknown> | undefined;
		let queued: QueueItem;

		if (!task) {
			throw new Error("No Task Provided");
		}

		if (typeof task === "function") {
			deferred = new defer();
			promise = deferred.promise;

			queued = {
				task,
				args,
				deferred,
				promise,
			};
		} else {
			// Task is a promise
			queued = {
				promise: task,
			};
		}

		this._q.push(queued);

		// Wait to start queue flush
		if (this.paused == false && !this.running) {
			this.run();
		}

		return queued.promise!;
	}

	/**
	 * Run one item
	 *
	 * @return {Promise} dequeued
	 */
	dequeue(): Promise<unknown> {
		let inwait: QueueItem;

		if (this._q.length && !this.paused) {
			inwait = this._q.shift()!;
			const task = inwait.task;
			if (task) {
				const result = task.apply(this.context, inwait.args);

				if (result && typeof (result as Promise<unknown>).then === "function") {
					// Task is a function that returns a promise
					const deferredTask = (inwait as QueuedItemTask).deferred;
					return (result as Promise<unknown>).then(
						function (this: Queue) {
							deferredTask.resolve.apply(this.context, arguments as any);
						}.bind(this),
						function (this: Queue) {
							deferredTask.reject.apply(this.context, arguments as any);
						}.bind(this),
					);
				} else {
					// Task resolves immediately
					(inwait as QueuedItemTask).deferred.resolve.apply(
						this.context,
						result as any,
					);
					return inwait.promise;
				}
			} else if (inwait.promise) {
				// Task is a promise
				return inwait.promise;
			}
		}

		const settled = new defer();
		settled.resolve();
		return settled.promise;
	}

	// Run All Immediately
	dump(): void {
		while (this._q.length) {
			this.dequeue();
		}
	}

	/**
	 * Run all tasks sequentially, at convenience
	 *
	 * @return {Promise} all run
	 */
	run(): Promise<unknown> {
		if (!this.running) {
			this.running = true;
			this.defered = new defer();
		}

		this.tick.call(window, () => {
			if (this._q.length) {
				this.dequeue().then(
					function (this: Queue) {
						this.run();
					}.bind(this),
				);
			} else {
				this.defered.resolve();
				this.running = undefined;
			}
		});

		// Unpause
		if (this.paused == true) {
			this.paused = false;
		}

		return this.defered.promise;
	}

	/**
	 * Flush all, as quickly as possible
	 *
	 * @return {Promise} ran
	 */
	flush(): Promise<unknown> | undefined {
		if (this.running) {
			return this.running as Promise<unknown>;
		}

		if (this._q.length) {
			this.running = this.dequeue().then(
				function (this: Queue) {
					this.running = undefined;
					return this.flush();
				}.bind(this),
			);

			return this.running;
		}

		return;
	}

	/**
	 * Clear all items in wait
	 */
	clear(): void {
		this._q = [];
	}

	/**
	 * Get the number of tasks in the queue
	 *
	 * @return {number} tasks
	 */
	length(): number {
		return this._q.length;
	}

	/**
	 * Pause a running queue
	 */
	pause(): void {
		this.paused = true;
	}

	/**
	 * End the queue
	 */
	stop(): void {
		this._q = [];
		this.running = false;
		this.paused = true;
	}
}

/**
 * Create a new task from a callback
 *
 * @param {function} task - Task to complete.
 * @param {any[]} [args] - Arguments for the task.
 * @param {unknown} [context] - Scope of the task.
 * @returns {function} A function returning a promise that resolves via a Node-style callback appended to the arguments.
 */
export function Task(
	task: (...args: any[]) => void,
	args: any[] = [],
	context?: unknown,
): (...cbArgs: any[]) => Promise<unknown> {
	return function (this: unknown) {
		const toApply = Array.prototype.slice.call(arguments) as any[];

		return new Promise((resolve, reject) => {
			const callback = function (value: unknown, err: unknown) {
				if (!value && err) {
					reject(err);
				} else {
					resolve(value);
				}
			};
			// Add the callback to the arguments list
			toApply.push(callback);

			// Apply all arguments to the functions
			task.apply(context || this, toApply);
		});
	};
}

export default Queue;
