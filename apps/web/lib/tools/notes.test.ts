import { describe, expect, test } from "bun:test";
import { notesTools } from "./notes";

describe("notes tools", () => {
  test("rejects an evidence UUID before querying MongoDB", async () => {
    const getNote = notesTools.find((tool) => tool.schema.name === "get_note");

    expect(getNote?.execute).toBeDefined();
    await expect(
      getNote?.execute?.({ id: "7ef113ee-c6d7-4b2d-b79f-b676eb2eb7eb" }),
    ).rejects.toThrow(
      "Invalid note ID. Use the _id returned by list_notes or search_notes.",
    );
  });
});
