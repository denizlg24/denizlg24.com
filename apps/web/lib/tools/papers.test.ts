import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const { papersTools } = await import("./papers");

describe("papers tools", () => {
  it("registers the paper citation workflow", () => {
    expect(papersTools.map((tool) => tool.schema.name)).toEqual([
      "list_papers",
      "get_paper",
      "resolve_paper_metadata",
      "create_paper",
      "update_paper",
      "add_paper_highlight",
      "link_note_to_paper",
      "delete_paper",
    ]);
    expect(
      papersTools
        .filter(
          (tool) =>
            tool.schema.name.startsWith("create_") ||
            tool.schema.name.startsWith("update_") ||
            tool.schema.name.startsWith("delete_"),
        )
        .every((tool) => tool.isWrite),
    ).toBe(true);
  });

  it("rejects non-Mongo paper IDs before querying", async () => {
    const getPaper = papersTools.find(
      (tool) => tool.schema.name === "get_paper",
    );
    await expect(getPaper?.execute?.({ id: "not-a-paper-id" })).rejects.toThrow(
      "Invalid paper ID",
    );
  });
});
