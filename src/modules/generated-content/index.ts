import type Handler from "../handler.js";
import Leader from "./leader.js";
import RunningHeaders from "./running-headers.js";
import StringSets from "./string-sets.js";
import TargetCounters from "./target-counters.js";
import TargetText from "./target-text.js";

export default [
	Leader,
	RunningHeaders,
	StringSets,
	TargetCounters,
	TargetText
] as Array<typeof Handler>;
