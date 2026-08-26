import Previewer from "./previewer.js";
import * as Paged from "../index.js";
declare global {
    interface Window {
        Paged: typeof Paged;
        PagedConfig?: PagedConfig;
    }
}
export interface PagedConfig {
    auto?: boolean;
    before?: () => void | Promise<void>;
    after?: (result?: unknown) => void | Promise<void>;
    content?: string | HTMLElement;
    stylesheets?: Array<string | Record<string, string> | undefined>;
    renderTo?: string | HTMLElement;
    settings?: Record<string, unknown>;
}
/**
 * Initialize the previewer with optional settings from config.
 */
declare const previewer: Previewer;
/**
 * Export the previewer instance as default export.
 * Useful for manual control or advanced usage.
 */
export default previewer;
