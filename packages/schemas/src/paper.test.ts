import { describe, expect, it } from "bun:test";
import {
  createPaperSchema,
  paperMutationSchema,
  resolvePaperMetadataSchema,
} from "./paper";

describe("paper schemas", () => {
  it("accepts a metadata-rich paper", () => {
    const result = createPaperSchema.safeParse({
      title: "A paper",
      authors: [{ family: "Lovelace", given: "Ada" }],
      type: "article",
      year: 2025,
      doi: "10.1000/example",
      noteIds: ["507f1f77bcf86cd799439011"],
      highlights: [
        {
          id: "highlight-1",
          page: 4,
          text: "Important result",
          color: "yellow",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("keeps nullable clear operations update-only", () => {
    expect(
      paperMutationSchema.safeParse({ year: null, pdf: null }).success,
    ).toBe(true);
    expect(
      createPaperSchema.safeParse({ title: "A paper", year: null }).success,
    ).toBe(false);
  });

  it("bounds metadata identifiers", () => {
    expect(
      resolvePaperMetadataSchema.safeParse({ identifier: "" }).success,
    ).toBe(false);
    expect(
      resolvePaperMetadataSchema.safeParse({ identifier: "10.1000/example" })
        .success,
    ).toBe(true);
  });
});
