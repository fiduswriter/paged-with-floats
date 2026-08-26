const TIMEOUT = 30000;

describe("page-floats-multicol", () => {
	let page;
	beforeAll(async () => {
		page = await loadPage("page-floats/page-floats-multicol/page-floats-multicol.html");
		return page.rendered;
	}, TIMEOUT);

	afterAll(async () => {
		if (!DEBUG) {
			await page.close();
		}
	});

	it("should render more than one page", async () => {
		let pages = await page.$$eval(".paged_page", (r) => r.length);
		expect(pages).toBeGreaterThan(1);
	});

	it("should keep exactly one rendered copy of each page float", async () => {
		let count = await page.$$eval("[data-page-float]", (r) => r.length);
		expect(count).toEqual(2);
	});

	it("should place every float inside its page's top float container", async () => {
		let info = await page.evaluate(() => {
			const floats = Array.from(document.querySelectorAll("[data-page-float]"));
			return floats.map((f) => {
				const pg = f.closest(".paged_page");
				const wrap = pg.querySelector(
					".paged_page_content > div:not(.paged_float_top):not(.paged_float_bottom)"
				);
				return {
					id: f.id,
					inTopContainer: !!f.parentElement.classList.contains("paged_float_top"),
					insideWrapper: !!(wrap && wrap.contains(f)),
					pageNumber: pg ? parseInt(pg.dataset.pageNumber, 10) : null,
				};
			});
		});
		info.forEach((d) => {
			expect(d.inTopContainer).toBe(true);
			expect(d.insideWrapper).toBe(false);
		});
		// The first float anchors early in the document.
		let first = info.find((d) => d.id === "float-a");
		expect(first.pageNumber).toEqual(1);
	});

	it("should let top floats span both columns", async () => {
		let widths = await page.evaluate(() => {
			const wrap = document.querySelector(
				"[data-page-number='1'] .paged_page_content > div:not(.paged_float_top):not(.paged_float_bottom)"
			);
			const fig = document.querySelector("#float-a");
			if (!wrap || !fig) {
				return { columnWidth: null, figureWidth: null };
			}
			const st = getComputedStyle(wrap);
			const count = parseInt(st.columnCount) || 1;
			let gap = parseFloat(st.columnGap);
			if (Number.isNaN(gap)) gap = parseFloat(st.fontSize) || 0;
			return {
				columnCount: count,
				columnWidth: ((wrap.clientWidth || 0) - (count - 1) * gap) / count,
				figureWidth: fig.getBoundingClientRect().width,
			};
		});
		expect(widths.columnCount).toEqual(2);
		expect(widths.figureWidth).toBeGreaterThan(widths.columnWidth);
	});

	it("should render no float copy inside the flow wrapper", async () => {
		let leaked = await page.$$eval(
			".paged_page_content > div:not(.paged_float_top):not(.paged_float-bottom) [data-page-float]",
			(r) => r.length
		);
		expect(leaked).toEqual(0);
	});

	it("should leave no content spilling off any page", async () => {
		let spills = await page.$$eval(".paged_page", (pages) =>
			pages.map((pg) => {
				const wrap = pg.querySelector(
					".paged_page_content > div:not(.paged_float_top):not(.paged_float_bottom)"
				);
				return wrap
					? Math.max(
						wrap.scrollWidth - wrap.clientWidth,
						wrap.scrollHeight - wrap.clientHeight
					)
					: 0;
			})
		);
		spills.forEach((s) => expect(s).toBeLessThanOrEqual(2));
	});

	it("should keep the deferred float and trailing paragraph in order", async () => {
		// The second float defers to its own final page (following text
		// continues on the page it appeared on), so assert content integrity:
		// both the float and the trailing paragraph survive, in order.
		let texts = await page.$$eval(".paged_page", (pages) =>
			pages.map((p) => p.textContent)
		);
		let floatIdx = texts.findIndex((t) => t.includes("FIG-B-PLACEHOLDER"));
		let spillIdx = texts.findIndex((t) =>
			t.includes("full up beyond capacity")
		);
		expect(floatIdx).toBeGreaterThanOrEqual(0);
		expect(spillIdx).toBeGreaterThanOrEqual(0);
		expect(spillIdx).toBeLessThanOrEqual(floatIdx);
	});
});
