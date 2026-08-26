/**
 * Shared demo helpers.
 *
 * - Injects `content-visibility: auto` for rendered pages so appending
 *   page N does not re-layout pages 1..N-1 — long books stay interactive
 *   while paginating.
 * - `DemoUI.addDownloadButton()`: adds a fixed "Download PDF" button that
 *   paginates this page's source in a hidden frame and saves a real
 *   vector PDF (via dist/paged.pdf.js).
 */
(() => {
	const style = document.createElement("style");
	style.textContent =
		".paged_page{content-visibility:auto;contain-intrinsic-size:auto 1400px;}";
	document.head.appendChild(style);

	const POLYFILL_TAG_RE =
		/<script[^>]+src="[^"]*paged\.polyfill\.js"[^>]*>\s*<\/script>\s*/gi;

	async function getSource() {
		if (window.__DEMO_SOURCE) {
			return window.__DEMO_SOURCE;
		}
		// Fetch the original file: serializing the live DOM would capture
		// the paginator's generated page structure instead of the source.
		const response = await fetch(location.href);
		let text = await response.text();
		// The hidden print frame loads the polyfill itself.
		text = text.replace(POLYFILL_TAG_RE, "");
		window.__DEMO_SOURCE = text;
		return text;
	}

	function ensureToolbar() {
		let bar = document.getElementById("paged-demo-toolbar");
		if (!bar) {
			bar = document.createElement("div");
			bar.id = "paged-demo-toolbar";
			bar.style.cssText =
				"position:fixed;top:12px;right:12px;z-index:9999;display:flex;gap:8px;" +
				"font-family:system-ui,sans-serif;";
			document.body.appendChild(bar);
		}
		return bar;
	}

	function makeButton(label) {
		const b = document.createElement("button");
		b.textContent = label;
		b.style.cssText =
			"padding:8px 14px;border:1px solid #333;border-radius:6px;background:#fff;" +
			"cursor:pointer;font-size:14px;box-shadow:0 1px 4px rgba(0,0,0,.25);";
		return b;
	}

	function saveBytes(bytes, filename) {
		const blob = new Blob([bytes], { type: "application/pdf" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	}

	/**
	 * Paginates arbitrary source HTML in a hidden frame and returns real
	 * vector PDF bytes.
	 */
	function bundleBase() {
		const tag = document.querySelector('script[src*="paged.polyfill"]');
		if (tag) {
			return new URL(".", tag.src).href;
		}
		return new URL("./", location.href).href;
	}

	async function generatePdf(
		source,
		{ title = document.title, onProgress } = {},
	) {
		const { htmlToPDF, emitPdfFromPagedjsWindow, printHTML } =
			await import(new URL("paged.pdf.js", bundleBase()).href);
		if (!onProgress) {
			return htmlToPDF(source.replace(POLYFILL_TAG_RE, ""), {
				title,
				polyfillURL: new URL(
					"paged.polyfill.js",
					bundleBase(),
				).href,
				metadata: { title },
			});
		}
		// With progress reporting: keep the print frame around and feed
		// emitter status to the caller while pages are emitted.
		let iframe;
		const bytes = await new Promise((resolve, reject) => {
			printHTML(source.replace(POLYFILL_TAG_RE, ""), {
				title,
				polyfillURL: new URL("paged.polyfill.js", bundleBase()).href,
				keepIframe: true,
				errorCallback: reject,
				printCallback: (win) => {
					emitPdfFromPagedjsWindow(win, onProgress, {
						sourceHtml: source.replace(POLYFILL_TAG_RE, ""),
						metadata: { title },
						baseUrl: bundleBase(),
					})
						.then(resolve)
						.catch(reject)
						.finally(() => iframe?.remove());
				},
			}).then((frame) => (iframe = frame));
		});
		return bytes;
	}

	const DemoUI = {
		generatePdf,
		/**
		 * Adds a "Download PDF" button. The page's own source (fetched from
		 * the server) is re-paginated in a hidden frame and emitted as PDF.
		 */
		addDownloadButton({
			label = "Download PDF",
			filename,
			title = document.title,
		} = {}) {
			const bar = ensureToolbar();
			const button = makeButton(label);
			button.id = "paged-download-pdf";
			bar.appendChild(button);
			button.addEventListener("click", async () => {
				const original = label;
				button.disabled = true;
				button.textContent = "Generating PDF…";
				try {
					const source = await getSource();
					const bytes = await generatePdf(source, {
						title,
						onProgress: (message) => {
							button.textContent = message;
						},
					});
					saveBytes(
						bytes,
						filename ||
							(location.pathname.split("/").pop() || "demo"
							).replace(/\.html$/, "") + ".pdf",
					);
				} catch (error) {
					alert("PDF generation failed: " + error.message);
				} finally {
					button.disabled = false;
					button.textContent = original;
				}
			});
		},

		getSource,
		saveBytes,
		makeButton,
		ensureToolbar,

		/** Regex removing a bundled polyfill script tag from source HTML. */
		POLYFILL_TAG_RE,
	};

	window.DemoUI = DemoUI;
})();
