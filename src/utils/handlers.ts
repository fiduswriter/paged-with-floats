import pagedMediaHandlers from "../modules/paged-media/index.js";
import generatedContentHandlers from "../modules/generated-content/index.js";
import filters from "../modules/filters/index.js";
import EventEmitter from "event-emitter";
import pipe from "event-emitter/pipe.js";
import type Handler from "../modules/handler.js";
import type { PagedEventEmitter } from "../types/emitter.js";

/**
 * Array of all registered handler classes, composed from different modules.
 */
export let registeredHandlers: Array<typeof Handler> = [
	...pagedMediaHandlers,
	...generatedContentHandlers,
	...filters,
];

/**
 * Class responsible for instantiating and managing handler instances.
 * Emits events from all handlers through itself.
 */
export class Handlers {
	handlers: Handler[];

	constructor(chunker: object, polisher: object, caller: object) {
		this.handlers = [];

		registeredHandlers.forEach((HandlerClass) => {
			const handler: Handler = new HandlerClass(chunker, polisher, caller);
			this.handlers.push(handler);
			pipe(handler, this);
		});
	}
}

export interface Handlers extends PagedEventEmitter {}

// Mix event-emitter methods into Handlers prototype
EventEmitter(Handlers.prototype);

/**
 * Adds new handler classes to the list of registered handlers.
 * @param {...typeof Handler} handlers - One or more handler classes to register.
 */
export function registerHandlers(...handlers: Array<typeof Handler>) {
	registeredHandlers.push(...handlers);
}

/**
 * Creates and initializes a new Handlers instance.
 * @param {Object} chunker - The chunker object to pass to handlers.
 * @param {Object} polisher - The polisher object to pass to handlers.
 * @param {Object} caller - The caller object to pass to handlers.
 * @returns {Handlers} The initialized Handlers instance.
 */
export function initializeHandlers(
	chunker: object,
	polisher: object,
	caller: object,
): Handlers {
	return new Handlers(chunker, polisher, caller);
}
