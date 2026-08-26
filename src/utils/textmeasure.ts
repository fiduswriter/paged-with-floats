import {
	prepareWithSegments,
	layoutNextLineRange,
	type PreparedTextWithSegments,
	type LayoutCursor,
	type PrepareOptions,
} from "@chenglou/pretext";

/**
 * Canvas/Intl-backed text measurement used to predict text break offsets
 * arithmetically instead of probing the DOM once per word.
 *
 * Pretext measures segment widths through the browser's own font engine
 * (canvas measureText) and caches them, so repeated line-layout passes are
 * pure arithmetic. Predicted break offsets are verified against real DOM
 * geometry by the caller.
 *
 * TEMPORARY: the legacy DOM-walking fallback in Layout.textBreak exists
 * only until parity testing shows this predictor handles every case; it is
 * then removed along with these capability gates.
 */

export interface FontSpec {
	/** Canvas font shorthand, e.g. `400 16px "Times New Roman"`. */
	font: string;
	/** Resolved letter-spacing in CSS px (0 when normal). */
	letterSpacing: number;
	/** Whitespace handling matched to the element's computed style. */
	whiteSpace: "normal" | "pre-wrap";
	/** Used line height in CSS px. */
	lineHeight: number;
}

const MAX_CACHE_ENTRIES = 2048;

export function measurementCapabilities(): boolean {
	return (
		typeof Intl !== "undefined" &&
		typeof (Intl as unknown as { Segmenter?: unknown }).Segmenter !==
			"undefined" &&
		typeof document !== "undefined" &&
		typeof document.createElement("canvas").getContext === "function"
	);
}

/**
 * Builds a canvas font specification from an element's computed style.
 * Returns null when the style cannot be mapped faithfully enough to bother
 * predicting (the caller then uses the legacy path).
 */
export function buildFontSpec(el: Element | null | undefined): FontSpec | null {
	if (!el) {
		return null;
	}
	const style = window.getComputedStyle(el);

	const fontFamily = style.fontFamily;
	const fontSize = parseFloat(style.fontSize);
	if (!fontFamily || !Number.isFinite(fontSize) || fontSize <= 0) {
		return null;
	}

	let lineHeight = parseFloat(style.lineHeight);
	if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
		lineHeight = fontSize * 1.14;
	}

	let letterSpacing = 0;
	const rawSpacing = style.getPropertyValue("letter-spacing");
	if (rawSpacing && rawSpacing !== "none") {
		const parsed = parseFloat(rawSpacing);
		if (Number.isFinite(parsed)) {
			letterSpacing = parsed;
		}
	}

	const whiteSpace =
		style.whiteSpace === "pre-wrap" || style.whiteSpace === "break-spaces"
			? "pre-wrap"
			: "normal";
	if (
		style.whiteSpace !== "normal" &&
		style.whiteSpace !== "pre-wrap" &&
		style.whiteSpace !== "nowrap" &&
		style.whiteSpace !== "break-spaces"
	) {
		// pre lines etc. are outside pretext's model.
		return null;
	}

	const weight = style.fontWeight || "400";
	const fontStyle = style.fontStyle && style.fontStyle !== "normal" ? style.fontStyle + " " : "";

	return {
		font: `${fontStyle}${weight} ${fontSize}px ${fontFamily}`,
		letterSpacing,
		whiteSpace,
		lineHeight,
	};
}

export class TextMeasureService {
	private cache: Map<string, PreparedTextWithSegments>;

	constructor() {
		this.cache = new Map();
	}

	/**
	 * Prepares (and caches) a text for measurement. Cache keys include every
	 * input that changes metrics.
	 */
	prepare(text: string, spec: FontSpec): PreparedTextWithSegments {
		const options: PrepareOptions = {
			whiteSpace: spec.whiteSpace,
		};
		if (spec.letterSpacing) {
			options.letterSpacing = spec.letterSpacing;
		}
		const key = `${spec.font}\u0000${spec.letterSpacing}\u0000${spec.whiteSpace}\u0000${text}`;
		let prepared = this.cache.get(key);
		if (!prepared) {
			prepared = prepareWithSegments(text, spec.font, options);
			if (this.cache.size >= MAX_CACHE_ENTRIES) {
				this.cache.clear();
			}
			this.cache.set(key, prepared);
		}
		return prepared;
	}

	/**
	 * Lays out successive lines of `prepared` at the given widths, invoking
	 * `onLine` with each range. Returns the number of lines produced.
	 *
	 * `firstMaxWidth` allows the first line to be partially occupied (when a
	 * node continues mid-line after inline siblings). `startCursor` resumes
	 * layout from a previous position (continuation reuse).
	 */
	walkLines(
		prepared: PreparedTextWithSegments,
		firstMaxWidth: number,
		maxWidth: number,
		onLine: (line: {
			start: LayoutCursor;
			end: LayoutCursor;
			width: number;
		}) => boolean | void,
		startCursor?: LayoutCursor,
	): number {
		let cursor: LayoutCursor = startCursor || {
			segmentIndex: 0,
			graphemeIndex: 0,
		};
		let count = 0;
		for (;;) {
			const width = count === 0 ? Math.max(firstMaxWidth, 1) : maxWidth;
			const line = layoutNextLineRange(prepared, cursor, width);
			if (!line) {
				return count;
			}
			count++;
			const stop = onLine({
				start: line.start,
				end: line.end,
				width: line.width,
			});
			if (stop === false) {
				return count;
			}
			cursor = line.end;
		}
	}

	/**
	 * Maps a layout cursor to a UTF-16 code-unit offset in the original
	 * string. Cursors mid-cluster resolve to the cluster start (the extra
	 * grapheme fraction is approximated proportionally within the cluster).
	 */
	cursorToOffset(prepared: PreparedTextWithSegments, cursor: LayoutCursor): number {
		const segments = prepared.segments;
		let offset = 0;
		const target = cursor.segmentIndex;
		for (let i = 0; i < target && i < segments.length; i++) {
			offset += segments[i].length;
		}
		if (target < segments.length && cursor.graphemeIndex > 0) {
			const cluster = segments[target];
			offset +=
				Math.min(cursor.graphemeIndex, cluster.length) *
				(cluster.length / [...cluster].length);
		}
		return Math.round(offset);
	}

	/**
	 * Maps a character offset to a layout cursor via prefix sums.
	 */
	offsetToCursor(prepared: PreparedTextWithSegments, offset: number): LayoutCursor {
		const segments = prepared.segments;
		let seen = 0;
		for (let i = 0; i < segments.length; i++) {
			const len = segments[i].length;
			if (seen + len > offset) {
				return { segmentIndex: i, graphemeIndex: offset - seen };
			}
			seen += len;
		}
		return { segmentIndex: segments.length, graphemeIndex: 0 };
	}
}

const sharedService = new TextMeasureService();

export function getTextMeasureService(): TextMeasureService {
	return sharedService;
}
