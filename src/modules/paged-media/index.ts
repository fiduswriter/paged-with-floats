import type Handler from "../handler.js";
import AtPage from "./atpage.js";
import Breaks from "./breaks.js";
import BoxDecoration from "./box-decoration.js";
import PrintMedia from "./print-media.js";
import Splits from "./splits.js";
import Counters from "./counters.js";
import Lists from "./lists.js";
import PositionFixed from "./position-fixed.js";
import PageCounterIncrement from "./page-counter-increment.js";
import NthOfType from "./nth-of-type.js";
import Following from "./following.js";
import Footnotes from "./footnotes.js";
import PageFloats from "./page-floats.js";
import Columns from "./columns.js";
import InitialLetter from "./initial-letter.js";

const handlers: Array<typeof Handler> = [
	PrintMedia,
	AtPage,
	Breaks,
	Splits,
	BoxDecoration,
	Counters,
	Lists,
	PositionFixed,
	PageCounterIncrement,
	NthOfType,
	Following,
	Footnotes,
	PageFloats,
	Columns,
	InitialLetter,
];

export default handlers;
