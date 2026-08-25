/**
 * @file Unit tests for the PACS path grammar helpers (pacsHelpers.ts).
 *
 * The grammar is `<desc>_qid:<id>[_<user>][_no-hits]` for query folders and
 * `<prefix>_<uid>_<desc>` for study/series folders. These tests pin both
 * directions: names built by queryFolderName_build must round-trip through
 * the extractors.
 */

import {
  queryId_extractFromFolder,
  queryLabel_extractFromFolder,
  folderUID_get,
  queryFolderName_build,
} from "../src/vfs/providers/pacsHelpers.js";

describe("queryId_extractFromFolder", () => {
  it("extracts the id from any position in a folder or path", () => {
    expect(queryId_extractFromFolder("PatientID:123_qid:7")).toBe(7);
    expect(queryId_extractFromFolder("/net/pacs/queries/x_qid:41_chris/Study_1.2_d")).toBe(41);
  });

  it("yields NaN when no marker is present", () => {
    expect(Number.isNaN(queryId_extractFromFolder("no-marker-here"))).toBe(true);
  });
});

describe("queryLabel_extractFromFolder", () => {
  it("strips the qid marker and every suffix after it", () => {
    expect(queryLabel_extractFromFolder("PatientID:123_qid:7")).toBe("PatientID:123");
    expect(queryLabel_extractFromFolder("PatientID:123_qid:7_chris_no-hits")).toBe("PatientID:123");
  });

  it("returns a markerless folder unchanged", () => {
    expect(queryLabel_extractFromFolder("plain")).toBe("plain");
  });
});

describe("folderUID_get", () => {
  it("extracts the UID between prefix and description", () => {
    expect(folderUID_get("Study_1.2.3_BrainScan", "Study")).toBe("1.2.3");
    expect(folderUID_get("Series_4.5.6_T1_MPRAGE", "Series")).toBe("4.5.6");
  });
});

describe("queryFolderName_build", () => {
  it("builds desc, user, and no-hits parts in grammar order", () => {
    const name: string = queryFolderName_build({
      queryId: 7,
      queryObj: { PatientID: "123", StudyDate: "20260825" },
      username: "chris",
      hasResult: false,
    });
    expect(name).toBe("PatientID:123_StudyDate:20260825_qid:7_chris_no-hits");
  });

  it("omits blank query values and optional suffixes", () => {
    const name: string = queryFolderName_build({
      queryId: 9,
      queryObj: { PatientID: "42", AccessionNumber: "  " },
    });
    expect(name).toBe("PatientID:42_qid:9");
  });

  it("falls back to a scrubbed title, then to 'query'", () => {
    expect(queryFolderName_build({ queryId: 1, queryObj: {}, title: "pacs_query_brain" }))
      .toBe("brain_qid:1");
    expect(queryFolderName_build({ queryId: 2, queryObj: {}, title: "pacs_query_17_3" }))
      .toBe("query_qid:2");
    expect(queryFolderName_build({ queryId: 3, queryObj: {} })).toBe("query_qid:3");
  });

  it("round-trips through the extractors", () => {
    const name: string = queryFolderName_build({
      queryId: 55,
      queryObj: { PatientID: "777" },
      username: "rudolph",
      hasResult: true,
    });
    expect(queryId_extractFromFolder(name)).toBe(55);
    expect(queryLabel_extractFromFolder(name)).toBe("PatientID:777");
  });
});
