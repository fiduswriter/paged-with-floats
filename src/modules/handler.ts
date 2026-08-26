import EventEmitter from "event-emitter";
import type { Hook } from "../utils/hook.js";
import type { PagedEventEmitter } from "../types/emitter.js";

/** A map of hook names to Hook instances, as exposed by chunker/polisher/previewer. */
export type HooksMap = Record<string, Hook<any[]>>;

export interface HandlerSource {
	hooks?: HooksMap;
}

/**
 * Handler class that automatically registers methods as hook callbacks
 * based on hooks provided by chunker, polisher, and caller objects.
 *
 * It also extends its prototype with event-emitter capabilities,
 * allowing instances to emit and listen to events.
 *
 * The index signature reflects the dynamic registration: any hook name
 * present in the merged hooks map may be backed by a same-named method.
 */
class Handler {
	[key: string]: any;

	chunker?: HandlerSource | null;
	polisher?: HandlerSource | null;
	caller?: HandlerSource | null;

	constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource) {
		// Merge all hook maps from chunker, polisher, and caller into one object.
		// Only include hooks if the corresponding object exists.
		const hooks = Object.assign(
			{},
			chunker && chunker.hooks,
			polisher && polisher.hooks,
			caller && caller.hooks,
		);

		this.chunker = chunker;
		this.polisher = polisher;
		this.caller = caller;

		// Loop through all hook names
		for (const name in hooks) {
			// Only register a hook if the Handler instance has a method with the same name
			if (name in this) {
				const hook = hooks[name];

				// Register the Handler's method as a callback for the hook
				// Bind ensures "this" refers to the Handler instance
				hook.register(this[name].bind(this));
			}
		}
	}
}

interface Handler extends PagedEventEmitter {}

// Mix event emitter methods (on, off, emit, etc.) into Handler.prototype
EventEmitter(Handler.prototype);

export default Handler;
