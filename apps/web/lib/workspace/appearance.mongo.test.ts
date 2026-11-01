import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  activeThemeId,
  BUILTIN_THEMES,
  componentInputSchema,
  DEFAULT_THEME_ID,
  parseIconValue,
  themeInputSchema,
} from "@repo/schemas";
import type { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { WorkspacePageModel } from "@/models/WorkspacePage";
import {
  addScheduleEntry,
  createTheme,
  deleteTheme,
  getAppearance,
  listThemes,
  patchAppearance,
  updateTheme,
} from "./appearance";
import {
  createComponent,
  deleteComponent,
  getComponent,
  listComponents,
  updateComponent,
} from "./components";
import { mongoWorkspaceRepo } from "./mongo-repo";
import { createWorkspaceService, OWNER, WorkspaceError } from "./service";

/*
 * Themes, appearance, the component library and page styles against a real
 * mongod. Off by default like the other mongo suites; `bun run test:mongo`.
 */

const enabled = process.env.WORKSPACE_MONGO_TESTS === "1";
const MONGOD_VERSION = "8.2.1";

const christmas = {
  name: "Christmas 2026",
  colors: {
    background: "#fbf8f3",
    foreground: "#2f4a3a",
    surface: "#f1ece2",
    muted: "#dfe6d9",
    mutedForeground: "#3e5546",
    accent: "#c0392b",
    accentStrong: "#1f3d2b",
    border: "#e3dccd",
  },
  effect: { kind: "snow" as const, density: 0.5 },
};

async function rejects(promise: Promise<unknown>, status: number) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceError);
    if (error instanceof WorkspaceError) expect(error.status).toBe(status);
    return;
  }
  throw new Error("expected a rejection");
}

describe("theme and component schemas", () => {
  test("theme CSS refuses anything that can fetch", () => {
    for (const css of [
      "body { background: url(https://x.y/a.png) }",
      "@import 'https://x.y/a.css';",
      "a { background: URL ( //x.y ) }",
      "</style><script>alert(1)</script>",
    ]) {
      expect(themeInputSchema.safeParse({ ...christmas, css }).success).toBe(
        false,
      );
    }
    expect(
      themeInputSchema.safeParse({
        ...christmas,
        css: "h1 { letter-spacing: -0.02em }",
      }).success,
    ).toBe(true);
    expect(
      themeInputSchema.safeParse({
        ...christmas,
        colors: { ...christmas.colors, accent: "url(x)" },
      }).success,
    ).toBe(false);
  });

  test("icon values: lucide, react-icons and emoji", () => {
    expect(parseIconValue("icon:tree-pine:green")).toEqual({
      kind: "icon",
      name: "tree-pine",
      color: "green",
    });
    expect(parseIconValue("ri:si:SiSpotify")).toEqual({
      kind: "react-icon",
      set: "si",
      name: "SiSpotify",
      color: "default",
    });
    expect(parseIconValue("ri:nope:SiSpotify").kind).toBe("emoji");
    expect(parseIconValue("ri:si:../x").kind).toBe("emoji");
    expect(parseIconValue("🎄")).toEqual({ kind: "emoji", value: "🎄" });
  });

  test("a spec component needs its tree", () => {
    expect(
      componentInputSchema.safeParse({ name: "x", kind: "spec" }).success,
    ).toBe(false);
    expect(
      componentInputSchema.safeParse({ name: "x", kind: "html", html: "<b>" })
        .success,
    ).toBe(true);
  });

  test("the latest-starting schedule entry covering the day wins", () => {
    const appearance = {
      themeId: DEFAULT_THEME_ID,
      schedule: [
        {
          id: "a",
          themeId: "winter",
          from: "2026-11-01",
          to: "2027-02-28",
          label: "",
        },
        {
          id: "b",
          themeId: "xmas",
          from: "2026-12-01",
          to: "2026-12-31",
          label: "",
        },
      ],
    };
    expect(activeThemeId(appearance, "2026-10-31")).toBe(DEFAULT_THEME_ID);
    expect(activeThemeId(appearance, "2026-11-15")).toBe("winter");
    expect(activeThemeId(appearance, "2026-12-24")).toBe("xmas");
    expect(activeThemeId(appearance, "2027-01-02")).toBe("winter");
  });
});

