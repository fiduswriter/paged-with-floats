/**
 * Print + PDF export entry point.
 *
 * Three APIs:
 *
 * 1. `printHTML(html, config)` — paginates `html` with paged-with-floats inside
 *    a hidden iframe and hands the window to `printCallback` (default: browser
 *    print dialog).
 *
 * 2. `emitPdfFromPagedWindow(win)` — walks the paginated output in that window
 *    and re-renders it as a real vector PDF using pages-to-pdf.
 *
 * 3. `htmlToPDF(html, options)` — the two above composed into a single call:
 *    paginate, emit, clean up, resolve with the PDF bytes.
 *
 * ```ts
 * import { htmlToPDF } from "paged-with-floats/pdf";
 *
 * const bytes = await htmlToPDF(htmlDoc, {
 *     title: "My document",
 *     metadata: { title: "My document" },
 * });
 * download(new Blob([bytes], { type: "application/pdf" }));
 * ```
 */
import {
	emitPdfFromWindow,
	PAGED_WITH_FLOATS_BACKEND,
	type EmitMetadata,
	type EmitOptions,
} from "pages-to-pdf";
import { printHTML } from "./print.js";

export {
	printHTML,
	type PrintHTMLConfig,
} from "./print.js";

/**
 * Emit a PDF from a window paginated by paged-with-floats.
 *
 * This is a convenience alias for
 * `emitPdfFromWindow(win, { backend: PAGED_WITH_FLOATS_BACKEND, ...options })`.
 */
export function emitPdfFromPagedWindow(
	win: Window,
	onProgress?: (message: string) => void,
	options?: Omit<EmitOptions, "backend">,
): Promise<Uint8Array> {
	return emitPdfFromWindow(win, onProgress, {
		...options,
		backend: PAGED_WITH_FLOATS_BACKEND,
	});
}

/**
 * Options for {@link htmlToPDF}: pagination/print configuration combined
 * with the PDF emission extras.
 */
export interface HtmlToPDFOptions {
	/** Applied to the paginated iframe document and default PDF title. */
	title?: string;
	/** URL of the paged-with-floats polyfill bundle for the print frame. */
	polyfillURL?: string;
	/** Extra Previewer settings (textMeasurement etc.). */
	settings?: Record<string, unknown>;
	/** Source HTML embedded as a PDF file attachment when provided. */
	sourceHtml?: string;
	/** Document metadata (title/author/subject/keywords/language). */
	metadata?: EmitMetadata;
	/** Base URL for resolving fonts and assets in the paginated output. */
	baseUrl?: string;
	/** Where the WOFF2 decoder wasm lives (string URL or raw bytes). */
	woff2WasmUrl?: string | ArrayBuffer;
	/** Additional files to attach to the PDF. */
	attachments?: import("pages-to-pdf").EmitAttachment[];
	/** Print-level extras passed through to the emitter. */
	printOptions?: EmitOptions["printOptions"];
}

/**
 * Paginates `html` with paged-with-floats and returns real vector PDF bytes —
 * no print dialog involved. Composition of `printHTML` and
 * `emitPdfFromPagedWindow`, with iframe cleanup handled internally.
 *
 * @param html - A complete HTML document string.
 * @param options - Pagination and emission options.
 * @returns The PDF file bytes.
 */
export async function htmlToPDF(
	html: string,
	options: HtmlToPDFOptions = {},
): Promise<Uint8Array> {
	const emitOptions: EmitOptions = {
		sourceHtml: options.sourceHtml ?? html,
		metadata: {
			title: options.title,
			...(options.metadata || {}),
		},
		baseUrl: options.baseUrl,
		woff2WasmUrl: options.woff2WasmUrl,
		attachments: options.attachments,
		printOptions: options.printOptions,
		backend: PAGED_WITH_FLOATS_BACKEND,
	};

	const iframe: HTMLIFrameElement = await printHTML(html, {
		title: options.title,
		polyfillURL: options.polyfillURL,
		settings: options.settings,
		keepIframe: true,
		printCallback: () => {
			// htmlToPDF emits the PDF programmatically; do not open the browser
			// print dialog.
		},
		errorCallback: (message: string) => {
			throw new Error(message);
		},
	});
	try {
		const win = iframe.contentWindow!;
		return await emitPdfFromWindow(win, undefined, emitOptions);
	} finally {
		// Give microtasks spawned by emission a tick to unwind before the
		// window they measured against disappears.
		window.setTimeout(() => iframe.remove(), 0);
	}
}
