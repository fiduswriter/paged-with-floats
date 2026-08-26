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
 * Expose the Paged API to the global window object.
 * Useful for debugging or for external scripts that want to access the API.
 */
window.Paged = Paged;

/**
 * A promise that resolves when the DOM is ready (interactive or complete).
 * Used to defer preview rendering until the page is ready.
 */
const ready = new Promise<string>(function (resolve, _reject) {
	if (
		document.readyState === "interactive" ||
		document.readyState === "complete"
	) {
		resolve(document.readyState);
		return;
	}

	document.onreadystatechange = function () {
		if (document.readyState === "interactive") {
			resolve(document.readyState);
		}
	};
});

/** Configuration object for controlling the preview behavior. */
const config: PagedConfig = window.PagedConfig || {
	auto: true,
	before: undefined,
	after: undefined,
	content: undefined,
	stylesheets: undefined,
	renderTo: undefined,
	settings: undefined,
};

/**
 * Initialize the previewer with optional settings from config.
 */
const previewer = new Previewer(config.settings);

/**
 * Main logic that runs once the DOM is ready.
 * - Executes `before` hook if defined
 * - Triggers `previewer.preview()` if `auto` is not explicitly disabled
 * - Executes `after` hook with result if defined
 */
ready.then(async function () {
	let done;

	// Call optional hook before preview
	if (config.before) {
		await config.before();
	}

	// Automatically render content if not disabled
	if (config.auto !== false) {
		done = await previewer.preview(
			config.content,
			config.stylesheets,
			config.renderTo,
		);
	}

	// Call optional hook after preview
	if (config.after) {
		await config.after(done);
	}
});

/**
 * Export the previewer instance as default export.
 * Useful for manual control or advanced usage.
 */
export default previewer;
