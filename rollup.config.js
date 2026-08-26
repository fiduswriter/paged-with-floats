import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import license from "rollup-plugin-license";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const plugins = [
	typescript({
		tsconfig: "./tsconfig.rollup.json",
		exclude: ["src/**/*.test.ts"],
	}),
	nodeResolve({
		extensions: [".cjs", ".mjs", ".js"],
	}),
	commonjs({
		include: "node_modules/**",
	}),
	json(),
	license({
		banner:
			" @license paged-with-floats v<%= pkg.version %>\n" +
			"\n" +
			" Modifications and additions in this build are Copyright (C) 2026 Johannes Wilm\n" +
			" and licensed under the GNU Lesser General Public License, version 3 or later\n" +
			" (LGPL-3.0-or-later). See COPYING.LESSER and LICENSE.md for details.\n" +
			"\n" +
			" Contains substantial portions of Paged.js, licensed under the MIT License:\n" +
			" Copyright (c) 2018 Adam Hyde. This notice is retained as required by that\n" +
			" license. See LICENSE.md for the full license text.",
	}),
];

export default [
	// browser-friendly UMD build
	{
		input: "./src/index.ts",
		output: {
			name: "Paged",
			file: pkg.browser,
			format: "umd",
		},
		plugins: plugins,
	},

	{
		input: "./src/index.ts",
		output: {
			name: "PagedModule",
			file: "./dist/paged.esm.js",
			format: "es",
		},
		plugins: plugins,
	},

	{
		input: "./src/polyfill/polyfill.ts",
		output: {
			name: "PagedPolyfill",
			file: "./dist/paged.polyfill.js",
			format: "umd",
		},
		plugins: plugins,
	},

	// print + PDF export APIs (ESM only; heavy deps stay out of the core)
	{
		input: "./src/paged.pdf.ts",
		output: {
			file: "./dist/paged.pdf.js",
			format: "es",
		},
		plugins: plugins,
	},

	// minified
	{
		input: "./src/index.ts",
		output: {
			name: "PagedModule",
			file: "./dist/paged.min.js",
			format: "umd",
		},
		plugins: [plugins, terser()],
	},
	{
		input: "./src/polyfill/polyfill.ts",
		output: {
			name: "PagedPolyfill",
			file: "./dist/paged.polyfill.min.js",
			format: "umd",
		},
		plugins: [plugins, terser()],
	},
	{
		input: "./src/paged.pdf.ts",
		output: {
			file: "./dist/paged.pdf.min.js",
			format: "es",
		},
		plugins: [plugins, terser()],
	},
];
