const { toMatchImageSnapshot } = require("jest-image-snapshot");
const toMatchPDFSnapshot = require("./pdf_snapshot.cjs");

expect.extend({ toMatchImageSnapshot, toMatchPDFSnapshot });
