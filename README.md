<img style="display: block; margin: 3em auto;" src="assets/logo.svg" alt="paged-with-floats — a block floating above a paginated page"/>

[![CI](https://github.com/johanneswilm/paged-with-floats/actions/workflows/ci.yml/badge.svg)](https://github.com/johanneswilm/paged-with-floats/actions/workflows/ci.yml)

paged-with-floats
===========

**paged-with-floats** is a fork of [Paged.js](https://github.com/pagedjs/pagedjs),
an open-source library to display paginated content in the browser and to
generate print books using web technology. It is maintained by **Johannes Wilm**
and carries all of Paged.js's capabilities — a set of handlers for CSS
transformations and fragmented layout which polyfill the
[Paged Media](https://www.w3.org/TR/css-page-3/) and
[Generated Content](https://www.w3.org/TR/css-gcpm-3/) CSS modules, along with
hooks to create new handlers for custom properties.

## What this fork adds

On top of Paged.js, this fork implements support for
[CSS Page Floats](https://drafts.csswg.org/css-page-floats/):

```css
figure {
	float-reference: page;
	float: top; /* or bottom */
}
```

Elements declared this way are pulled out of the normal flow and placed at the
top or bottom edge of the page on which their anchor appears. If there is not
enough room left on the page, the float defers to the next page while
following content continues to fill the current one, as specified by the CSS
Page Floats module.

## How this library compares to Vivliostyle

[Vivliostyle](https://vivliostyle.org/) is the most complete open-source CSS
typesetting engine available today. This library does not attempt to match it,
and if its license terms work for you, you should generally prefer it.

**License.** Vivliostyle.js is licensed under the
[GNU AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) — a strong copyleft
license that also applies when the software is used to serve content over a
network: applications and services built on it must make their source
available under compatible terms. **paged-with-floats is licensed under the
GNU LGPL-3.0-or-later**, which permits using and embedding the library in
applications of any kind — including proprietary ones — provided the library
itself remains free and replaceable. If your project cannot accept AGPL
terms, that is the reason this fork exists.

**Features.** Vivliostyle implements substantially more of the CSS standards
than this library does. Its [Supported CSS Features](https://docs.vivliostyle.org/en/reference/supported-css-features/)
reference documents the full picture; the most significant gaps here are:

- **Page floats** — this library supports only `float-reference: page` with
  `float: top` / `float: bottom`, placed as stacked blocks with no text
  wrapping around them. Vivliostyle supports the complete module: all float
  values (`block-start`/`block-end`/`inline-start`/`inline-end`, `left`,
  `right`, corner combinations, `snap-block`), `float-reference: column` and
  `region`, the extended `clear` values, `float-min-wrap-block`, and real text
  wrapping around floats.
- **Multi-column layout** — Vivliostyle implements root multi-column pages
  with column fragmentation; this library does not paginate multi-column
  content within a page.
- **Writing modes** — vertical writing and RTL layouts (CSS Writing Modes 3)
  are supported by Vivliostyle; this library assumes horizontal top-to-bottom
  writing.
- **Fragmentation fidelity** — Vivliostyle runs its own layout engine;
  this library builds on browser layout measurement heuristics, so edge cases
  around `break-inside`, tables and nested structures are handled less robustly.
- **Footnotes and GCPM** — footnote handling here is simpler; Vivliostyle
  additionally supports `running()`/`element()` running elements, `leader()`,
  `initial-letter`, EPUB adaptive layout and more.

In short: use **Vivliostyle** for maximum standards coverage and typesetting
fidelity; use **paged-with-floats** when the LGPL license is required and the
feature set described above is sufficient for your needs.

For documentation of the CSS standards implemented here — which properties
and values exist, and how they are specified to behave — use Vivliostyle's
[Supported CSS Features](https://docs.vivliostyle.org/en/reference/supported-css-features/)
reference and the rest of the [Vivliostyle documentation](https://docs.vivliostyle.org/en/);
they are the most complete available documentation of practical CSS paged
media typesetting.

A hands-on overview to getting started with CSS typesetting is available in
the [Vivliostyle tutorials](https://vivliostyle.org/tutorials/) and the
[Vivliostyle samples](https://vivliostyle.org/samples/).

## NPM Module
```sh
$ npm install paged-with-floats
```

```js
import { Previewer } from 'paged-with-floats';

let paged = new Previewer();
let flow = paged.preview(DOMContent, ["path/to/css/file.css"], document.body).then((flow) => {
	console.log("Rendered", flow.total, "pages.");
})
```

## Polyfill

Add the the `paged.polyfill.js` script to replace all `@page` css and render the html page with the Paged Media styles applied:

```html
<script src="https://unpkg.com/paged-with-floats/dist/paged.polyfill.js"></script>
```

By default the polyfill will run automatically as soon as the DOM is ready.
However, you can add an async `before` function or return a Promise to delay the polyfill starting.

```html
<script>
	window.PagedConfig = {
		before: () => {
			return new Promise((resolve, reject) => {
				setTimeout(() => { resolve() }, 1000);
			})
		},
		after: (flow) => { console.log("after", flow) },
	};
</script>
```

Otherwise you can disable `auto` running the previewer and call `window.PagedPolyfill.preview();`
whenever you want to start.

```html
<script>
	window.PagedConfig = {
		auto: false,
		after: (flow) => { console.log("after", flow) },
	};

	setTimeout(() => {
		window.PagedPolyfill.preview();
	}, 1000);
</script>
```

## Chunker
Chunks up a document into paged media flows and applies print classes.

For paginated examples of the CSS standards involved, see the
[Vivliostyle samples](https://vivliostyle.org/samples/).

## Polisher
Converts `@page` css to classes, and applies counters and content.

### CLI

This library itself does not ship a command line tool. For rendering HTML/CSS
documents to PDF from the command line, [Vivliostyle CLI](https://github.com/vivliostyle/vivliostyle-cli)
([documentation](https://docs.vivliostyle.org/en/cli/)) is the most capable
open-source option; it works with any HTML/CSS document, independently of this
library.

## Module

Modules are groups of handlers for that apply the layout and styles of a CSS module, such as Generated Content or Page Floats.

New handlers can be registered from `import { registerHandlers } from 'paged-with-floats'` or by calling `Paged.registerHandlers` on an html page.

```html
<script src="https://unpkg.com/paged-with-floats/dist/paged.polyfill.js"></script>
<script>
	class MyHandler extends Paged.Handler {
		constructor(chunker, polisher, caller) {
			super(chunker, polisher, caller);
		}

		afterPageLayout(pageFragment, page) {
			console.log(pageFragment);
		}
	}
	Paged.registerHandlers(MyHandler);
</script>
```

Handlers have methods that correspond to the hooks for the parsing, layout and rendering of the Chunker and Polisher. Returning a promise or `async` function from a method in a handler will complete that task before continuing with the other registered methods for that hook.

```js
// Previewer
beforePreview(content, renderTo)
afterPreview(pages)

// Chunker
beforeParsed(content)
filter(content)
afterParsed(parsed)
beforePageLayout(page)
onPageLayout(pageWrapper, breakToken, layout);
afterPageLayout(pageElement, page, breakToken)
finalizePage(pageElement, page, breakToken)
afterRendered(pages)

// Polisher
beforeTreeParse(text, sheet)
beforeTreeWalk(ast)
afterTreeWalk(ast, sheet)
onUrl(urlNode)
onAtPage(atPageNode)
onRule(ruleNode)
onDeclaration(declarationNode, ruleNode)
onContent(contentNode, declarationNode, ruleNode)

// Layout
layoutNode(node)
renderNode(node, sourceNode, layout)
onOverflow(overflow, rendered, bounds)
onBreakToken(breakToken, overflow, rendered)
afterOverflowRemoved(removed, rendered)
beforeRenderResult(breakToken, pageWrapper)
```

## How paged-with-floats processes content

Chunker.flow()\
└── Chunker.render() -> Looping through all pages\
└──── Chunker.layout*() -> Handles overflowing pages, adding new ones\
└────── Page.layout() -> Creates new Layout and waits for new Breaktoken\
└──────── Layout.renderTo() -> Iterates through nodes\
└────────── Layout.findBreakToken() -> Tries to find overflow/breaktoken

## Setup
Install dependencies
```sh
$ npm install
```

## Development
Run the local dev-server with livereload and autocompile on [http://localhost:9090/](http://localhost:9090/)
```sh
$ npm start
```

## Deployment
Build the `dist` output
```sh
$ npm run build
```

Compile the `lib` output
```sh
$ npm run compile
```

Generate legacy builds with polyfills included
```sh
$ npm run legacy
```

## Testing

Testing uses [Jest](https://facebook.github.io/jest/en/) but is split into Tests and Specs.

### Tests

Unit tests for Chunker and Polisher methods are run in node using JSDOM.

```bash
npm test
```

### Specs

Specs run a html file in Chrome (using playwright) to test against CSS specifications.

There are two tiers:

**DOM specs** (`npm run specs-dom`) assert rendered page structure and run
anywhere — no extra system dependencies. This includes all of the page floats
tests as well as a growing set of the older suites. CI runs these on every
push.

```bash
npm run specs-dom
```

**PDF render-baseline specs** (`npm run specs`) additionally output a pdf and
compare pages (one at a time) against stored baseline images. Pixel
comparisons only stay meaningful when Chromium, fonts, freetype and
Ghostscript are pinned, so these are best run inside the Docker container
(see below), which provides that environment:

```bash
npm run docker-specs
```

To regenerate the baselines after an intentional rendering change:

```bash
npm run docker-update-specs
```

If you prefer to run the PDF comparison suite outside Docker, you need a
local Ghostscript for your system according to https://www.npmjs.com/package/ghostscript4js#prerequisites

For Mac you can install it with

```bash
brew install ghostscript
```

For Debian you can install it with

```bash
sudo apt-get install ghostscript
sudo apt-get install libgs-dev
```

Now you can install the `ghostscript4js` library. For Linux you can optionally pass the location ghostscript was installed to in `GS4JS_HOME`.

```bash
GS4JS_HOME="/usr/lib/$(gcc -dumpmachine)" npm install ghostscript4js
```

To test the pdf output of specs, you'll need to build the library locally.

```bash
npm run build
```

Then run the jest tests in puppeteer.

```bash
npm run specs
```

To debug the results of a test in a browser you can add `NODE_ENV=debug`

```bash
NODE_ENV=debug npm run specs
```

To update the stored pdf images you can run

```bash
npm run specs -- --updateSnapshot
```

### Docker

The Docker image exists for one purpose: it pins Chromium, the font set,
freetype behavior and Ghostscript so that the PDF render-baseline comparisons
stay deterministic across machines. It is used by `npm run docker-specs`,
`npm run docker-update-specs` and by the `render-specs` job in CI. The image
can also serve as a development server, but Docker is not required for
development or publishing.

The render-baseline jobs build the image themselves; to build it manually run

```bash
docker build -t paged-with-floats .
```

By default the container will run the development server with `npm start`

```bash
docker run -it -p 9090:9090 paged-with-floats
```

## Acknowledgments

This project exists because of the extraordinary work of the Paged.js
development team, whose code forms the foundation that this fork builds upon.
We gratefully acknowledge:

**Fred Chasen**, the principal author and architect of Paged.js. Fred wrote the
overwhelming majority of the codebase — several hundred commits covering the
chunker, the fragmentation and overflow engine, the CSS polisher, the page
template system, the handler and hooks architecture, and most of the feature
modules, including footnotes, string-sets, target-counters, generated content,
breaks and splits. Virtually every line of pagination machinery in this
repository originates in his work, and this fork would not exist without it.

**Julien Taquet**, long-time core developer, who contributed continuously
across the whole project — typography and print CSS handling, page margin
boxes, named pages, bleed and marks support, and years of day-to-day
maintenance, testing and refinement of the rendering pipeline.

**Julie Blanc**, long-time core developer and designer, whose contributions
shaped the CSS processing side of the library — from `@page` conversion and
margin boxes to the visual design of paginated output — along with extensive
testing and documentation of print behaviors.

**Guillaume Grossetie**, one of the most prolific external contributors, whose
many commits improved the chunker and layout engine, break handling, and
numerous edge cases throughout the codebase.

**Nellie McKesson**, whose early contributions helped carry the project through
its formative period.

With additional substantial contributions from:

Martin Heini,
Thomas Parisot,
Antonin Libotte,
Erik Schilling,
Marius Dumitru Florea,
Nigel Cunningham,
William Muir,
Martin Olsson,
Nathan Schulzke,
Gijs de Heij,

and further fixes and improvements from:

Andrey Kislyuk,
Angela Liu,
Chris Beaven,
Edoardo Tona,
JenniferVdL,
Jonathan Boarman,
Lucas Willems,
Malte Rohde,
Mauro Bieg,
Nicholas Wylie,
Patrick Kranz,
Rob Mayer,
Sam Ruby,
Stéphane Elbaron,
Talbi Youssef,
Urban Suppiger,
Yann Trividic,
Antoine Fauchié,
mb21,
wangfengming,
wenbei421.

Thank you — every page rendered by this library rests on your work.

## License

Everything generated as part of **paged-with-floats** — all modifications and
additions made in this fork, including the complete page floats
implementation — is

> Copyright (C) 2026 Johannes Wilm

and licensed under the **GNU Lesser General Public License, version 3 or later
(LGPL-3.0-or-later)**. The full license texts are included in this repository
as [`COPYING.LESSER`](./COPYING.LESSER) (LGPL-3.0) and [`COPYING`](./COPYING)
(GPL-3.0, which the LGPL incorporates); see also
<https://www.gnu.org/licenses/>.

The pre-existing Paged.js code that this fork builds upon remains covered by
its original **MIT license**, whose copyright and permission notice is
reproduced verbatim in [`LICENSE.md`](./LICENSE.md), as required by that
license, and accompanies every distributed build in the file banner.
