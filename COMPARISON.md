# How paged-with-floats compares to Vivliostyle

[Vivliostyle](https://vivliostyle.org/) is the most complete open-source CSS
typesetting engine available today. This library does not attempt to match it,
and if its license terms work for you, you should generally prefer it.

## License

Vivliostyle.js is licensed under the
[GNU AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html) — a strong copyleft
license that also applies when the software is used to serve content over a
network: applications and services built on it must make their source
available under compatible terms. **paged-with-floats is licensed under the
GNU LGPL-3.0-or-later**, which permits using and embedding the library in
applications of any kind — including proprietary ones — provided the library
itself remains free and replaceable. If your project cannot accept AGPL
terms, that is the reason this library exists.

## Features

Vivliostyle implements substantially more of the CSS standards than this
library does. Its [Supported CSS Features](https://docs.vivliostyle.org/en/reference/supported-css-features/)
reference documents the full picture; the most significant gaps here are:

- **Page floats** — this library supports only `float-reference: page` with
  `float: top` / `float: bottom`, placed as stacked blocks with no text
  wrapping around them. Vivliostyle supports the complete module: all float
  values (`block-start`/`block-end`/`inline-start`/`inline-end`, `left`,
  `right`, corner combinations, `snap-block`), `float-reference: column` and
  `region`, the extended `clear` values, `float-min-wrap-block`, and real text
  wrapping around floats.
- **Multi-column layout** — this library paginates root-level and mid-flow
  multicol content (`column-count`/`columns`/`column-span: all`). Vivliostyle
  additionally covers balancing across fragmented pages, column-relative page
  floats and RTL column order.
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

## Documentation and CLI

For documentation of the CSS standards implemented here — which properties
and values exist, and how they are specified to behave — use Vivliostyle's
[Supported CSS Features](https://docs.vivliostyle.org/en/reference/supported-css-features/)
reference and the rest of the [Vivliostyle documentation](https://docs.vivliostyle.org/en/);
they are the most complete available documentation of practical CSS paged
media typesetting.

A hands-on overview to getting started with CSS typesetting is available in
the [Vivliostyle tutorials](https://vivliostyle.org/tutorials/) and the
[Vivliostyle samples](https://vivliostyle.org/samples/).

This library itself does not ship a command line tool. For rendering HTML/CSS
documents to PDF from the command line, [Vivliostyle CLI](https://github.com/vivliostyle/vivliostyle-cli)
([documentation](https://docs.vivliostyle.org/en/cli/)) is the most capable
open-source option; it works with any HTML/CSS document, independently of this
library.
