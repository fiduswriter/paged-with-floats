import EventEmitter from "event-emitter";

import Hook from "../utils/hook.js";
import Chunker from "../chunker/chunker.js";
import Polisher from "../polisher/polisher.js";
import type { PolisherHooks } from "../polisher/polisher.js";
import {
	validateRenderedPages,
	collectRenderWarnings,
	rebalanceMulticolFinals,
	rebalanceManualColumnFinals,
	type OverflowViolation,
	type RenderWarning,
} from "../chunker/layout.js";
import type Page from "../chunker/page.js";

import { initializeHandlers, registerHandlers } from "../utils/handlers.js";
import type Handler from "../modules/handler.js";
import type { PagedEventEmitter } from "../types/emitter.js";
import type { PagedConfig } from "./polyfill.js";

export interface PageSize {
	value: number;
	unit: string;
}

export interface Size {
	width: PageSize;
	height: PageSize;
	format?: string;
	orientation?: string;
}

export type FlowResult = Chunker & {
	pages: Page[];
	performance?: number;
	size?: Size;
	/** Pages with content outside its designated space (post-render audit). */
	overflowViolations?: OverflowViolation[];
	/** Non-fatal rendering notices (sub-tolerance protrusions, hyphenation). */
	warnings?: RenderWarning[];
};

/**
 * The main class responsible for preparing, chunking, styling, and rendering content into paginated previews.
 *
 * Emits events:
 * - `page`: when a page is rendered
 * - `rendering`: when rendering starts
 * - `rendered`: when rendering finishes
 * - `size`: when page size is set
 * - `atpages`: when @page rules are processed
 */
class Previewer {
	settings: Record<string, unknown>;
	polisher: Polisher;
	chunker: Chunker;
	hooks: {
		beforePreview: Hook<[unknown, unknown]>;
		afterPreview: Hook<[Page[]]>;
	};
	size: Size;
	atpages?: unknown[];
	handlers?: ReturnType<typeof initializeHandlers>;

	/**
	 * Create a new Previewer instance.
	 * @param {Object} [options] - Optional configuration settings for rendering.
	 */
	constructor(options?: Record<string, unknown>) {
		this.settings = options || {};

		this.polisher = new Polisher(false);

		this.chunker = new Chunker(undefined, undefined, this.settings);

		this.hooks = {
			beforePreview: new Hook(this),
			afterPreview: new Hook(this),
		};

		this.size = {
			width: {
				value: 8.5,
				unit: "in",
			},
			height: {
				value: 11,
				unit: "in",
			},
			format: undefined,
			orientation: undefined,
		};

		this.chunker.on("page", (page) => {
			this.emit("page", page);
		});

		this.chunker.on("rendering", () => {
			this.emit("rendering", this.chunker);
		});
	}

	/**
	 * Initializes handler modules (like footnotes, counters, etc.) and sets up relevant events.
	 * @returns {Object} - The handler system that manages internal processing hooks.
	 */
	initializeHandlers() {
		const handlers = initializeHandlers(this.chunker, this.polisher, this);

		handlers.on("size", (size: Size) => {
			this.size = size;
			this.emit("size", size);
		});

		handlers.on("atpages", (pages: unknown[]) => {
			this.atpages = pages;
			this.emit("atpages", pages);
		});

		return handlers;
	}

	/**
	 * Registers handlers with custom logic or extensions.
	 * @returns {*} - The result of the registerHandlers function.
	 */
	registerHandlers(...args: Array<typeof Handler>) {
		return registerHandlers.apply(registerHandlers, args as never);
	}

	/**
	 * Retrieve a query parameter from the current URL.
	 * @param {string} name - Name of the parameter.
	 * @returns {string | undefined} - Parameter value if found.
	 */
	getParams(name: string): string | undefined {
		let param;
		const url = new URL(window.location as unknown as URL);
		const params = new URLSearchParams(url.search);
		for (const pair of params.entries()) {
			if (pair[0] === name) {
				param = pair[1];
			}
		}
		return param;
	}

