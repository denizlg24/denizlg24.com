import { describe, expect, it } from "bun:test";
import {
  macrosCreateRecipeBodySchema,
  macrosUpdateRecipeBodySchema,
} from "@repo/schemas/macros";
import {
  isJpeg,
  ownsRecipeImage,
  recipeImageUrl,
  validateRecipeImages,
  withImageUrls,
} from "./images";

const image = "e0bd7db5-01d1-4884-8b1c-45cf942e8527.jpg";
describe("recipe media ownership", () => {
  it("accepts only a photo in this account’s recipe prefix", () => {
    expect(ownsRecipeImage("alice", `users/alice/recipes/${image}`)).toBe(true);
    for (const key of [
      `users/bob/recipes/${image}`,
      `users/alice/progress/${image}`,
      `users/alice/recipes/../${image}`,
      `users/alice/recipes/${image}.svg`,
    ]) {
      expect(ownsRecipeImage("alice", key)).toBe(false);
    }
  });
  it("rejects a foreign object before contacting storage", async () => {
    await expect(
      validateRecipeImages("alice", {
        coverImageKey: `users/bob/recipes/${image}`,
      }),
    ).rejects.toThrow("does not belong");
    await expect(
      validateRecipeImages("alice", {
        steps: [
          {
            title: "",
            blocks: [{ type: "image", imageKey: `users/bob/recipes/${image}` }],
          },
        ],
      }),
    ).rejects.toThrow("does not belong");
  });
  it("keeps private storage prefixes out of public image URLs", () => {
    expect(recipeImageUrl("recipe", `users/alice/recipes/${image}`)).toBe(
      `/api/recipes/recipe/images/${image}`,
    );
    expect(recipeImageUrl("recipe", null)).toBeNull();
  });
});
describe("recipe article contracts", () => {
  const body = {
    name: "Oats",
    servings: 2,
    totalWeightGrams: 400,
    ingredients: [
      {
        sourceItemId: "c1a683cc-e250-448c-ad8f-3ae6c2ef0853",
        servingsConsumed: 1.5,
      },
    ],
  };
  it("keeps older app writes compatible", () => {
    expect(macrosCreateRecipeBodySchema.safeParse(body).success).toBe(true);
  });
  it("refuses links that are not http(s)", () => {
    for (const href of [
      "javascript:alert(1)",
      " JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:x",
      "/relative",
    ]) {
      expect(
        macrosCreateRecipeBodySchema.safeParse({
          ...body,
          story: [{ type: "paragraph", content: [{ text: "x", href }] }],
        }).success,
      ).toBe(false);
    }
  });
  it("rejects block types it does not know", () => {
    expect(
      macrosCreateRecipeBodySchema.safeParse({
        ...body,
        story: [{ type: "html", html: "<img src=x onerror=alert(1)>" }],
      }).success,
    ).toBe(false);
  });
  it("allows clearing images and unpublishing without replacing other content", () => {
    const parsed = macrosUpdateRecipeBodySchema.parse({
      name: "Oats",
      servings: 2,
      totalWeightGrams: 400,
      coverImageKey: null,
      isPublished: false,
    });
    expect(parsed.coverImageKey).toBeNull();
    expect(parsed.isPublished).toBe(false);
    expect(parsed.steps).toBeUndefined();
  });
  it("bounds article text and step counts", () => {
    expect(
      macrosCreateRecipeBodySchema.safeParse({
        ...body,
        description: "a".repeat(601),
      }).success,
    ).toBe(false);
    expect(
      macrosCreateRecipeBodySchema.safeParse({
        ...body,
        steps: Array.from({ length: 61 }, () => ({
          title: "Step",
          blocks: [],
        })),
      }).success,
    ).toBe(false);
  });
});
describe("recipe image bytes", () => {
  it("accepts only JPEG magic", () => {
    expect(isJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(isJpeg(new TextEncoder().encode("<svg onload=alert(1)>"))).toBe(
      false,
    );
    expect(isJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
  it("replaces any supplied image url with the served route", () => {
    const { story } = withImageUrls("recipe", {
      story: [
        {
          type: "image",
          imageKey: `users/alice/recipes/${image}`,
          imageUrl: "javascript:alert(1)",
        },
      ],
    });
    expect(story[0]).toMatchObject({
      imageUrl: `/api/recipes/recipe/images/${image}`,
    });
  });
});
