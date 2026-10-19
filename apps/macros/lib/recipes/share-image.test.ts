import { describe, expect, it } from "bun:test";
import { normalizeMetadataRoute } from "next/dist/lib/metadata/get-metadata-route";
import { RECIPE_ROUTE_SEGMENT, recipeShareImagePath } from "./share-image";

describe("recipeShareImagePath", () => {
  it("matches the route Next builds for the recipe opengraph-image", () => {
    const route = normalizeMetadataRoute(
      `${RECIPE_ROUTE_SEGMENT}/opengraph-image`,
    );
    expect(
      route
        .replace(/\/route$/, "")
        .replace(RECIPE_ROUTE_SEGMENT, "/recipes/abc"),
    ).toBe(recipeShareImagePath("abc"));
  });
});
