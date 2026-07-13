import { describe, expect, test } from "bun:test";
import mongoose from "mongoose";
import { selectedTraceMemories } from "./feedback";

describe("agent memory feedback", () => {
  test("only exposes candidates selected by the immutable trace", () => {
    const selectedRevisionId = new mongoose.Types.ObjectId();
    const ignoredRevisionId = new mongoose.Types.ObjectId();
    const result = selectedTraceMemories({
      selectedRevisionIds: [selectedRevisionId],
      candidates: [
        {
          memoryId: new mongoose.Types.ObjectId().toString(),
          revisionId: selectedRevisionId.toString(),
        },
        {
          memoryId: new mongoose.Types.ObjectId().toString(),
          revisionId: ignoredRevisionId.toString(),
        },
        { memoryId: "malformed" },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.revisionId).toBe(selectedRevisionId.toString());
  });
});
