const TIMEOUT = 10000;

describe("page-floats-bottom-basic", () => {
	let page;
	beforeAll(async () => {
		page = await loadPage("page-floats/page-floats-bottom-basic/page-floats-bottom-basic.html");
		return page.rendered;
	}, TIMEOUT);

	afterAll(async () => {
		if (!DEBUG) {
			await page.close();
		}
	});

	it("should render 1 page", async () => {
		let pages = await page.$$eval(".pagedjs_page", (r) => r.length);
		expect(pages).toEqual(1);
	});

	it("should pin the figure to the bottom of the page content", async () => {
		let info = await page.$eval("[data-page-number='1']", (pg) => {
			let content = pg.querySelector(".pagedjs_page_content");
			let bottom = content.querySelector(".pagedjs_float_bottom");
			let fig = bottom.querySelector("#float-b");
			let contentRect = content.getBoundingClientRect();
			let figRect = fig ? fig.getBoundingClientRect() : null;
			let betaRect = document.getElementById("beta").getBoundingClientRect();
			let wrapper = content.querySelector(
				":scope > div:not(.pagedjs_float_top):not(.pagedjs_float_bottom)"
			);
			let spacer = wrapper
				? wrapper.querySelector(":scope > .pagedjs_float_spacer")
				: null;
			return {
				inContainer: !!fig,
				contentBottom: contentRect.bottom,
				figBottom: figRect ? figRect.bottom : null,
				figHeight: figRect ? figRect.height : null,
				betaBottom: betaRect.bottom,
				spacerHeight: spacer ? spacer.offsetHeight : null,
			};
		});
		expect(info.inContainer).toBe(true);
		expect(Math.abs(info.figBottom - info.contentBottom)).toBeLessThanOrEqual(3);
		expect(info.betaBottom).toBeLessThanOrEqual(
			info.figBottom - info.figHeight + 2
		);
		expect(info.spacerHeight).not.toBeNull();
		expect(Math.abs(info.spacerHeight - info.figHeight)).toBeLessThanOrEqual(3);
	});

	it("should keep the flow above the reserved space", async () => {
		let overlap = await page.$eval("[data-page-number='1']", (pg) => {
			let content = pg.querySelector(".pagedjs_page_content");
			let fig = content.querySelector(".pagedjs_float_bottom #float-b");
			let figTop = fig.getBoundingClientRect().top;
			let wrapper = content.querySelector(
				":scope > div:not(.pagedjs_float_top):not(.pagedjs_float_bottom)"
			);
			let range = document.createRange();
			range.selectNodeContents(wrapper);
			return range.getBoundingClientRect().bottom > figTop + 2;
		});
		expect(overlap).toBe(false);
	});
}
);