describe.skipIf(!enabled)("appearance on a real mongod", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    server = await MongoMemoryServer.create({
      binary: { version: MONGOD_VERSION },
    });
    const uri = server.getUri("appearance-test");
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\//.test(uri)) {
      throw new Error(`Refusing a non-local mongod: ${uri}`);
    }
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  test("themes: create, schedule, edit, and delete cascades the schedule", async () => {
    expect((await getAppearance()).themeId).toBe(DEFAULT_THEME_ID);
    const theme = await createTheme(christmas, "conversation:abc");
    expect(theme.createdBy).toBe("conversation:abc");
    expect(theme.builtin).toBe(false);
    expect((await listThemes()).map((t) => t.id)).toEqual([
      ...BUILTIN_THEMES.map((t) => t.id),
      theme.id,
    ]);

    const scheduled = await addScheduleEntry({
      themeId: theme.id,
      from: "2026-11-01",
      to: "2027-01-06",
      label: "Holidays",
    });
    expect(scheduled.schedule).toHaveLength(1);
    expect(activeThemeId(scheduled, "2026-12-24")).toBe(theme.id);
    await rejects(
      addScheduleEntry({
        themeId: "nope",
        from: "2026-01-01",
        to: "2026-01-02",
      }),
      404,
    );

    const edited = await updateTheme(theme.id, {
      colors: { accent: "#b3261e" },
      effect: { density: 0.8 },
    });
    expect(edited.colors.accent).toBe("#b3261e");
    expect(edited.colors.background).toBe(christmas.colors.background);
    expect(edited.effect).toEqual({ kind: "snow", density: 0.8 });
    await rejects(updateTheme("builtin:sage", { name: "Mine" }), 409);
    await rejects(deleteTheme("builtin:sage"), 409);

    await patchAppearance({ themeId: theme.id, textScale: 1.1 });
    await deleteTheme(theme.id);
    const after = await getAppearance();
    expect(after.themeId).toBe(DEFAULT_THEME_ID);
    expect(after.schedule).toEqual([]);
    expect(after.textScale).toBe(1.1);
  });

  test("components: create, list, patch and delete", async () => {
    const created = await createComponent(
      {
        name: "Countdown",
        kind: "spec",
        spec: { id: "root", type: "countdown", value: "{{props.date}}" },
        props: [{ name: "date", type: "date", default: "2026-12-25" }],
      },
      "owner",
    );
    expect((await listComponents()).map((c) => c.name)).toEqual(["Countdown"]);
    const patched = await updateComponent(created.id, {
      kind: "html",
      html: "<b>hi</b>",
    });
    expect(patched.kind).toBe("html");
    expect(patched.spec).toEqual(created.spec);
    await deleteComponent(created.id);
    await rejects(getComponent(created.id), 404);
  });

  test("a page style is stored only when set and clears with null", async () => {
    const service = createWorkspaceService(mongoWorkspaceRepo);
    await service.ensureMigrated();
    const page = await service.createPage(
      {
        title: "Holidays",
        icon: "icon:tree-pine:green",
        style: { cover: "gradient:festive", width: "narrow" },
      },
      OWNER,
    );
    expect(page.style).toEqual({ cover: "gradient:festive", width: "narrow" });
    expect(page.icon).toBe("icon:tree-pine:green");

    const themed = await service.updateMeta(
      page.id,
      { style: { ...page.style, themeId: "builtin:christmas" } },
      OWNER,
    );
    expect(themed.style?.themeId).toBe("builtin:christmas");

    const cleared = await service.updateMeta(page.id, { style: null }, OWNER);
    expect(cleared.style).toBeUndefined();
    const raw = await WorkspacePageModel.findById(page.id).lean().exec();
    expect(raw && "style" in raw).toBe(false);

    const reverted = await service.revertToRev(page.id, themed.rev, OWNER);
    expect(reverted.style?.themeId).toBe("builtin:christmas");
  });
});
