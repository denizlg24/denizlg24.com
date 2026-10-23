import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { versionedMacrosApiPath } from "@repo/schemas/macros";
import nextConfig from "../../next.config.mjs";
import { V1_API_ROOTS, v1ApiRewrites } from "./versioning.mjs";

describe("v1 compatibility routing", () => {
  test("every public legacy route root has a stable v1 alias", async () => {
    const roots = await readdir(new URL("../../app/api", import.meta.url));
    const excluded = new Set(["auth", "admin", "cron"]);
    expect([...V1_API_ROOTS].sort()).toEqual(
      roots
        .filter((root) => !excluded.has(root) && !/^v\d+$/.test(root))
        .sort(),
    );
  });

  test("aliases are internal fallbacks to v1's legacy handlers, not redirects", async () => {
    const rewrites = nextConfig.rewrites;
    if (!rewrites) throw new Error("The v1 compatibility rewrites are missing");
    expect(await rewrites()).toEqual({ fallback: v1ApiRewrites() });
    for (const root of V1_API_ROOTS) {
      expect(v1ApiRewrites()).toContainEqual({
        source: `/api/v1/${root}/:path*`,
        destination: `/api/${root}/:path*`,
      });
    }
    expect(v1ApiRewrites().some((route) => route.source.includes("v2"))).toBe(
      false,
    );
  });

  test("clients pin feature calls, including uploads and private images", () => {
    for (const path of [
      "/api/profile",
      "/api/foods/search?q=rolled%20oats&limit=25",
      "/api/pantry",
      "/api/vision/label",
      "/api/recipes/images/abc?thumbnail=1",
      "/api/body/photos/abc",
    ]) {
      expect(versionedMacrosApiPath(path)).toBe(`/api/v1${path.slice(4)}`);
    }
    expect(versionedMacrosApiPath("api/profile")).toBe("/api/v1/profile");
  });

  test("auth, assets and explicit versions keep their contracts", () => {
    for (const path of [
      "/api/auth/get-session",
      "/api/auth?callback=1",
      "/food-icons/fruit-007.png?v=hash",
      "/register/verified",
      "/api/v1/foods",
      "/api/v2/foods",
    ]) {
      expect(versionedMacrosApiPath(path)).toBe(path);
    }
  });
});
