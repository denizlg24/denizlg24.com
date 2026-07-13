import { describe, expect, test } from "bun:test";
import { parseMigrationOptions } from "./migrate-agent-memory";

describe("agent-memory migration CLI", () => {
  test("is a non-writing dry-run by default", () => {
    expect(parseMigrationOptions([])).toEqual({
      execute: false,
      formationBatchSize: 8,
      generation: "full-v1",
      maxJobs: Number.POSITIVE_INFINITY,
      skipConversations: false,
    });
  });

  test("accepts bounded resumable execution options", () => {
    expect(
      parseMigrationOptions([
        "--execute",
        "--formation-batch-size=12",
        "--generation=full-v2",
        "--max-jobs=100",
        "--skip-conversations",
      ]),
    ).toEqual({
      execute: true,
      formationBatchSize: 12,
      generation: "full-v2",
      maxJobs: 100,
      skipConversations: true,
    });
  });

  test("rejects invalid limits and generation keys", () => {
    expect(() => parseMigrationOptions(["--max-jobs=0"])).toThrow(
      "positive integer",
    );
    expect(() => parseMigrationOptions(["--generation=Full:v2"])).toThrow(
      "--generation",
    );
    expect(() => parseMigrationOptions(["--formation-batch-size=21"])).toThrow(
      "1 to 20",
    );
  });
});
