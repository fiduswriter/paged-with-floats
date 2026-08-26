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
declare class Handler {
    [key: string]: any;
    chunker?: HandlerSource | null;
    polisher?: HandlerSource | null;
    caller?: HandlerSource | null;
    constructor(chunker?: HandlerSource, polisher?: HandlerSource, caller?: HandlerSource);
}
interface Handler extends PagedEventEmitter {
}
export default Handler;
