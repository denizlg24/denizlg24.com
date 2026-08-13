import { describe, expect, it } from "bun:test";

import {
  namespaceTieringReportSchema,
  storedNamespaceTieringReportSchema,
} from "./storage";
import { taskRunMetadataSchema } from "./tasks";

/**
 * `task_runs.metadata` is written once and read back forever, so a field added
 * to the report is a field every run recorded before it lacks. The strict shape
 * rejected those rows and took the whole tasks response down with them.
 */
const historicReport = {
  dryRun: false,
  blockedBy: null,
  ssd: null,
  hdd: null,
  eligible: 12,
  onSsd: 9,
  bytesToFree: 1024,
  planned: [
    {
      fileId: "6f2b3c1e-6b2f-4a1a-9c4e-3b8f1d2a5c77",
      relativePath: "media/clip.mov",
      from: "ssd",
      to: "hdd",
      sizeBytes: 512,
    },
  ],
  applied: [],
  quarantined: [],
  failures: [],
};

describe("stored namespace tiering report", () => {
  it("parses a run recorded before verified and planReason existed", () => {
    const parsed = taskRunMetadataSchema.parse({
      namespaceTiering: historicReport,
    });
    expect(parsed.namespaceTiering?.verified).toBeUndefined();
    expect(parsed.namespaceTiering?.planned[0]?.planReason).toBeUndefined();
  });

  it("keeps both fields when the run does carry them", () => {
    const parsed = taskRunMetadataSchema.parse({
      namespaceTiering: {
        ...historicReport,
        verified: 4,
        planned: [{ ...historicReport.planned[0], planReason: "large" }],
      },
    });
    expect(parsed.namespaceTiering?.verified).toBe(4);
    expect(parsed.namespaceTiering?.planned[0]?.planReason).toBe("large");
  });

  it("still owes the full shape when a pass produces a report", () => {
    // Leniency is for history only: a new writer must not be able to omit the
    // count that decides whether anything can move at all.
    expect(() => namespaceTieringReportSchema.parse(historicReport)).toThrow();
    expect(() =>
      storedNamespaceTieringReportSchema.parse(historicReport),
    ).not.toThrow();
  });
});
