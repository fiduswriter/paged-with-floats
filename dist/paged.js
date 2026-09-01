/**
 * @license paged-with-floats v0.10.0
 *
 * Modifications and additions in this build are Copyright (C) 2026 Johannes Wilm
 * and licensed under the GNU Lesser General Public License, version 3 or later
 * (LGPL-3.0-or-later). See COPYING.LESSER and LICENSE.md for details.
 *
 * Contains substantial portions of Paged.js, licensed under the MIT License:
 * Copyright (c) 2018 Adam Hyde. This notice is retained as required by that
 * license. See LICENSE.md for the full license text.
 */

import { PAGED_WITH_FLOATS_BACKEND, emitPdfFromWindow } from 'pages-to-pdf';

/**
 * Vivliostyle-print-compatible print entry point.
 *
 * Mirrors the API documented in the vivliostyle-print README:
 *
 * ```ts
 * import { printHTML } from "paged-with-floats";
 *
 * printHTML(htmlDoc, {
 *     title: "my printed page",
 *     printCallback: (iframeWin) => iframeWin.print(), // optional
 *     errorCallback: (message) => alert(message),      // optional
 * });
 * ```
 *
 * Instead of vivliostyle's layout engine, the given document is paginated
 * by paged-with-floats inside a hidden same-origin iframe that loads this library's
 * polyfill bundle. When pagination has finished, `printCallback` receives
 * the iframe window (for e.g. emitPdfFromPagedWindow); without a
 * callback the iframe prints directly and is removed.
 */
function defaultPolyfillURL() {
    for (const script of Array.from(document.querySelectorAll("script[src]"))) {
        const src = script.src || "";
        if (/paged[^/]*\.js$/.test(src)) {
            return new URL("paged.polyfill.js", src).href;
        }
    }
    return new URL("paged.polyfill.js", window.location.href).href;
}
const PRINT_TIMEOUT_MS = 300000;
function printHTML(html, config = {}) {
    return new Promise((resolve) => {
        const iframe = document.createElement("iframe");
        const renderTo = config.renderTo;
        if (renderTo) {
            // Visible preview mode: fill the supplied container so full pages
            // can be seen.
            iframe.style.width = "100%";
            iframe.style.minHeight = "80vh";
            iframe.style.border = "0";
            iframe.style.display = "block";
        }
        else {
            // Hidden print mode: keep the iframe out of sight.
            iframe.style.position = "fixed";
            iframe.style.right = "0";
            iframe.style.bottom = "0";
            iframe.style.width = "1px";
            iframe.style.height = "1px";
            iframe.style.opacity = "0";
            iframe.style.border = "0";
        }
        let settled = false;
        const fail = (message) => {
            if (settled)
                return;
            settled = true;
            if (config.errorCallback) {
                config.errorCallback(message);
            }
            else {
                console.error("paged-with-floats printHTML:", message);
            }
            resolve(iframe);
        };
        // Strip every script from the source: the print frame paginates
        // with its own polyfill injection, and page scripts (analytics,
        // demo wiring, a nested polyfill tag) must not run here.
        const cleanMarkup = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
        let markup = cleanMarkup;
        if (config.title && !/<title>/i.test(markup)) {
            markup = markup.replace(/(<head[^>]*>)/i, `$1<title>${config.title}</title>`);
            if (!/<title>/i.test(markup)) {
                markup = `<title>${config.title}</title>` + markup;
            }
        }
        // Inject OUR polyfill loader (source scripts were stripped above)
        // and resolve the bundle base for the PDF emitter's fonts.
        const polyfillURL = new URL(config.polyfillURL || defaultPolyfillURL(), document.baseURI).href;
        const bundleBase = new URL(".", polyfillURL).href;
        const polyfillTag = `<script src="${polyfillURL}"></script>`;
        const settingsJSON = JSON.stringify(config.settings || {});
        // Injected before the polyfill so it applies to the auto-started
        // preview. The `after` hook marks completion deterministically —
        // listening for the "rendered" event from outside races polyfill
        // startup.
        const bootstrap = `<script>window.__PAGED_PRINT_ACTIVE = true;
window.__PAGED_BUNDLE_BASE = ${JSON.stringify(bundleBase)};
window.PagedConfig = {
	auto: true,
	settings: ${settingsJSON},
	after: function () {
		window.__PAGED_RENDER_DONE = true;
	}
};</script>`;
        // srcdoc gives the frame a real parsed document whose relative
        // URLs resolve against this page — document.write into an
        // about:blank iframe breaks both.
        iframe.srcdoc =
            bootstrap +
                (markup.includes("</body>")
                    ? markup.replace("</body>", `${polyfillTag}</body>`)
                    : markup + polyfillTag);
        iframe.onerror = () => fail("Print frame failed to load.");
        const startedAt = Date.now();
        const timer = window.setInterval(() => {
            const win = iframe.contentWindow;
            if (!win) {
                return;
            }
            if (Date.now() - startedAt > PRINT_TIMEOUT_MS) {
                window.clearInterval(timer);
                fail("Pagination did not complete in time.");
                return;
            }
            if (!win.__PAGED_PRINT_ACTIVE) {
                // Polyfill not yet executed; keep waiting.
                return;
            }
            if (win.__PAGED_RENDER_DONE) {
                window.clearInterval(timer);
                settled = true;
                try {
                    if (config.printCallback) {
                        config.printCallback(win);
                        resolve(iframe);
                    }
                    else {
                        win.focus();
                        win.print();
                        resolve(iframe);
                    }
                    if (!config.keepIframe && !renderTo) {
                        window.setTimeout(() => iframe.remove(), 0);
                    }
                }
                catch (error) {
                    fail(String(error));
                }
            }
        }, 100);
        if (renderTo) {
            renderTo.appendChild(iframe);
        }
        else {
            document.body.appendChild(iframe);
        }
    });
}

