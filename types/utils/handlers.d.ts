import type Handler from "../modules/handler.js";
import type { PagedEventEmitter } from "../types/emitter.js";
/**
 * Array of all registered handler classes, composed from different modules.
 */
export declare let registeredHandlers: Array<typeof Handler>;
/**
 * Class responsible for instantiating and managing handler instances.
 * Emits events from all handlers through itself.
 */
export declare class Handlers {
    handlers: Handler[];
    constructor(chunker: object, polisher: object, caller: object);
}
export interface Handlers extends PagedEventEmitter {
}
/**
 * Adds new handler classes to the list of registered handlers.
 * @param {...typeof Handler} handlers - One or more handler classes to register.
 */
export declare function registerHandlers(...handlers: Array<typeof Handler>): void;
/**
 * Creates and initializes a new Handlers instance.
 * @param {Object} chunker - The chunker object to pass to handlers.
 * @param {Object} polisher - The polisher object to pass to handlers.
 * @param {Object} caller - The caller object to pass to handlers.
 * @returns {Handlers} The initialized Handlers instance.
 */
export declare function initializeHandlers(chunker: object, polisher: object, caller: object): Handlers;
