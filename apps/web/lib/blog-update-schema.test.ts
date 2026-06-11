import { describe, expect, test } from "bun:test";
import { blogUpdateSchema } from "@repo/schemas";

describe("blogUpdateSchema", () => {
  test("accepts a full valid update body", () => {
    const result = blogUpdateSchema.safeParse({
      title: "Updated title",
      excerpt: "Updated excerpt",
      content: "Updated content",
      tags: ["tag-one", "tag-two"],
      media: ["https://example.com/image.png"],
      isActive: true,
    });
    expect(result.success).toBe(true);
  });

  test("accepts a partial body", () => {
    const result = blogUpdateSchema.safeParse({ title: "x" });
    expect(result.success).toBe(true);
  });

  test("rejects unknown field createdAt", () => {
    const result = blogUpdateSchema.safeParse({ createdAt: "2020-01-01" });
    expect(result.success).toBe(false);
  });

  test("rejects unknown field slug", () => {
    const result = blogUpdateSchema.safeParse({ slug: "x" });
    expect(result.success).toBe(false);
  });

  test("rejects wrong type for tags", () => {
    const result = blogUpdateSchema.safeParse({ tags: "not-an-array" });
    expect(result.success).toBe(false);
  });
});
