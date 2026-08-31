# MIT-licensed upstream code tracking

This document tracks which files in `src/` still contain code derived from the
original MIT-licensed Paged.js project, so the remaining upstream code can be
replaced incrementally.

## Methodology

- Upstream merge-base (last common commit with pagedjs/pagedjs): `6b0ff80`
  ("Merge pull request #315 from wamuir/bugfix-marginalia").
- Each current source file is compared against its counterpart at the merge-base.
- For files Git detects as renames (e.g. `R081`), the percentage is Git's estimate
  of how much of the upstream file is unchanged in the current file.
- Retained upstream lines = `upstream_lines × similarity`, capped at current file size.
- New files count as 0% upstream.

## Progress summary

- Current `src/` lines: **22,173**
- Estimated upstream-derived lines remaining: **7,943**
- Share of current source under upstream MIT origin: **35.8%**

## File-by-file breakdown

| File | Status | Current lines | Upstream lines | Retained upstream lines | % of file |
|------|--------|--------------:|---------------:|------------------------:|----------:|
| `src/modules/paged-media/atpage.ts` | rename 81% | 2877 | 2657 | 2152 | 74.8% |
| `src/utils/dom.ts` | rename 68% | 1580 | 1381 | 939 | 59.4% |
| `src/modules/paged-media/footnotes.ts` | rename 63% | 956 | 810 | 510 | 53.4% |
| `src/modules/paged-media/counters.ts` | rename 74% | 564 | 519 | 384 | 68.1% |
| `src/chunker/chunker.ts` | rename 40% | 1202 | 830 | 332 | 27.6% |
| `src/chunker/layout.ts` | rename 18% | 6279 | 1760 | 317 | 5.0% |
| `src/polisher/sheet.ts` | rename 76% | 397 | 373 | 283 | 71.4% |
| `src/polisher/base.ts` | rename 32% | 799 | 710 | 227 | 28.4% |
| `src/modules/generated-content/running-headers.ts` | rename 72% | 300 | 257 | 185 | 61.7% |
| `src/modules/generated-content/target-counters.ts` | rename 81% | 268 | 224 | 181 | 67.7% |
| `src/modules/paged-media/breaks.ts` | rename 80% | 250 | 223 | 178 | 71.4% |
| `src/modules/generated-content/string-sets.ts` | rename 72% | 253 | 218 | 157 | 62.0% |
| `src/utils/utils.ts` | rename 56% | 299 | 273 | 156 | 52.0% |
| `src/chunker/page.ts` | rename 36% | 682 | 385 | 139 | 20.3% |
| `src/polisher/sizes.ts` | rename 83% | 184 | 166 | 138 | 74.9% |
| `src/modules/generated-content/target-text.ts` | rename 73% | 232 | 185 | 135 | 58.2% |
| `src/modules/filters/undisplayed.ts` | rename 75% | 191 | 170 | 128 | 66.8% |
| `src/modules/filters/whitespace.ts` | rename 89% | 106 | 105 | 93 | 88.2% |
| `src/modules/paged-media/page-counter-increment.ts` | rename 72% | 154 | 129 | 93 | 60.3% |
| `src/polyfill/previewer.ts` | rename 41% | 340 | 214 | 88 | 25.8% |
| `src/polisher/polisher.ts` | rename 56% | 217 | 151 | 86 | 39.7% |
| `src/modules/paged-media/print-media.ts` | rename 85% | 103 | 101 | 86 | 83.3% |
| `src/chunker/parser.ts` | rename 74% | 106 | 113 | 84 | 78.9% |
| `src/chunker/breaktoken.ts` | rename 73% | 115 | 114 | 83 | 72.4% |
| `src/modules/paged-media/nth-of-type.ts` | rename 81% | 109 | 99 | 80 | 73.6% |
| `src/utils/queue.ts` | rename 28% | 288 | 248 | 72 | 25.0% |
| `src/modules/paged-media/splits.ts` | rename 74% | 100 | 97 | 72 | 71.8% |
| `src/modules/paged-media/position-fixed.ts` | rename 69% | 112 | 96 | 66 | 59.1% |
| `src/polyfill/polyfill.ts` | rename 62% | 108 | 99 | 61 | 56.8% |
| `src/modules/paged-media/following.ts` | rename 74% | 92 | 82 | 61 | 66.0% |
| `src/modules/paged-media/lists.ts` | rename 76% | 71 | 69 | 52 | 73.9% |
| `src/utils/handlers.ts` | rename 64% | 63 | 61 | 39 | 62.0% |
| `src/utils/hook.ts` | rename 39% | 99 | 91 | 35 | 35.8% |
| `src/modules/handler.ts` | rename 56% | 63 | 55 | 31 | 49.8% |
| `src/utils/css.ts` | rename 91% | 33 | 33 | 30 | 91.0% |
| `src/modules/filters/scripts.ts` | rename 80% | 35 | 34 | 27 | 77.7% |
| `src/modules/filters/comments.ts` | rename 81% | 34 | 33 | 27 | 78.6% |
| `src/chunker/renderresult.ts` | rename 48% | 45 | 53 | 25 | 56.5% |
| `src/chunker/overflow.ts` | rename 39% | 75 | 57 | 22 | 29.6% |
| `src/index.ts` | rename 100% | 20 | 20 | 20 | 100.0% |
| `src/modules/paged-media/index.ts` | rename 72% | 33 | 26 | 19 | 56.7% |
| `src/chunker/chunker.test.js` | modified | 18 | 18 | 16 | 88.9% |
| `src/utils/request.ts` | rename 39% | 44 | 38 | 15 | 33.7% |
| `src/modules/generated-content/index.ts` | rename 79% | 13 | 12 | 9 | 72.9% |
| `src/modules/filters/index.ts` | rename 61% | 17 | 12 | 7 | 43.1% |
| `src/modules/filters/styles.ts` | new | 47 | 0 | 0 | 0.0% |
| `src/modules/paged-media/columns.ts` | new | 220 | 0 | 0 | 0.0% |
| `src/modules/paged-media/page-floats.ts` | new | 908 | 0 | 0 | 0.0% |
| `src/paged.pdf.ts` | new | 153 | 0 | 0 | 0.0% |
| `src/print.ts` | new | 217 | 0 | 0 | 0.0% |
| `src/types/emitter.ts` | new | 12 | 0 | 0 | 0.0% |
| `src/types/vendor.d.ts` | new | 128 | 0 | 0 | 0.0% |
| `src/utils/__mocks__/pretext-rich-inline-stub.cjs` | new | 14 | 0 | 0 | 0.0% |
| `src/utils/__mocks__/pretext-stub.cjs` | new | 21 | 0 | 0 | 0.0% |
| `src/utils/domops.ts` | new | 104 | 0 | 0 | 0.0% |
| `src/utils/textmeasure.ts` | new | 423 | 0 | 0 | 0.0% |

