import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";
import license from "rollup-plugin-license";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("./package.json");

const plugins = [
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
		input: pkg.main,
		output: {
			name: "Paged",
			file: pkg.browser,
			format: "umd",
		},
		plugins: plugins,
	},

	{
		input: pkg.main,
		output: {
			name: "PagedModule",
			file: "./dist/paged.esm.js",
			format: "es",
		},
		plugins: plugins,
	},

	{
		input: "./src/polyfill/polyfill.js",
		output: {
			name: "PagedPolyfill",
			file: "./dist/paged.polyfill.js",
			format: "umd",
		},
		plugins: plugins,
	},

	// minified
	{
		input: pkg.main,
		output: {
			name: "PagedModule",
			file: "./dist/paged.min.js",
			format: "umd",
		},
		plugins: [plugins, terser()],
	},
	{
		input: "./src/polyfill/polyfill.js",
		output: {
			name: "PagedPolyfill",
			file: "./dist/paged.polyfill.min.js",
			format: "umd",
		},
		plugins: [plugins, terser()],
	},
];
