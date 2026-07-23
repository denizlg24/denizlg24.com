import { describe, expect, it } from "bun:test";

import { coalesceIndexOperations } from "./batch";

describe("coalesceIndexOperations", () => {
  it("keeps a re-created document instead of applying its stale delete", () => {
    expect(
      coalesceIndexOperations([
        { type: "delete", id: "1" },
        {
          type: "upsert",
          id: "1",
          document: { id: "1", version: "re-created" },
        },
      ]),
    ).toEqual({
      upserts: [{ id: "1", version: "re-created" }],
      deletes: [],
    });
  });

  it("keeps a final delete and independent operations", () => {
    expect(
      coalesceIndexOperations([
        { type: "upsert", id: "1", document: { id: "1" } },
        { type: "upsert", id: "2", document: { id: "2" } },
        { type: "delete", id: "1" },
      ]),
    ).toEqual({
      upserts: [{ id: "2" }],
      deletes: ["1"],
    });
  });
});
