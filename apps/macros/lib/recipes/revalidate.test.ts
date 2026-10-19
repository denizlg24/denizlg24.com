import { describe, expect, it } from "bun:test";
import { publicRecipePaths, revalidatePublicRecipes } from "./revalidate";

describe("publicRecipePaths", () => {
  it("covers each recipe, its share image and every listing", () => {
    expect(publicRecipePaths(["a", "a", "b"])).toEqual([
      { path: "/recipes/a" },
      { path: "/recipes/a/opengraph-image-100n5u" },
      { path: "/recipes/b" },
      { path: "/recipes/b/opengraph-image-100n5u" },
      { path: "/recipes" },
      { path: "/(site)/recipes/page/[n]", type: "page" },
      { path: "/sitemap.xml" },
    ]);
  });
});

describe("revalidatePublicRecipes", () => {
  it("does not throw outside a request", () => {
    expect(() => revalidatePublicRecipes(["a"])).not.toThrow();
  });
});
