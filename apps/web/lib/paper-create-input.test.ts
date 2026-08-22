import { describe, expect, it } from "bun:test";
import { createPaperSchema, paperMutationSchema } from "@repo/schemas";

/**
 * The form renders an empty date input and a "none" priority as `null`, which
 * is what an update needs to clear a field. A create has nothing to clear, so
 * the same payload must be accepted rather than 400 — every reading added
 * without a deadline went through this path.
 */
describe("create paper input", () => {
  const minimal = {
    title: "Lecture 3 notes",
    authors: [{ literal: "Ada Lovelace" }],
    type: "notes" as const,
  };

  it("accepts null for a field that was simply never filled in", () => {
    const result = createPaperSchema.safeParse({
      ...minimal,
      dueAt: null,
      priority: null,
      year: null,
      pdf: null,
      progress: null,
    });

    expect(result.success).toBe(true);
    expect(result.data?.dueAt).toBeUndefined();
    expect(result.data?.priority).toBeUndefined();
    expect(result.data?.year).toBeUndefined();
  });

  it("accepts the empty strings the form sends for untouched text fields", () => {
    const result = createPaperSchema.safeParse({
      ...minimal,
      abstract: "",
      venue: "",
      doi: "",
      arxivId: "",
      url: "",
      isbn: [],
      issn: [],
      tags: [],
      courseIds: [],
    });

    expect(result.success).toBe(true);
  });

  it("still rejects a value of the wrong type rather than coercing it", () => {
    expect(
      createPaperSchema.safeParse({ ...minimal, dueAt: "not-a-date" }).success,
    ).toBe(false);
    expect(
      createPaperSchema.safeParse({ ...minimal, priority: "someday" }).success,
    ).toBe(false);
    expect(createPaperSchema.safeParse({ ...minimal, title: "" }).success).toBe(
      false,
    );
  });

  it("keeps null meaningful on an update, where it clears the field", () => {
    const result = paperMutationSchema.safeParse({
      dueAt: null,
      priority: null,
    });

    expect(result.success).toBe(true);
    expect(result.data?.dueAt).toBeNull();
    expect(result.data?.priority).toBeNull();
  });
});
