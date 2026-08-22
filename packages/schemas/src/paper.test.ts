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

  it("reads null as a clear on update and as not-set on create", () => {
    // On an update null is a real instruction: unset the stored value.
    const update = paperMutationSchema.safeParse({ year: null, pdf: null });
    expect(update.success).toBe(true);
    expect(update.data?.year).toBeNull();

    // On a create there is nothing to clear. Rejecting it here only moved the
    // failure into the client: the form renders an empty date input and a
    // "none" priority as null, so every reading added without a deadline was
    // refused as "Invalid paper".
    const create = createPaperSchema.safeParse({
      title: "A paper",
      year: null,
      dueAt: null,
      priority: null,
    });
    expect(create.success).toBe(true);
    expect(create.data?.year).toBeUndefined();
    expect(create.data?.dueAt).toBeUndefined();

    // Still strict about a value that is present but wrong.
    expect(
      createPaperSchema.safeParse({ title: "A paper", year: 12 }).success,
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
