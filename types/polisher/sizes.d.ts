/**
 * A single CSS dimension value, e.g. `{ value: 210, unit: "mm" }`.
 */
export interface Dimension {
    value: number;
    unit: string;
}
/**
 * A named page size definition with fixed width and height.
 */
export interface NamedPageSize {
    width: Dimension;
    height: Dimension;
}
/**
 * @module a js object that defines the default files size from // https://www.w3.org/TR/css3-page/#page-size-prop
 */
declare const pageSizes: Record<string, NamedPageSize>;
export default pageSizes;