## Work checklist

Tick a box when a file has been fully rewritten or otherwise no longer
contains upstream-derived code. Update the summary numbers afterward.

### High impact (> 500 upstream-derived lines or > 60% of file)

- [ ] `src/modules/paged-media/atpage.ts` — 2152 upstream lines (74.8% of file)
- [ ] `src/utils/dom.ts` — 939 upstream lines (59.4% of file)
- [ ] `src/modules/paged-media/footnotes.ts` — 510 upstream lines (53.4% of file)
- [ ] `src/modules/paged-media/counters.ts` — 384 upstream lines (68.1% of file)
- [ ] `src/polisher/sheet.ts` — 283 upstream lines (71.4% of file)
- [ ] `src/modules/generated-content/running-headers.ts` — 185 upstream lines (61.7% of file)
- [ ] `src/modules/generated-content/target-counters.ts` — 181 upstream lines (67.7% of file)
- [ ] `src/modules/paged-media/breaks.ts` — 178 upstream lines (71.4% of file)
- [ ] `src/modules/generated-content/string-sets.ts` — 157 upstream lines (62.0% of file)
- [ ] `src/polisher/sizes.ts` — 138 upstream lines (74.9% of file)
- [ ] `src/modules/filters/undisplayed.ts` — 128 upstream lines (66.8% of file)
- [ ] `src/modules/filters/whitespace.ts` — 93 upstream lines (88.2% of file)
- [ ] `src/modules/paged-media/page-counter-increment.ts` — 93 upstream lines (60.3% of file)
- [ ] `src/modules/paged-media/print-media.ts` — 86 upstream lines (83.3% of file)
- [ ] `src/chunker/parser.ts` — 84 upstream lines (78.9% of file)
- [ ] `src/chunker/breaktoken.ts` — 83 upstream lines (72.4% of file)
- [ ] `src/modules/paged-media/nth-of-type.ts` — 80 upstream lines (73.6% of file)
- [ ] `src/modules/paged-media/splits.ts` — 72 upstream lines (71.8% of file)
- [ ] `src/modules/paged-media/following.ts` — 61 upstream lines (66.0% of file)
- [ ] `src/modules/paged-media/lists.ts` — 52 upstream lines (73.9% of file)
- [ ] `src/utils/handlers.ts` — 39 upstream lines (62.0% of file)
- [ ] `src/utils/css.ts` — 30 upstream lines (91.0% of file)
- [ ] `src/modules/filters/scripts.ts` — 27 upstream lines (77.7% of file)
- [ ] `src/modules/filters/comments.ts` — 27 upstream lines (78.6% of file)
- [ ] `src/index.ts` — 20 upstream lines (100.0% of file)
- [ ] `src/chunker/chunker.test.js` — 16 upstream lines (88.9% of file)
- [ ] `src/modules/generated-content/index.ts` — 9 upstream lines (72.9% of file)

