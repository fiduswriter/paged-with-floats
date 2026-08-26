/**
 * Opt-in counters for layout-triggering DOM reads performed by paged-with-floats.
 *
 * Installed lazily (settings.debugDomOps or window.__PAGED_DEBUG.domops)
 * by wrapping the relevant prototype accessors; zero overhead otherwise.
 * These count JavaScript-level reads; engine-side layouts are visible via
 * CDP Performance.getMetrics (LayoutCount) in test harnesses.
 */
export interface DomOpStats {
    rectReads: number;
    rectsReads: number;
    rangeRectReads: number;
    scrollReads: number;
    clientReads: number;
    offsetReads: number;
    installed: boolean;
}
export declare function getDomOpStats(): DomOpStats;
export declare function resetDomOpStats(): void;
export declare function installDomOperationCounters(): void;
