/**
 * Derived from vivliostyle-pdf (https://github.com/fiduswriter/vivliostyle-pdf)
 * LGPL-3.0-or-later © Johannes Wilm. Adapted for paged-with-floats output.
 */
/**
 * Re-export low-level @pdfme/pdf-lib helpers that are present in the bundled
 * JS but omitted from the published type declarations.
 */
export { PDFNumber, PDFOperator, concatTransformationMatrix, popGraphicsState, pushGraphicsState } from "@pdfme/pdf-lib";
/** Operator names used when building PDFOperator instances. */
export declare const OperatorNames: {
    readonly PushGraphicsState: "q";
    readonly PopGraphicsState: "Q";
    readonly ConcatTransformationMatrix: "cm";
};
