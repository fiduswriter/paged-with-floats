import type Handler from "../handler.js";
import WhiteSpaceFilter from "./whitespace.js";
import CommentsFilter from "./comments.js";
import ScriptsFilter from "./scripts.js";
import UndisplayedFilter from "./undisplayed.js";

const handlers: Array<typeof Handler> = [
	WhiteSpaceFilter,
	CommentsFilter,
	ScriptsFilter,
	UndisplayedFilter
];

export default handlers;