	/**
	 * Wraps the contents of the `<body>` in a `<template>` element if not already present.
	 * This is used to preserve the original content for chunking and layout.
	 *
	 * @returns {DocumentFragment} - The wrapped content.
	 */
	wrapContent(): DocumentFragment {
		const body = document.querySelector("body")!;
		let template = body.querySelector(
			":scope > template[data-ref='paged-content']",
		);

		if (!template) {
			template = document.createElement("template");
			template.dataset.ref = "paged-content";
			template.innerHTML = body.innerHTML;
			body.innerHTML = "";
			body.appendChild(template);
		}

		return (template as HTMLTemplateElement).content;
	}

	/**
	 * Removes stylesheets and inline `<style>` elements that should not be processed.
	 * Also returns the list of removed styles for reprocessing later.
	 *
	 * @param {Document} [doc=document] - The document to process styles from.
	 * @returns {Array} - Array of stylesheet hrefs or inline style objects.
	 */
	removeStyles(
		doc: Document = document,
	): Array<string | Record<string, string> | undefined> {
		const stylesheets = Array.from(
			doc.querySelectorAll(
				"link[rel='stylesheet']:not([data-paged-ignore], [media~='screen'])",
			),
		);
		const inlineStyles = Array.from(
			doc.querySelectorAll(
				"style:not([data-paged-inserted-styles], [data-paged-ignore], [media~='screen'])",
			),
		);
		const elements = [...stylesheets, ...inlineStyles];

		return elements
			.sort((a, b) => {
				const position = a.compareDocumentPosition(b);
				if (position === Node.DOCUMENT_POSITION_PRECEDING) return 1;
				if (position === Node.DOCUMENT_POSITION_FOLLOWING) return -1;
				return 0;
			})
			.map((element) => {
				if (element.nodeName === "STYLE") {
					const obj: Record<string, string> = {};
					obj[window.location.href] = element.textContent!;
					element.remove();
					return obj;
				}
				if (element.nodeName === "LINK") {
					element.remove();
					return (element as HTMLLinkElement).href;
				}
				console.warn(`Unable to process: ${element}, ignoring.`);
			});
	}

	/**
	 * Harvests stylesheets embedded in the content itself — `<style>`
	 * elements and stylesheet `<link>`s that live inside the body/fragment
	 * rather than the document head.
	 *
	 * Manual `Previewer` callers typically pass a fragment whose CSS is
	 * embedded in it (demos, editable previews). Without harvesting, that
	 * CSS never reaches the polisher: handlers never see the declarations
	 * (page floats go untagged, `@page` rules stay dead) and the raw rules
	 * apply globally once rendered. The elements are removed from the
	 * content and returned for polisher processing.
	 *
	 * @param {DocumentFragment|HTMLElement} content - The content to harvest from.
	 * @returns {Array} - Stylesheet hrefs / inline style objects, in document order.
	 */
	removeContentStyles(
		content?: DocumentFragment | HTMLElement | string | null,
	): Array<string | Record<string, string> | undefined> {
		const root = content as ParentNode;
		if (!root || typeof root.querySelectorAll !== "function") {
			return [];
		}
		const elements = Array.from(
			root.querySelectorAll(
				"style:not([data-paged-inserted-styles], [data-paged-ignore], [media~='screen']), " +
					"link[rel='stylesheet']:not([data-paged-ignore], [media~='screen'])",
			),
		);
		return elements
			.sort((a, b) => {
				const position = a.compareDocumentPosition(b);
				if (position === Node.DOCUMENT_POSITION_PRECEDING) return 1;
				if (position === Node.DOCUMENT_POSITION_FOLLOWING) return -1;
				return 0;
			})
			.map((element) => {
				if (element.nodeName === "STYLE") {
					const obj: Record<string, string> = {};
					obj[window.location.href] = element.textContent!;
					element.remove();
					return obj;
				}
				element.remove();
				return (element as HTMLLinkElement).href;
			});
	}

