import BreakToken from "./breaktoken.js";
import RenderResult from "./renderresult.js";
import Hook from "../utils/hook.js";
import Overflow from "./overflow.js";
import type { ChunkerHooks } from "./chunker.js";
import type { PagedEventEmitter } from "../types/emitter.js";
interface WithRefs extends HTMLElement {
    indexOfRefs?: Record<string, HTMLElement>;
}
type LayoutHooks = ChunkerHooks & {
    beforeOverflow?: Hook<any>;
};
/**
 * A rendered element that acts as a CSS multi-column fragmentainer: content
 * flows through its columns and any excess spills into an additional
 * off-page column, which is detected as overflow.
 */
interface FragmentainerMeta {
    count: number;
    gap: number;
    columnWidth: number;
}
/** Diagnostics for the prediction path (counts only; negligible cost). */
export declare const predictStats: {
    prepareCalls: number;
    prepareMs: number;
    reuses: number;
    predicts: number;
    predictMs: number;
    fallbacks: number;
    quickFits: number;
    unverified: number;
    eagerEntries: number;
    rejects: Record<string, number>;
};
/**
 * Resets per-run prediction caches. Called once per flow so rerunning the
 * previewer on new content never matches stale entries.
 */
export declare function resetPredictionCaches(): void;
export interface OverflowViolation {
    page: string;
    kind: "h-spill" | "v-spill";
    detail: string;
}
/**
 * Audits finished pages for content that ended up outside the space
 * designated for it.
 * * During pagination, spill into hidden columns is the normal overflow
 * signal; once rendering has completed, no such spill may remain. Used to
 * validate unverified (pure-pretext) text breaking after the fact.
 *
 * @param pagesArea - The element containing all rendered pages.
 * @returns One entry per page exhibiting horizontal or vertical spill.
 */
export declare function validateRenderedPages(pagesArea?: HTMLElement | null): OverflowViolation[];
/**
 * Re-balances the final fragments of fragmented multicol blocks.
 *
 * While paginating, a multicol block that spans pages is constrained to
 * `height: <remaining>; column-fill: auto` so the browser fragments it.
 * Its last fragment, however, fits without a constraint — and an
 * unconstrained multicol container balances its columns per CSS Multi-col,
 * which is what `column-fill: balance` asks for on final pages. This pass
 * releases those constraints where doing so does not re-introduce overflow,
 * giving balanced last pages for free.
 *
 * Called automatically after a flow completes; safe to call again.
 *
 * @param pagesArea - The element containing all rendered pages.
 * @returns The number of fragments that were re-balanced.
 */
export declare function rebalanceMulticolFinals(pagesArea?: HTMLElement | null): number;
/**
 * Re-balances the final row of root-level manual columns.
 *
 * Manual columns are filled sequentially by the layout engine. On a page
 * whose content ends early — the document's last page, or a page that ends
 * a part (a forced page break or a deferred `column-span: all` heading
 * follows, marked `data-paged-part-end` by the walk) — this often leaves
 * the right-hand columns nearly empty while the left-hand column holds the
 * remaining content. When the author asked for `column-fill: balance` (the
 * CSS default), such final rows are converted back into a native CSS
 * multi-column container for that page only; the browser then distributes
 * the remaining content evenly. If balancing would re-introduce overflow,
 * the row is left in its sequential layout.
 *
 * @param pagesArea - The element containing all rendered pages.
 * @returns The number of rows that were re-balanced.
 */
export declare function rebalanceManualColumnFinals(pagesArea?: HTMLElement | null): number;
/**
 * Attaches the source fragment to a hidden host once per flow so computed
 * styles resolve, then captures measurements used later while the fragment
 * is detached again:
 *
 * - for every element with a data-ref, an ElementMeasure record (font spec,
 *   margins, padding/border, display) feeding the column-span segment
 *   height planner — captured in every measurement mode;
 * - when `textMeasurement === "pretext"`, prepared texts for every
 *   substantial text node, front-loading all segmentation and canvas
 *   measurement into one warm phase (after fonts have loaded), leaving
 *   textBreak pure arithmetic + probes afterwards.
 *
 * Flows containing elements that do not survive being moved between
 * parents (iframes, object/embed) skip the attach entirely; the planner
 * then stays disabled and textBreak prepares lazily.
 *
 * The fragment is temporarily attached inside a hidden container so
 * computed styles resolve; it is returned re-parented as a fresh fragment
 * for the caller to render from.
 */
export declare function prepareTextsEagerly(source: DocumentFragment | Node, settings: Record<string, unknown>): DocumentFragment | Node;
/**
 * Layout
 * @class
 */