/**
 * Public paged-with-floats API.
 *
 * `paged-with-floats` exposes three helpers:
 *
 * 1. `printHTML(html, config)` — paginates `html` with paged-with-floats inside
 *    a hidden iframe and hands the window to `printCallback` (default: browser
 *    print dialog).
 *
 * 2. `renderHTML(html, container, options)` — paginates `html` and renders the
 *    result visibly inside `container`. No print dialog is opened.
 *
 * 3. `htmlToPDF(html, options)` — paginate and emit a real vector PDF in one
 *    call, with iframe cleanup handled internally.
 *
 * ```ts
 * import { htmlToPDF } from "paged-with-floats";
 *
 * const bytes = await htmlToPDF(htmlDoc, {
 *     title: "My document",
 *     metadata: { title: "My document" },
 * });
 * download(new Blob([bytes], { type: "application/pdf" }));
 * ```
 */
/**
 * Paginates `html` with paged-with-floats and renders the result visibly
 * inside `container`. No print dialog is opened and the iframe stays in the
 * supplied container.
 *
 * @param html - A complete HTML document string.
 * @param container - The element that will hold the pagination iframe.
 * @param options - Pagination options.
 * @returns The pagination iframe.
 */
async function renderHTML(html, container, options = {}) {
    return printHTML(html, {
        title: options.title,
        polyfillURL: options.polyfillURL,
        settings: options.settings,
        renderTo: container,
        errorCallback: options.errorCallback,
        printCallback: () => {
            // Visible preview: nothing to print.
        },
    });
}
/**
 * Paginates `html` with paged-with-floats and returns real vector PDF bytes —
 * no print dialog involved.
 *
 * @param html - A complete HTML document string.
 * @param options - Pagination and emission options.
 * @returns The PDF file bytes.
 */
async function htmlToPDF(html, options = {}) {
    const emitOptions = {
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
    const iframe = await printHTML(html, {
        title: options.title,
        polyfillURL: options.polyfillURL,
        settings: options.settings,
        keepIframe: true,
        printCallback: () => {
            // htmlToPDF emits the PDF programmatically; do not open the browser
            // print dialog.
        },
        errorCallback: (message) => {
            throw new Error(message);
        },
    });
    try {
        const win = iframe.contentWindow;
        return await emitPdfFromWindow(win, undefined, emitOptions);
    }
    finally {
        // Give microtasks spawned by emission a tick to unwind before the
        // window they measured against disappears.
        window.setTimeout(() => iframe.remove(), 0);
    }
}

export { htmlToPDF, printHTML, renderHTML };
//# sourceMappingURL=paged.js.map