	/**
	 * Main method for rendering content into paginated preview.
	 * Triggers hooks and events, applies stylesheets, chunks the content, and returns the flow result.
	 *
	 * @param {HTMLElement|DocumentFragment|string} [content] - The content to render.
	 * @param {Array<string|Object>} [stylesheets] - List of stylesheet hrefs or inline styles to apply.
	 * @param {HTMLElement|string} [renderTo] - Element or selector where rendered content will be inserted.
	 * @returns {Promise<Object>} - Resolves to the rendered flow object with performance and size metadata.
	 */
	async preview(
		content?: HTMLElement | DocumentFragment | string,
		stylesheets?: Array<string | Record<string, string> | undefined>,
		renderTo?: HTMLElement | string,
	): Promise<FlowResult> {
		await this.hooks.beforePreview.trigger(content, renderTo);

		let flowContent = content;
		let flowStylesheets = stylesheets;

		if (!flowContent) {
			flowContent = this.wrapContent();
		}

		let docStylesheets: Array<string | Record<string, string> | undefined> =
			[];
		if (flowStylesheets === undefined || flowStylesheets === null) {
			docStylesheets = this.removeStyles();
		}

		// Content-embedded styles are harvested wherever the content came
		// from and processed last (they originate latest in source order).
		const contentStylesheets = this.removeContentStyles(flowContent);

		flowStylesheets = [...docStylesheets, ...(flowStylesheets ?? []), ...contentStylesheets];

		this.polisher.setup();
		this.handlers = this.initializeHandlers();

		await this.polisher.add(
			...(flowStylesheets as Array<string | Record<string, string>>),
		);

		const startTime = performance.now();

		const flow = (await this.chunker.flow(
			flowContent,
			renderTo as HTMLElement,
		)) as FlowResult;

		const endTime = performance.now();

		// Release height constraints on final multicol fragments so their
		// columns balance (column-fill: balance behavior on last pages).
		rebalanceMulticolFinals(this.chunker.pagesArea);
		rebalanceManualColumnFinals(this.chunker.pagesArea);

		// Let every image finish loading and layout before auditing: a float
		// figure whose image completes after its page was filled changes the
		// column heights, and auditing against the in-flight geometry would
		// report spills that no longer exist (or miss live ones).
		await Promise.all(
			Array.from(
				(this.chunker.pagesArea || document).querySelectorAll("img"),
			).map((img) =>
				img.complete
					? Promise.resolve()
					: new Promise<void>((resolve) => {
							img.addEventListener("load", () => resolve(), { once: true });
							img.addEventListener("error", () => resolve(), { once: true });
						}),
			),
		);
		// One frame for the browser to lay out the settled images.
		await new Promise((resolve) => requestAnimationFrame(resolve));

		flow.performance = endTime - startTime;
		flow.size = this.size;

		flow.overflowViolations = validateRenderedPages(this.chunker.pagesArea);
		if (flow.overflowViolations.length) {
			console.warn(
				`paged-with-floats: ${flow.overflowViolations.length} page(s) contain ` +
					"content outside its designated space",
				flow.overflowViolations.slice(0, 5),
			);
		}

		// Non-fatal notices: sub-tolerance margin protrusions and words
		// hyphenated at break points. Returned to the client, which can
		// ignore them or act on them; only a summary goes to the console.
		flow.warnings = collectRenderWarnings(this.chunker.pagesArea);
		if (flow.warnings.length) {
			console.warn(
				`paged-with-floats: ${flow.warnings.length} rendering warning(s) ` +
					"(available on flow.warnings)",
			);
		}

		this.emit("rendered", flow);

		await this.hooks.afterPreview.trigger(flow.pages);

		return flow;
	}
}

interface Previewer extends PagedEventEmitter {}

// Add event emitter behavior to the Previewer prototype
EventEmitter(Previewer.prototype);

export default Previewer;

// Re-exported for consumers of this module's types.
export type { PolisherHooks };
export type { PagedConfig };
