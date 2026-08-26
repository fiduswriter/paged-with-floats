/**
 * Hooks allow for injecting functions that must all complete in order before finishing
 * They will execute in parallel but all must finish before continuing
 * Functions may return a promise if they are async.
 * From epubjs/src/utils/hooks
 * @example this.content = new Hook(this);
 */
export type HookFunction<TArgs extends unknown[] = any[]> = (...args: TArgs) => unknown;
export declare class Hook<TArgs extends unknown[] = any[]> {
    context: unknown;
    hooks: Array<HookFunction<TArgs>>;
    constructor(context?: unknown);
    /**
     * Adds a function to be run before a hook completes
     *
     * @example this.content.register(function(){...});
     */
    register(...fns: Array<HookFunction<TArgs> | Array<HookFunction<TArgs>>>): void;
    /**
     * Triggers a hook to run all functions
     *
     * @example this.content.trigger(args).then(function(){...});
     * @return {Promise} results
     */
    trigger(...args: TArgs): Promise<unknown[]>;
    /**
     * Triggers a hook to run all functions synchronously
     *
     * @example this.content.trigger(args).then(function(){...});
     * @return {Array} results
     */
    triggerSync(...args: TArgs): unknown[];
    list(): Array<HookFunction<TArgs>>;
    clear(): Array<HookFunction<TArgs>>;
}
export default Hook;
