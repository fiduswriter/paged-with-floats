import express from "express";
import { chromium } from "playwright-core";
const REPO = "/home/johannes/src/paged-test";
const PORT = 9965;
const app = express();
app.use(express.static(REPO));
const server = app.listen(PORT);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 140)));
await page.goto(`http://localhost:${PORT}/${process.argv[2]}`, { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
const state = await page.evaluate(() => ({
  pages: document.querySelectorAll(".paged_page").length,
  hasPolyfillInstance: typeof window.PagedPolyfill?.preview === "function",
  hasPagedNamespace: typeof window.Paged?.registerHandlers === "function",
}));
console.log(JSON.stringify({ ...state, pageErrors: errors }));
await browser.close();
server.close();
