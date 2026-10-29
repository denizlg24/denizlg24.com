import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Workspace } from "@repo/schemas";
import { NextRequest, type NextResponse } from "next/server";

type Doc = { _id: string; data: Workspace };
type Filter = { _id: string; "data.savedAt"?: string | null };
type Update = {
  $set?: { data: Workspace };
  $setOnInsert?: { data: Workspace };
};

let stored: Doc | null = null;

const matches = (filter: Filter) =>
  stored !== null &&
  (!("data.savedAt" in filter) ||
    (stored.data.savedAt ?? null) === filter["data.savedAt"]);

mock.module("@/lib/require-admin", () => ({
  requireAdmin: mock(async () => null as NextResponse | null),
}));
mock.module("@/lib/mongodb", () => ({ connectDB: mock(async () => {}) }));
mock.module("@/models/DesktopWorkspace", () => ({
  DesktopWorkspace: {
    findById: () => ({ lean: () => ({ exec: async () => stored }) }),
    updateOne: (
      filter: Filter,
      update: Update,
      options?: { upsert?: boolean },
    ) => ({
      exec: async () => {
        if (matches(filter)) {
          const data = update.$set?.data;
          if (stored && data) stored = { ...stored, data };
          return { matchedCount: 1, upsertedCount: 0 };
        }
        const data = update.$set?.data ?? update.$setOnInsert?.data;
        if (!stored && options?.upsert && data) {
          stored = { _id: filter._id, data };
          return { matchedCount: 0, upsertedCount: 1 };
        }
        return { matchedCount: 0, upsertedCount: 0 };
      },
    }),
  },
}));

const { GET, PUT } = await import("./route");

function workspace(savedAt: string, title = "Home"): Workspace {
  return {
    version: 1,
    savedAt,
    pages: {
      home: {
        id: "home",
        title,
        icon: null,
        parentId: null,
        order: 0,
        blocks: [],
        fullWidth: false,
        locked: false,
        createdAt: savedAt,
        updatedAt: savedAt,
        deletedAt: null,
      },
    },
    favorites: [],
    recents: [],
    sidebar: {
      width: 248,
      collapsed: false,
      hiddenModules: [],
      collapsedSections: [],
      expandedPages: [],
    },
  };
}

const put = (body: object) =>
  PUT(
    new NextRequest("http://localhost/api/admin/workspace", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  );

const T1 = "2026-10-01T00:00:00.000Z";
const T2 = "2026-10-02T00:00:00.000Z";
const T3 = "2026-10-03T00:00:00.000Z";

beforeEach(() => {
  stored = null;
});

describe("PUT /api/admin/workspace", () => {
  test("writes a save based on the stored copy", async () => {
    stored = { _id: "singleton", data: workspace(T1) };
    const res = await put({ ...workspace(T2, "Mine"), baseSavedAt: T1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ savedAt: T2 });
    expect(stored?.data.pages.home?.title).toBe("Mine");
  });

  test("refuses a save based on an older copy and returns the stored one", async () => {
    stored = { _id: "singleton", data: workspace(T2, "Elsewhere") };
    const res = await put({ ...workspace(T3, "Stale"), baseSavedAt: T1 });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.workspace.savedAt).toBe(T2);
    expect(body.workspace.pages.home.title).toBe("Elsewhere");
    expect(stored?.data.pages.home?.title).toBe("Elsewhere");
  });

  test("a null base creates the document, and is refused once one exists", async () => {
    const first = await put({ ...workspace(T1), baseSavedAt: null });
    expect(first.status).toBe(200);
    expect(stored?.data.savedAt).toBe(T1);

    const second = await put({ ...workspace(T2, "Other"), baseSavedAt: null });
    expect(second.status).toBe(409);
    expect(stored?.data.pages.home?.title).toBe("Home");
  });

  test("a save without a base is written unconditionally", async () => {
    stored = { _id: "singleton", data: workspace(T3) };
    const res = await put(workspace(T1, "Legacy"));
    expect(res.status).toBe(200);
    expect(stored?.data.pages.home?.title).toBe("Legacy");
  });

  test("an invalid body is a 400", async () => {
    const res = await put({ version: 2 });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/workspace", () => {
  test("returns the stored copy, or null", async () => {
    const request = new NextRequest("http://localhost/api/admin/workspace");
    expect(await (await GET(request)).json()).toEqual({ workspace: null });
    stored = { _id: "singleton", data: workspace(T1) };
    const body = await (await GET(request)).json();
    expect(body.workspace.savedAt).toBe(T1);
  });
});
