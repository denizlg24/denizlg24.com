import { describe, expect, test } from "bun:test";
import { destinationFromClient, destinationFromUrl } from "./destination";

describe("destinationFromUrl", () => {
  test("names a known app and keeps its host", () => {
    expect(destinationFromUrl("https://forge.denizlg24.com/targets/1")).toEqual(
      { name: "Forge", host: "forge.denizlg24.com" },
    );
  });

  test("does not repeat a host that is its own name", () => {
    expect(destinationFromUrl("https://denizlg24.com/admin")).toEqual({
      name: "denizlg24.com",
      host: null,
    });
  });

  test("falls back to the host of an unknown destination", () => {
    expect(destinationFromUrl("http://localhost:3002/")).toEqual({
      name: "localhost:3002",
      host: null,
    });
  });

  test("recognises an authorize request and carries its client", () => {
    expect(
      destinationFromUrl(
        "https://api.denizlg24.com/api/auth/oauth2/authorize?client_id=claude&scope=openid",
      ),
    ).toEqual({ name: "claude", host: null, clientId: "claude" });
  });

  test("returns null for nothing and for garbage", () => {
    expect(destinationFromUrl(null)).toBeNull();
    expect(destinationFromUrl("not a url")).toBeNull();
  });
});

describe("destinationFromClient", () => {
  test("prefers the client's name and homepage host", () => {
    expect(
      destinationFromClient("abc", {
        client_name: "Claude",
        client_uri: "https://claude.ai/",
      }),
    ).toEqual({ name: "Claude", host: "claude.ai", clientId: "abc" });
  });

  test("falls back to the id when the client is unnamed or unloaded", () => {
    expect(destinationFromClient("abc", null)).toEqual({
      name: "abc",
      host: null,
      clientId: "abc",
    });
    expect(destinationFromClient("abc", { client_name: "  " })).toEqual({
      name: "abc",
      host: null,
      clientId: "abc",
    });
  });
});
