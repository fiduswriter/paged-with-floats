import express from "express";
import { chromium } from "playwright-core";
const REPO = "/home/johannes/src/paged-test";
const PORT = 9967;
const app = express();
app.use(express.static(REPO));
const server = app.listen(PORT);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/${process.argv[2]}`, { waitUntil: "networkidle" });
await page.waitForFunction(() => document.querySelectorAll(".paged_page").length > 0, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);
// Verify the renamed export is reachable through the demo UI's import
const hasApi = await page.evaluate(async () => {
  const mod = await import("/dist/paged.pdf.js");
  return {
    emitPdfFromPagedWindow: typeof mod.emitPdfFromPagedWindow,
    oldName: typeof mod.emitPdfFromPagedjsWindow,
    printHTML: typeof mod.printHTML,
    htmlToPDF: typeof mod.htmlToPDF,
  };
});
// Fire the actual PDF generation via the demo's own UI code path
const pdfStarted = await page.evaluate(() => {
  const btn = document.querySelector("#download-pdf, .download-pdf, button[data-download]");
  return btn ? btn.id || btn.className : null;
});
console.log(JSON.stringify({ hasApi, pdfStarted, pageErrors: errors }, null, 1));
await browser.close();
server.close();