### Medium impact (100–500 upstream-derived lines or 30–60% of file)

- [ ] `src/utils/dom.ts` — 939 upstream lines (59.4% of file)
- [ ] `src/modules/paged-media/footnotes.ts` — 510 upstream lines (53.4% of file)
- [ ] `src/modules/paged-media/counters.ts` — 384 upstream lines (68.1% of file)
- [ ] `src/chunker/chunker.ts` — 332 upstream lines (27.6% of file)
- [ ] `src/chunker/layout.ts` — 317 upstream lines (5.0% of file)
- [ ] `src/polisher/sheet.ts` — 283 upstream lines (71.4% of file)
- [ ] `src/polisher/base.ts` — 227 upstream lines (28.4% of file)
- [ ] `src/modules/generated-content/running-headers.ts` — 185 upstream lines (61.7% of file)
- [ ] `src/modules/generated-content/target-counters.ts` — 181 upstream lines (67.7% of file)
- [ ] `src/modules/paged-media/breaks.ts` — 178 upstream lines (71.4% of file)
- [ ] `src/modules/generated-content/string-sets.ts` — 157 upstream lines (62.0% of file)
- [ ] `src/utils/utils.ts` — 156 upstream lines (52.0% of file)
- [ ] `src/chunker/page.ts` — 139 upstream lines (20.3% of file)
- [ ] `src/polisher/sizes.ts` — 138 upstream lines (74.9% of file)
- [ ] `src/modules/generated-content/target-text.ts` — 135 upstream lines (58.2% of file)
- [ ] `src/modules/filters/undisplayed.ts` — 128 upstream lines (66.8% of file)
- [ ] `src/polisher/polisher.ts` — 86 upstream lines (39.7% of file)
- [ ] `src/modules/paged-media/position-fixed.ts` — 66 upstream lines (59.1% of file)
- [ ] `src/polyfill/polyfill.ts` — 61 upstream lines (56.8% of file)
- [ ] `src/utils/hook.ts` — 35 upstream lines (35.8% of file)
- [ ] `src/modules/handler.ts` — 31 upstream lines (49.8% of file)
- [ ] `src/chunker/renderresult.ts` — 25 upstream lines (56.5% of file)
- [ ] `src/modules/paged-media/index.ts` — 19 upstream lines (56.7% of file)
- [ ] `src/utils/request.ts` — 15 upstream lines (33.7% of file)
- [ ] `src/modules/filters/index.ts` — 7 upstream lines (43.1% of file)

### Low impact (< 100 upstream-derived lines and < 30% of file)

- [ ] `src/polyfill/previewer.ts` — 88 upstream lines (25.8% of file)
- [ ] `src/utils/queue.ts` — 72 upstream lines (25.0% of file)
- [ ] `src/chunker/overflow.ts` — 22 upstream lines (29.6% of file)

### Already clean (new files, no upstream-derived code)

- [x] `src/modules/filters/styles.ts` — 47 lines
- [x] `src/modules/paged-media/columns.ts` — 220 lines
- [x] `src/modules/paged-media/page-floats.ts` — 908 lines
- [x] `src/paged.pdf.ts` — 153 lines
- [x] `src/print.ts` — 217 lines
- [x] `src/types/emitter.ts` — 12 lines
- [x] `src/types/vendor.d.ts` — 128 lines
- [x] `src/utils/__mocks__/pretext-rich-inline-stub.cjs` — 14 lines
- [x] `src/utils/__mocks__/pretext-stub.cjs` — 21 lines
- [x] `src/utils/domops.ts` — 104 lines
- [x] `src/utils/textmeasure.ts` — 423 lines

## Regenerating this document

Run the helper script from the repository root:

```bash
python3 scripts/generate-mit-tracking.py
```

This will refresh the numbers while preserving any checkmarks you have added.