declare class Layout {
    element: HTMLElement;
    bounds: DOMRect;
    parentBounds: DOMRect | {
        left: number;
    };
    gap: number;
    hooks: LayoutHooks;
    settings: Record<string, unknown>;
    maxChars: number;
    forceRenderBreak: boolean;
    temporaryIndex: number;
    failed?: boolean;
    /** Selector strings that may produce fragmentainers (from author CSS). */
    multicolSelectors: Set<string>;
    /** Selectors declaring `column-span: all` (full-width rows). */
    columnSpanSelectors: Set<string>;
    /** Root-level multicol config applied to the page wrapper (if any). */
    rootColumns?: {
        count: number;
        gap?: string;
        fill?: "auto" | "balance";
        ruleColor?: string;
        ruleStyle?: string;
        ruleWidth?: string;
    };
    /** Rendered fragmentainer roots found on this page. */
    fragmentainers: Set<Element>;
    /** Cached per-element column metadata. */
    private fragmentainerMeta;
    /** Saved inline heights of fragmentainers during unconstrained measuring. */
    private savedFragmentainerHeights;
    /** Whether this.bounds no longer reflects the mutated DOM. */
    private boundsDirty;
    /** Whether findOverflow is running inside the residual sweep, where
     *  range tags from an earlier extraction may no longer match the
     *  shrunken bounds and should not hide a genuinely overflowing block. */
    private inResidualSweep;
    /** Shared pretext-backed measurement service (predict fast path). */
    private measure;
    /** Text nodes for which prediction already proved unprofitable. */
    private predictFallbacks;
    /** Prepared originals keyed by parent ref, reusable by continuation suffixes. */
    private continuationPrepared;
    /**
     * Whether predicted breaks are verified against real DOM rects before
     * being accepted. Disable via settings `verifyTextPrediction: false` to
     * run pure-arithmetic breaking; output should then be audited
     * post-render with validateRenderedPages().
     */
    private predictionVerified;
    /**
     * Planned natural heights for `column-span` segments on this page, keyed
     * by the data-ref of the span element that opens each segment. Computed
     * once per page by planSegmentHeights(); consumed by applyColumnSpan().
     * Entries with `defer` mark spans that should be deferred to the next
     * page because the planner found no room for the segment they open.
     */
    private segmentHeightQueue;
    /**
     * Whether the final character of a text node renders outside its
     * fragmentainer / page bounds. Flow order is monotonic, so the tail
     * overflowing is equivalent to the node straddling the break.
     */
    private textEndOverflows;
    constructor(element: HTMLElement, hooks?: ChunkerHooks, options?: Record<string, unknown>);
    /**
     * Marks cached page bounds as stale after a DOM or style mutation.
     */
    invalidateBounds(): void;
    /**
     * The manual column boxes of a flow host, or the host itself when the
     * page is single-column. Content is filled into these sequentially.
     *
     * With `column-span` segments the host holds several `.paged_columns`
     * rows; the active row is the last one (newest segment).
     *
     * @param {HTMLElement} wrapper - The page's flow host (`.paged_flow`).
     * @returns {HTMLElement[]} The containers to fill, in order.
     */
    flowColumns(wrapper: HTMLElement): HTMLElement[];
    /**
     * Starts a new column segment below a `column-span: all` element.
     *
     * The spanning element has already been appended to the flow host; this
     * adds a fresh row of column boxes for the content that follows, which
     * continues as a new set of columns (column 0 again), mirroring CSS
     * multicol's span semantics.
     *
     * @param {HTMLElement} wrapper - The flow host.
     * @returns {HTMLElement[]} The new segment's column boxes.
     */
    private startSpanRow;
    /**
     * Whether a source node carries `column-span: all` and therefore breaks
     * the current column segment into a full-width row.
     *
     * @param {Node|null} node - The source node.
     * @returns {boolean} True when the node spans all columns.
     */
    private isColumnSpan;
    /**
     * Adds a `column-span: all` element as a full-width row and opens a new
     * column segment below it.
     *
     * @param {HTMLElement} wrapper - The flow host.
     * @param {Node} node - The spanning source node.
     * @param {Node|DocumentFragment} source - The source content.
     * @param {BreakToken|undefined} breakToken - Current break token.
     * @returns {HTMLElement[]} The new segment's column boxes.
     */
    private applyColumnSpan;
    /**
     * After a new `column-span` segment row is opened, re-check every earlier
     * segment's columns: their rows have shrunk, so content that previously
     * fitted can now overflow. Move the overflowing content into the next
     * column of the same segment, preserving it in document order.
     *
     * @param {HTMLElement} wrapper - The flow host.
     * @param {DocumentFragment|Node} source - The source content.
     * @returns {void}
     */
    private migrateShrunkenSegmentOverflow;
    /**
     * Plans natural heights for the `column-span` segments of this page.
     *
     * Without a plan every segment row gets an equal flex share of the flow
     * host, so a segment holding little content wastes the rest, and columns
     * filled against the pre-span full height spill massively when a new
     * segment row shrinks them. Instead, the content between the walk start
     * and each upcoming top-level `column-span: all` element is measured
     * arithmetically (pretext line counts from font metrics; DOM probes for
     * content pretext cannot model) and each segment row is fixed at the
     * height its content actually needs — rounded up to whole lines, so
     * estimation errors leave slack rather than cause overflow. The final
     * segment on the page always keeps its flexible height and absorbs
     * whatever space is left.
     *
     * The first row is fixed immediately; heights for later segments are
     * queued and consumed by applyColumnSpan() as the walker reaches each
     * span. When no top-level span lies ahead, nothing changes and rows keep
     * their flexible equal share.
     *
     * @param {HTMLElement} wrapper - The page's flow host.
     * @param {DocumentFragment|Node} source - The source content.
     * @param {Node|undefined} start - The node the walk starts at.
     * @returns {void}
     */
    private planSegmentHeights;
    /**
     * Estimates a column-segment row's natural height from the total height
     * of the content that will fill it.
     *
     * With `column-fill: auto` the content is stacked into the first column,
     * so the row only needs the content's own height (capped at the page's
     * available height — anything more overflows to the next page). With
     * `column-fill: balance` the content is spread evenly across the columns,
     * so the height is the total divided by the column count. Both are
     * rounded up to whole lines plus margin slop.
     *
     * @param {number} segmentTotal - Sum of the segment's block heights (px).
     * @param {number} count - Number of columns in the row.
     * @param {number} line - Largest line height seen in the segment.
     * @param {number} margin - Largest vertical margin seen in the segment.
     * @param {number} available - Page height available to column content.
     * @param {string} fill - `auto` or `balance`.
     * @returns {number} The row height in CSS px.
     */
    private segmentRowHeight;
    /**
     * Estimates the natural height of a source block laid out at the given
     * width, including its margins. Inline content is measured arithmetically
     * from font metrics (per inline run, so mixed formatting keeps its own
     * fonts); block children are recursed into; anything pretext cannot
     * model (tables, images, replaced elements, unmeasured styles) is
     * measured by cloning into the off-screen probe host. Footnote bodies
     * and hidden content are excluded — they render outside the columns.
     *
     * @param {Element} el - The source element (detached).
     * @param {number} width - The width it will be laid out at.
     * @param {Object} ctx - Estimation context (tracks the largest line
     *   height seen, for whole-line rounding by the caller).
     * @param {Node} [skipBefore] - When set, content before this node is not
     *   counted (the node resumes mid-block from a previous page).
     * @returns {number} The estimated height in CSS px.
     */
    private estimateFlowBlockHeight;
    /**
     * Collects the inline text of a block as runs sharing one font spec, so
     * mixed-format paragraphs are measured with each run's own font. Skips
     * footnote bodies (they render in the footnote area, not the column),
     * hidden elements, and script/style text.
     *
     * @param {Element} el - The block element.
     * @param {Node} [skipBefore] - Resume point; earlier text is excluded.
     * @returns {InlineRun[]} The runs in document order.
     */
    private collectInlineRuns;
    /**
     * Measures a block's natural height by cloning it into the hidden probe
     * host at the target width. Cached per element and width; used for
     * content pretext cannot model (tables, images, replaced elements).
     *
     * @param {Element} el - The source element (detached).
     * @param {number} width - The width to measure at.
     * @returns {number} The measured height including margins, in CSS px.
     */
    private probeBlockHeight;
    /**
     * Measures a block's post-extraction height: like probeBlockHeight, but
     * the clone's footnote subtrees are removed first, because they leave the
     * flow when the block renders. The footnote reserve prediction must see
     * the same heights the real walk lays out — the pretext estimate wraps at
     * a narrowed width and cannot hyphenate, so it fits less content than the
     * page will, under-counts the notes to reserve, and lets the footnote
     * area grow past the reserve mid-walk. Cached per element and width.
     *
     * @param {HTMLElement} block - The source block (detached).
     * @param {number} width - The width to measure at.
     * @returns The probe record: height including margins, plus the block's
     *   own margins for collapse-aware budget accumulation.
     */
    private probeBlockHeightWithoutNotes;
    /**
     * Per-column content extents of a segment row: for each column, the
     * distance from the row's top to the bottom of its content (0 when
     * empty). Used both to measure carried overflow before the walk and to
     * shrink a completed segment to its real content height.
     *
     * Range rects exclude margins, but a column's scroll height includes the
     * bottom margin of its last content, so the extent is extended to cover
     * it (margins collapse down the chain of last children: the deepest
     * bottom plus the largest margin along it).
     *
     * @param {HTMLElement} row - A `.paged_columns` row.
     * @returns {number[]} One extent per column, in CSS px.
     */
    private columnContentExtents;
    /**
     * Fixes a segment row at an explicit height so it no longer receives an
     * equal flex share of the flow host.
     *
     * @param {HTMLElement} row - A `.paged_columns` row.
     * @param {number} height - The height in CSS px.
     * @returns {void}
     */
    private fixSegmentRowHeight;
    /**
     * Shrinks a completed segment row to the height of its measured content
     * when that is less than its current height, freeing the difference for
     * the segment that follows. Never grows a row and never shrinks below
     * the content, so no re-flow is needed.
     *
     * @param {HTMLElement} row - The segment's `.paged_columns` row.
     * @returns {void}
     */
    private shrinkCorrectSegmentRow;
    /**
     * Reserves space for the footnotes this page will extract, before any
     * column content is filled.
     *
     * Footnote calls extract their notes while the walk renders their
     * paragraphs; each extraction grows the footnote area and shrinks every
     * column. When that happens after earlier columns are already filled,
     * the shrink spills laid-out text and the residual sweep moves whole
     * blocks to the next page — leaving pages with an empty trailing column.
     *
     * The page's upcoming content is therefore predicted arithmetically (the
     * same pretext-backed block estimates the segment planner uses), the
     * footnotes whose calls land on the page are collected, and their
     * rendered heights (probed once per note, marker included) are reserved
     * via `--paged-footnotes-height` up front. Because the prediction
     * depends on the reserve itself (less column space may push a footnote
     * call to the next page), the estimate iterates to a fixed point and
     * keeps the largest value seen — over-reserving only leaves a few
     * pixels of slack, while under-reserving reproduces the spill.
     *
     * The reserved value is recorded on the page area as
     * `data-paged-footnote-reserve`; the footnotes handler treats it as a
     * floor while the page is filled and releases the unused remainder when
     * the page is done.
     *
     * @param {HTMLElement} wrapper - The page's flow host.
     * @param {DocumentFragment|Node} source - The full source fragment.
     * @param {Node|undefined} start - The node the walk starts at.
     * @returns {void}
     */
    private reserveFootnoteAreaHeight;
    /**
     * Sums the rendered heights of the footnotes whose calls will land on
     * this page, walking the upcoming top-level source blocks against the
     * page's content budget.
     *
     * Fully fitting blocks contribute all their notes; the one block that
     * straddles the page boundary contributes only the notes whose calls sit
     * before the predicted split (uniform-font blocks get the exact line
     * offset from pretext, mixed-font blocks a proportional one; unmodellable
     * blocks conservatively contribute all their notes). Returns -1 when the
     * walk hits loose top-level text, which has no reliable block context.
     *
     * @param {DocumentFragment|Node} source - The full source fragment.
     * @param {Node} topStart - The top-level node the walk starts in or at.
     * @param {Node} start - The exact resume node (may sit inside topStart).
     * @param {number} columnWidth - The width blocks are laid out at.
     * @param {number} budget - Total column space on the page, in px.
     * @param {number} probeWidth - Width to probe footnote heights at.
     * @returns {number} The summed note heights (without area chrome), or -1.
     */
    private predictFootnoteReserve;
    /**
     * Rendered heights of a block's footnotes, optionally limited to the
     * calls that sit before the block's predicted split point.
     *
     * @param {HTMLElement} block - The source block.
     * @param {number} remaining - Column space left on the page (px), or
     *   Infinity when the block fits entirely.
     * @param {number} blockHeight - The block's estimated outer height.
     * @param {number} columnWidth - The width blocks are laid out at.
     * @param {number} probeWidth - Width to probe note heights at.
     * @param {Node} [skipBefore] - Resume point; earlier notes are excluded.
     * @returns {number} The summed note heights in px.
     */
    private estimateBlockNoteReserve;
    /**
     * Walks a block's flow text (mirroring collectInlineRuns' filters) while
     * recording the flow-text offset of every footnote it passes, so notes
     * can be classified against a predicted split offset.
     *
     * @param {Element} el - The block element.
     * @param {Node} [skipBefore] - Resume point; earlier content is excluded.
     * @param {InlineRun[]} runs - Output: the flow text as font runs.
     * @param {Array<{offset: number, el: HTMLElement}>} notes - Output: the
     *   footnotes with their flow-text offsets.
     * @returns {void}
     */
    private collectFlowTextAndNotes;
    /**
     * Flow-text offset just past the given line, when the text is laid out
     * at the given width. Line counts use the same narrowed width as
     * measureInlineRunsHeight so both agree on where the block wraps.
     *
     * @param {string} text - The block's flow text.
     * @param {FontSpec} spec - The (uniform) font specification.
     * @param {number} width - The layout width.
     * @param {number} lines - The number of lines that fit.
     * @returns {number} The offset ending the last fitted line; the full
     *   text length when the text cannot be measured (conservative).
     */
    private offsetAtLine;
    /**
     * Rendered height of a footnote in the footnote area, probed by cloning
     * it into the off-screen probe host at the note width. The clone is
     * marked as a footnote marker so the list-item display and the rendered
     * `::marker` ("N. ") are part of the measurement, matching the real
     * extraction. Cached per note and width.
     *
     * @param {HTMLElement} note - The source footnote element.
     * @param {number} width - The footnote area's content width.
     * @returns {number} The note's outer height in px.
     */
    private estimateNoteHeight;
    /**
     * Page-float elements within a source node (the node itself included).
     *
     * @param {Node} node - The source node.
     * @returns {HTMLElement[]} The float elements, possibly empty.
     */
    private floatElementsIn;
    /**
     * Height of the flow content already rebuilt into the page's columns by
     * addOverflowToPage (the previous page's carried overflow), in the
     * sequential-fill coordinate space: a non-empty column k implies columns
     * 0..k-1 are full.
     *
     * @param {HTMLElement} wrapper - The page's flow host.
     * @param {number} count - The number of columns.
     * @param {number} rowH - The current height of one column.
     * @returns {number} The used content height in px.
     */
    private currentUsedColumnHeight;
    /**
     * Bottom slack the walk's break verification grants the deepest content
     * of a container: the summed bottom margin, padding and border of the
     * chain of last elements (the same allowance textBreak computes via
     * getAncestorPaddingBorderAndMarginSums when it accepts a line whose box
     * ends inside its parent's bottom margin zone).
     *
     * @param {HTMLElement} container - The column or flow host.
     * @returns {number} The trailing slack in px.
     */
    private trailingBottomSlack;
    /**
     * Distance from a container's top to the bottom of its content,
     * including the trailing margin of its deepest last child (range rects
     * exclude margins). Shared by the column-extent and carried-content
     * measurements.
     *
     * @param {HTMLElement} container - The column or flow host to measure.
     * @returns {number} The content extent in px, 0 when empty.
     */
    private contentExtent;
    /**
     * Vertical chrome (margins, padding, borders) the footnote content box
     * adds around the notes, matching what recalcFootnotesHeight adds when
     * it sizes the area from actual content.
     *
     * @param {HTMLElement} noteContent - The `.paged_footnote_content` box.
     * @returns {number} The chrome height in px.
     */
    private footnoteChrome;
    /**
     * Gives a freshly opened segment row its planned natural height, clamped
     * to the space left on the page. The row is always fixed when the plan
     * covers this span: a flexible row would be filled to the remaining
     * page height and then shrunk when the next span opens, spilling
     * content that has nowhere to go. Spans the planner did not see
     * (nested or stale entries) leave the queue untouched and keep the row
     * flexible.
     *
     * @param {Node} node - The span element that opened the segment.
     * @param {HTMLElement[]} newColumns - The new segment's column boxes.
     * @returns {void}
     */
    private applyPlannedSegmentHeight;
    /**
     * Whether a span should be deferred to the next page because there is no
     * room for it below the current segment. Measured against the actual
     * remaining space in the flow host at walk time, so it stays correct even
     * when the planner's `available` estimate was off (e.g. a top float was
     * not yet placed when the page was planned). When deferred, the element is
     * treated as ordinary content and the overflow path moves it to the next
     * page, where it is encountered as a span again.
     *
     * @param {HTMLElement} wrapper - The page's flow host.
     * @param {Node} node - The span element.
     * @returns {boolean} True when the span should not be applied now.
     */
    private shouldDeferColumnSpan;
    /**
     * Releases a fixed height from the page's final segment row, so it
     * absorbs the leftover space below it. Only the last row may flex; rows
     * closed by a following span keep their measured height.
     *
     * @param {HTMLElement} wrapper - The page's flow host.
     * @returns {void}
     */
    private relaxFinalSegmentRow;
    /**
     * Makes a column box the active layout root: bounds, fragmentainer
     * ancestor walks and overflow detection follow this element until the
     * next column (or page) takes over.
     *
     * @param {HTMLElement} dest - The column (or single-column wrapper).
     * @returns {void}
     */
    setActiveColumn(dest: HTMLElement): void;
    /**
     * Bounds of a manual column: the column's own box, which the flex column
     * row already sizes to account for the top page float and any
     * `column-span: all` segments above it.
     *
     * Overflow detection reads against these bounds, so the physical column
     * boxes match the detection exactly. Using the flow host's full height
     * here would make columns inside a shorter `column-span` segment accept
     * the whole page height, letting their text overlap whatever follows.
     *
     * @param {HTMLElement} column - A `.paged_column` box inside a `.paged_flow`.
     * @returns {DOMRect} The bounds used for overflow detection.
     */
    private manualColumnBounds;
    /**
     * Clears overflow bookkeeping attributes from a column and its content.
     *
     * Range tagging (which marks content already accounted for as overflow)
     * can cross a column boundary — `nodeAfter` climbs past a column's last
     * child and tags the next column as range-end overflow — suppressing all
     * further detection there. Every column starts its fill with a clean
     * slate, so these attributes are stripped when content is handed over.
     *
     * @param {HTMLElement} dest - The column (or single-column wrapper).
     * @returns {void}
     */
    private clearOverflowTags;
    /**
     * Advances layout to the next column, rebuilding the current overflow
     * into it and clearing stray overflow tags left by range tagging.
     *
     * @param {HTMLElement[]} columns - The page's column boxes.
     * @param {number} colIndex - Current column index.
     * @param {BreakToken} token - Overflow token to rebuild.
     * @param {HTMLElement|null} prevPage - Previous page content.
     * @returns {HTMLElement} The new active column.
     */
    private advanceColumn;
    /**
     * Page content bounds, re-measured at most once per mutation batch.
     *
     * Appending a node only matters geometrically when something later
     * reads geometry; deferring the read here lets consecutive appends
     * share a single engine layout instead of forcing one per node.
     */
    refreshBounds(): DOMRect;
    /**
     * True when the element computes to more than one column.
     */
    isMulticolElement(el: Element): boolean;
    /**
     * Reads and caches the column geometry of a potential fragmentainer.
     *
     * `column-gap: normal` resolves to 1em per spec; computed styles may
     * report the keyword, so it is approximated via font-size when needed.
     */
    getFragmentainerMeta(el: Element): FragmentainerMeta;
    /**
     * The layout box of a fragmentainer.
     *
     * A fragmented multicol container's getBoundingClientRect() returns the
     * union across all fragments, which poisons geometry; the real box is
     * the first fragment positioned at (left, top) sized clientWidth x
     * clientHeight.
     */
    fragmentainerBox(el: Element): {
        left: number;
        top: number;
        right: number;
        bottom: number;
    };
    /**
     * Finds multicol roots among the rendered descendants of `root`
     * (including itself) and registers them. Nested fragmentainers are not
     * supported: the inner container degrades to a single column with a
     * warning.
     */
    registerFragmentainers(root: HTMLElement | Node): void;
    /**
     * Registers a single fragmentainer unless it sits inside an already
     * registered one (nested multicol), which is degraded gracefully.
     */
    private registerFragmentainer;
    /**
     * The nearest registered fragmentainer ancestor of a node, or null when
     * the node flows directly within the page wrapper (single-column
     * semantics relative to the page bounds).
     */
    getFragmentainer(node: Node): Element | null;
    /**
     * Whether a single client rect of a node exceeds its fragmentainer.
     *
     * Without a fragmentainer this falls back to the classic page-bounds
     * comparison. Within a fragmentainer:
     * - a rect starting at or beyond the right edge lies in the hidden
     *   spill-over column and overflows;
     * - a rect starting in the last visible column must also fit vertically.
     */
    rectOverflows(rect: DOMRect, additions: number, frag: Element | null, bounds?: DOMRect): boolean;
    /**
     * Constrains a multicol block to the remaining vertical space on this
     * page so the browser fragments it internally instead of balancing it
     * past the bottom edge. Only applied when the block's natural height
     * does not fit.
     */
    constrainMulticolHeight(el: Element, bounds?: DOMRect): void;
    /**
     * Fills the page and check for the first overflow.
     *
     * @param {Element} wrapper - current Page's content wrapper
     * @param {HTML} source - Html source template content
     * @param {BreakToken} breakToken - previous breakToken
     * @param {Page} prevPage - previous Page
     * @param {DOMRect} bounds - Page bounds
     * @returns {BreakToken}
     */
    renderTo(wrapper: HTMLElement, source: DocumentFragment | Node, breakToken: BreakToken | undefined, prevPage?: HTMLElement | null, bounds?: DOMRect): Promise<RenderResult>;
    breakAt(node: Node | undefined, offset?: number, forcedBreakQueue?: Node[]): BreakToken;
    shouldBreak(node: Node, limiter?: Node): boolean;
    forceBreak(): void;
    getStart(source: DocumentFragment | Node, breakToken?: BreakToken): Node | undefined;
    /**
     * Merge items from source into dest which don't yet exist in dest.
     *
     * @param {element} dest
     *   A destination DOM node tree.
     * @param {element} source
     *   A source DOM node tree.
     *
     * @returns {void}
     */
    addOverflowNodes(dest: HTMLElement, source: Node): void;
    /**
     * Add overflow to new page.
     *
     * @param {element} dest
     *   The page content being built.
     * @param {breakToken} breakToken
     *   The current break cotent.
     * @param {element} alreadyRendered
     *   The content that has already been rendered.
     *
     * @returns {void}
     */
    addOverflowToPage(dest: HTMLElement, breakToken: BreakToken | undefined, alreadyRendered?: DocumentFragment | Node): void;
    /**
     * Add text to new page.
     *
     * @param {element} node
     *   The node being appended to the destination.
     * @param {element} dest
     *   The destination to which content is being added.
     * @param {element} source
     *   The source DOM
     * @param {breakToken} breakToken
     *   The current breakToken.
     * @param {bool} shallow
     *	 Whether to do a shallow copy of the node.
     * @param {bool} rebuild
     *   Whether to rebuild parents.
     *
     * @returns {ChildNode}
     *   The cloned node.
     */
    append(node: Node, dest: HTMLElement, source: DocumentFragment | Node, breakToken: BreakToken | null | undefined, shallow?: boolean, rebuild?: boolean): ChildNode;
    rebuildTableFromBreakToken(breakToken: BreakToken | undefined, dest: HTMLElement, source: DocumentFragment | Node): void;
    waitForImages(imgs: NodeListOf<HTMLImageElement>): Promise<void>;
    awaitImageLoaded(image: HTMLImageElement): Promise<unknown>;
    avoidBreakInside(node: Node, limiter: Node): Element | undefined;
    createOverflow(overflow: Range, rendered: HTMLElement, source: DocumentFragment | Node): Overflow | undefined;
    /**
     * Recursively removes last child and it's ancestors if the nested parentElement is empty
     *
     * In case of empty table rows or similar
     *
     * @param {Element} parentElement
     * @param {Element} rootElement
     */
    lastChildCheck(parentElement: Element, rootElement: WithRefs): void;
    /**
     * Extends an overflow range backward so its tail carries at least one
     * word of flow text. Only acts when the range's content is empty of
     * text (whitespace or footnote-call anchors alone — a marker wrapped
     * past the column edge by itself); walks the block's text nodes in
     * reverse document order until the tail covers a real word (two word
     * characters — a trailing "." alone does not count) and moves the
     * range start to that word's beginning.
     *
     * @param {Range} range - The overflow range to adjust in place.
     * @returns {void}
     */
    extendOverflowToWord(range: Range): void;
    /**
     * Converts overflowresults into a Breaktoken objects
     *
     * Proccesses overflow result
     *
     * -> Called only from findBreakToken
     *
     * @param {List} overflow - overflow ranges
     * @param {Element} rendered - page content div
     */
    processOverflowResult(ranges: Range[], rendered: HTMLElement, source: DocumentFragment | Node, bounds: DOMRect, prevBreakToken: BreakToken | undefined, node: Node | null, extract?: boolean): BreakToken;
    /**
     * Determines overflow of this layout and convert that into a breaktoken
     * -> Called by Layout.renderTo
     *
     * @param {Element} rendered - page content
     * @param {HTML} source - Source content
     * @param {DOMRect} bounds - Bounding rect
     * @param {BreakToken} prevBreakToken - previous BreakToken
     * @param {Element} node - Start node of the breakContent
     * @param {*} extract
     * @returns {BreakToken}
     */
    findBreakToken(rendered: HTMLElement, source: DocumentFragment | Node, bounds?: DOMRect, prevBreakToken?: BreakToken, node?: Node | null, extract?: boolean): BreakToken | undefined;
    /**
     * Re-sweeps the page for overflow created by the extraction itself.
     *
     * Removing the overflowing tail of a paragraph changes how the kept
     * remainder wraps: hyphenation and justification of the partial
     * paragraph differ from the measured whole, so its tail can slip into
     * the spill column *after* the primary range collection finished. The
     * `data-overflow-tagged` marker — which deliberately suppresses
     * re-detection while a pass collects ranges — would hide that fresh
     * overflow, leaving text visibly stranded in the hidden column (a
     * "third column" the engine already decided to overflow). The marker is
     * cleared before each sweep pass and any residue is folded into the
     * existing break token, so the next page rebuilds it in document order.
     *
     * @param {HTMLElement} rendered - The page content wrapper.
     * @param {DOMRect} bounds - The page bounds.
     * @param {DocumentFragment|Node} source - The source content.
     * @param {BreakToken} breakToken - The token the residue appends to.
     * @param {BreakToken|undefined} prevBreakToken - The page's incoming
     * token, used as the loop guard by processOverflowResult.
     * @returns {void}
     */
    private extractResidualOverflow;
    /**
     * Sweeps every manual column of a page for overflow that appeared after
     * the page's last overflow check — for example the footnote area growing
     * and shrinking the flow host below already-laid-out text, or a split
     * paragraph re-wrapping slightly taller after its footnotes were pulled
     * out. Any residue found is folded into the outgoing break token so the
     * next page rebuilds it in document order.
     *
     * @param {HTMLElement} wrapper - The page's flow host (`.paged_flow`).
     * @param {DocumentFragment|Node} source - The source content.
     * @param {BreakToken} breakToken - The outgoing break token.
     * @param {BreakToken|undefined} prevBreakToken - The page's incoming token.
     * @returns {void}
     */
    private sweepResidualColumnOverflow;
    /**
     * Returns the source node with the earliest document position among a set
     * of overflow entries, or undefined if the set is empty.
     */
    private earliestOverflowNode;
    /**
     * When a residual sweep discovers overflow earlier than the break token's
     * existing overflow entries, any rendered blocks that follow that earliest
     * point in source order are still on the page out of order. Extract them
     * as separate overflows so the next page lays them out after the residual
     * content.
     *
     * @param {HTMLElement} wrapper - The page's flow host (`.paged_flow`).
     * @param {DocumentFragment|Node} source - The source content.
     * @param {BreakToken} breakToken - The outgoing break token.
     */
    private coalesceResidualOverflow;
    /**
     * Does the element exceed the bounds?
     *
     * @param {element} element
     *   The element being constrained.
     * @param {array} bounds
     *   The bounding element.
     *
     * @returns {bool}
     *   Whether the element is within bounds.
     */
    hasOverflow(element: HTMLElement, bounds?: DOMRect): boolean;
    /**
     * Sums padding, borders and margins for bottom/right of parent elements.
     *
     * Assumes no margin collapsing because we're considering overflow
     * on a page.
     *
     * This and callers need to be extended to handle right-to-left text and
     * flow but I'll get LTR going first in the hope that it will simplify
     * the task of getting RTL sorted later. Need test cases too.
     */
    getAncestorPaddingBorderAndMarginSums(element?: Element | null, stopAtFragmentainer?: boolean): Record<string, number>;
    /**
     * Checks whether an element is within a table and gets any THEAD sizes.
     */
    getAncestorTheadSizes(element?: Element | null): number;
    /**
     * Adds temporary data-split-to/from attribute where needed.
     *
     * @param DomElement element
     *   The deepest child, from which to start.
     */
    addTemporarySplit(element?: Element | null, isTo?: boolean): void;
    /**
     * Removes temporary data-split-to/from attribute where added.
     *
     * @param DomElement element
     *   The deepest child, from which to start.
     * @param boolean isTo
     *   Whether a split-to or -from was added.
     */
    deleteTemporarySplit(element?: Element | null, isTo?: boolean): void;
    /**
     * Client rects for any node: elements and ranges directly, text nodes
     * via a range around their contents.
     */
    nodeClientRects(node: Node): DOMRectList | undefined;
    /**
     * Returns the first child that overflows the bounds.
     *
     * There may be no children that overflow (the height might be extended
     * by a sibling). In this case, this function returns NULL.
     *
     * @param {node} node
     *   The parent node of the children we are searching.
     * @param {array} bounds
     *   The bounds of the page area.
     * @returns {ChildNode | null | undefined}
     *   The first overflowing child within the node.
     */
    firstOverflowingChild(node: Node, bounds: DOMRect): ChildNode | null | undefined;
    removeHeightConstraint(element: Element): void;
    restoreHeightConstraint(element: Element): void;
    getUnconstrainedElementHeight(element: Element, includeAncestors?: boolean, includeTableHead?: boolean): number;
    getRange(rangeStart: Node, offset: number, rangeEnd?: Node): Range;
    startOfNewOverflow(startNode: Node, rendered: HTMLElement, bounds: DOMRect): [ChildNode | null | undefined, boolean];
    /**
     * Tagging elements and returns range of overflowing elements
     *
     * @param {Element} startOfOverflow - Start element of the overflow
     * @param {Node} rangeStart
     * @param {Node} rangeEnd
     * @param {DOMRect} bounds - page bounds
     * @param {Element} rendered - Current rendered page content
     * @returns
     */
    tagAndCreateOverflowRange(startOfOverflow: Node, rangeStart: Node, rangeEnd?: Node, bounds?: DOMRect, rendered?: HTMLElement): Range | undefined;
    rowspanNeedsBreakAt(tableRow: Element, rendered: HTMLElement): Element | undefined;
    /**
     * Find the next overflow in the current layout. Tags overflowing content and returns the range of the overflowing content
     * -> Called by findBreakToken and afterLayout
     *
     * @param {Element} rendered - Current page rendered div
     * @param {DOMRect} bounds - ClientRect of the page
     * @param {HTML} source - Source html content
     * @returns {null | Range} range - null if there is no overflow.
     */
    findOverflow(rendered: HTMLElement, bounds: DOMRect, source?: DocumentFragment | Node): Range | undefined;
    findEndToken(rendered: HTMLElement, source: DocumentFragment | Node): BreakToken | undefined;
    /**
     * Finds the character offset at which this text node first exceeds the
     * available space.
     *
     * Fast path: predicts the break arithmetically via pretext line layout
     * (cached canvas measurements, no reflow per word) and verifies the
     * candidate with a couple of cheap DOM probes. Anything unsupported or
     * inconsistent falls back to the legacy word/letter walker.
     *
     * @returns offset, undefined (no break needed within this node), or
     * legacy fallback semantics otherwise.
     */
    textBreak(node: Text, start: number, end: number, vStart: number, vEnd: number): number | undefined;
    /**
     * Legacy word/letter walker measuring every word (and boundary-word
     * letters) through DOM rects.
     *
     * TEMPORARY FALLBACK: kept only until parity testing proves the
     * pretext predictor handles every supported case; remove together with
     * the `textMeasurement` escape hatch and capability gates then.
     */
    private legacyTextBreakCore;
    /**
     * Pretext-backed fast path: predicts the break offset from cached
     * arithmetic line layout and verifies the candidate with at most a
     * handful of DOM probes.
     *
     * @returns an offset when confidently predicted, `undefined` when the
     * text provably fits the remaining space, or `null` to request the
     * legacy fallback.
     */
    private predictTextBreak;
    private predictTextBreakInner;
    removeOverflow(overflow: Range, breakLetter?: string): DocumentFragment;
    hyphenateAtBreak(startContainer: Node, breakLetter?: string): void;
    equalTokens(a?: {
        node?: Node;
        offset?: number;
    } | null, b?: {
        node?: Node;
        offset?: number;
    } | null): boolean;
}
interface Layout extends PagedEventEmitter {
}
declare global {
    interface Window {
        __pagedPredictStats?: typeof predictStats;
    }
}
export default Layout;
