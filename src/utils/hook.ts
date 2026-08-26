/**
 * Hooks allow for injecting functions that must all complete in order before finishing
 * They will execute in parallel but all must finish before continuing
 * Functions may return a promise if they are async.
 * From epubjs/src/utils/hooks
 * @example this.content = new Hook(this);
 */
export type HookFunction<TArgs extends unknown[] = any[]> = (
	...args: TArgs
) => unknown;

export class Hook<TArgs extends unknown[] = any[]> {
	context: unknown;
	hooks: Array<HookFunction<TArgs>>;

	constructor(context?: unknown) {
		this.context = context || this;
		this.hooks = [];
	}

	/**
	 * Adds a function to be run before a hook completes
	 *
	 * @example this.content.register(function(){...});
	 */
	register(...fns: Array<HookFunction<TArgs> | Array<HookFunction<TArgs>>>) {
		for (let i = 0; i < fns.length; ++i) {
			const arg = fns[i];
			if (typeof arg === "function") {
				this.hooks.push(arg);
			} else {
				// unpack array
				for (let j = 0; j < arg.length; ++j) {
					this.hooks.push(arg[j]);
				}
			}
		}
	}

	/**
	 * Triggers a hook to run all functions
	 *
	 * @example this.content.trigger(args).then(function(){...});
	 * @return {Promise} results
	 */
	trigger(...args: TArgs): Promise<unknown[]> {
		const context = this.context;
		const promises: Promise<unknown>[] = [];

		this.hooks.forEach(function (task) {
			const executing = task.apply(context, args);

			if (executing && typeof (executing as Promise<unknown>).then === "function") {
				// Task is a function that returns a promise
				promises.push(executing as Promise<unknown>);
			} else {
				// Otherwise Task resolves immediately, add resolved promise with result
				promises.push(
					new Promise((resolve) => {
						resolve(executing);
					}),
				);
			}
		});

		return Promise.all(promises);
	}

	/**
	 * Triggers a hook to run all functions synchronously
	 *
	 * @example this.content.trigger(args).then(function(){...});
	 * @return {Array} results
	 */
	triggerSync(...args: TArgs): unknown[] {
		const context = this.context;
		const results: unknown[] = [];

		this.hooks.forEach(function (task) {
			const executing = task.apply(context, args);

			results.push(executing);
		});

		return results;
	}

	// Adds a function to be run before a hook completes
	list(): Array<HookFunction<TArgs>> {
		return this.hooks;
	}

	clear(): Array<HookFunction<TArgs>> {
		return (this.hooks = []);
	}
}

export default Hook;
