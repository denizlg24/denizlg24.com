import { describe, expect, test } from "bun:test";
import {
  dashboardPath,
  replaceAssetTokens,
  surfaceDocument,
  surfaceInboundSchema,
} from "./document";

const base = {
  nonce: "n-1",
  surface: { id: "a".repeat(24), name: "S", mount: { kind: "none" as const } },
  head: "",
  html: "",
  css: "",
  js: "",
  assets: { "logo.png": "https://cdn.example/logo.png" },
  state: {},
  theme: { scheme: "light" as const, vars: { "--background": "#fff" } },
};

describe("replaceAssetTokens", () => {
  test("replaces known names and leaves unknown tokens", () => {
    expect(
      replaceAssetTokens(
        "{{asset:logo.png}} {{ asset:logo.png }} {{asset:nope}}",
        base.assets,
      ),
    ).toBe(
      "https://cdn.example/logo.png https://cdn.example/logo.png {{asset:nope}}",
    );
  });
});

describe("surfaceDocument", () => {
  test("substitutes assets in every field", () => {
    const doc = surfaceDocument({
      ...base,
      head: '<link href="{{asset:logo.png}}">',
      html: '<img src="{{asset:logo.png}}">',
      css: "body{background:url({{asset:logo.png}})}",
      js: "const u='{{asset:logo.png}}'",
    });
    expect(doc).not.toContain("{{asset:logo.png}}");
    expect(doc.match(/https:\/\/cdn\.example\/logo\.png/g)?.length).toBe(
      // the four fields plus the assets map in the bridge's init
      5,
    );
  });

  test("cannot be broken out of by closing tags in css, js or state", () => {
    const doc = surfaceDocument({
      ...base,
      css: "</style><b>x</b>",
      js: "'</script><b>'",
      state: { note: "</script><script>bad()</script>" },
    });
    expect(doc.match(/<\/script>/g)?.length).toBe(2);
    expect(doc.match(/<\/style>/g)?.length).toBe(2);
  });

  test("a theme value cannot close the style element", () => {
    const doc = surfaceDocument({
      ...base,
      theme: { scheme: "light", vars: { "--x": "red</style><script>bad()" } },
    });
    expect(doc.match(/<\/style>/g)?.length).toBe(2);
  });

  test("the bridge listens only on its own port, never on window messages", () => {
    const doc = surfaceDocument(base);
    expect(doc).toContain("new MessageChannel()");
    expect(doc).toContain('kind: "hello"');
    expect(doc).not.toContain('addEventListener("message"');
  });

  test("puts the theme on :root and the nonce in the bridge", () => {
    const doc = surfaceDocument(base);
    expect(doc).toContain(":root { --background: #fff; color-scheme: light; }");
    expect(doc).toContain('"nonce":"n-1"');
  });
});

describe("dashboardPath", () => {
  const root = "/dashboard";
  test.each([
    ["/notes", "/dashboard/notes"],
    ["notes", "/dashboard/notes"],
    ["/dashboard/notes?id=1", "/dashboard/notes?id=1"],
    ["?tab=x", "/dashboard?tab=x"],
    ["", "/dashboard"],
    ["/", "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
    ["/../admin", "/dashboard"],
    ["/dashboardx", "/dashboard/dashboardx"],
    ["/%2e%2e/admin", "/dashboard"],
    ["/notes/..%2F..%2Fadmin", "/dashboard"],
    ["/notes/", "/dashboard/notes"],
    ["/notes#top", "/dashboard/notes#top"],
  ])("%s → %s", (input, expected) => {
    expect(dashboardPath(root, input)).toBe(expected);
  });
});

describe("surfaceInboundSchema", () => {
  test("accepts a bridge request and refuses unknown methods", () => {
    const request = {
      kind: "request",
      id: 1,
      method: "call",
      params: { tool: "catalog_read" },
    };
    expect(surfaceInboundSchema.safeParse(request).success).toBe(true);
    expect(
      surfaceInboundSchema.safeParse({ ...request, method: "eval" }).success,
    ).toBe(false);
  });
});
