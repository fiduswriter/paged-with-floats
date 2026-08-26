# Changelog

## 0.7.0 (2026-08-26)

### Added

- **CSS multi-column support**: root-level (`body { column-count }`) and
  mid-flow blocks (`columns: 2`) fragment across pages with true column
  filling; `column-gap`, `column-rule-*` and `column-span: all` honored.
  `column-fill: balance` is applied to final fragments via a post-render
  rebalance pass. Nested multicol degrades to one column with a warning.
- **TypeScript throughout** (strict), shipped `.d.ts`; `main`/`exports`
  now point at built artifacts, `src/` ships as TypeScript reference.
- **Text-measurement backends**, selectable via
  `settings.textMeasurement`:
  - `"dom"` (default): legacy DOM word-walker; fastest in benchmarks.
  - `"pretext"`: predicted breaking via
    [@chenglou/pretext](https://github.com/chenglou/pretext) with
    per-break verification against real DOM rects and automatic legacy
    fallback; the whole document's texts are prepared once after fonts
    load, continuations reuse the prepared objects.
  - `"pretext"` + `verifyTextPrediction: false`: pure arithmetic breaks;
    audit output afterwards via `flow.overflowViolations` /
    `validateRenderedPages()`.
- **Print & PDF export** (`paged-with-floats/pdf`):
  - `printHTML(html, config)` — vivliostyle-print-compatible hidden-iframe
    pagination + printing.
  - `emitPdfFromPagedjsWindow(win)` — vivliostyle-pdf-style vector PDF
    emission (embedded subsetted fonts incl. WOFF/WOFF2, link
    annotations, outline, metadata) for pagedjs-paginated windows; does
    the same job as vivliostyle-pdf's `emitPdfFromVivliostyleWindow`.
  - `htmlToPDF(html, options)` — both steps composed into one call.
- **Performance**: frame-budgeted rendering (`settings.renderFrameBudget`,
  default 12 ms) — Moby Dick dom-mode pagination dropped ~44% (15.9 s →
  8.9 s); dirty-flag bounds caching in Layout.
- **Diagnostics**: `window.__pagedDomOps` DOM-read counters,
  `window.__pagedPredictStats` prediction counters, gated by
  `__PAGED_DEBUG` / `settings.debugDomOps`.
- Project Gutenberg benchmark/parity fixtures under
  `specs/fixtures/gutenberg/` (not part of the npm package).

### Changed

- **Breaking (CSS/DOM surface)**: all generated class names,
  custom properties, data attributes and element ids now use a `paged_` /
  `paged-` / `--paged-` prefix instead of `pagedjs_*` / `--pagedjs-*` /
  `data-pagedjs-*` (e.g. `.pagedjs_page` → `.paged_page`,
  `--pagedjs-width` → `--paged-width`). Debug globals renamed accordingly:
  `__PAGEDJS_DEBUG` → `__PAGED_DEBUG`. The JavaScript API globals
  (`window.Paged`, `window.PagedConfig`, `window.PagedPolyfill`) are
  unchanged.
- PDF render-baseline specs skip automatically when Ghostscript is not
  installed instead of failing; Docker baselines were regenerated on free
  fonts only (Microsoft core fonts removed from the image; spec fixtures'
  MS font names alias to metric-compatible Liberation families).
- Programmatic layout failures are reported with a warning instead of
  stopping silently.

### Internal

- Full codebase converted to strict TypeScript; eslint switched to
  typescript-eslint; jest transforms TS via babel; rollup builds through
  `@rollup/plugin-typescript`. Behavior verified against the pre-conversion
  baseline across the complete spec suite.
