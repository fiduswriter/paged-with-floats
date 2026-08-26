// Ships the bundled PDF fallback fonts next to the built bundles.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from =
	process.env.PDF_FONTS_SRC ||
	join(root, "..", "fiduswriter", "vivliostyle-pdf", "public", "fonts");
const to = join(root, "dist", "fonts");

mkdirSync(to, { recursive: true });
const fonts = [
	"LibertinusSerif-Regular.ttf",
	"LibertinusSerif-Bold.ttf",
	"LibertinusSerif-Italic.ttf",
	"LibertinusSerif-BoldItalic.ttf",
	"JetBrainsMono-Regular.ttf",
	"JetBrainsMono-Bold.ttf",
];
let copied = 0;
for (const f of fonts) {
	try {
		copyFileSync(join(from, f), join(to, f));
		copied++;
	} catch {
		// Source tree unavailable (e.g. CI): export proceeds with the
		// document's own @font-face fonts and skips unavailable fallbacks.
	}
}
console.log(`pdf fonts: ${copied}/${fonts.length} copied to dist/fonts`);
