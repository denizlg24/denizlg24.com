import { describe, expect, it } from "bun:test";

import {
  davHref,
  davPathToStorage,
  destinationPath,
  storagePathToDav,
} from "./mapping";

const USER_ID = "10000000-0000-4000-8000-000000000001";

describe("dav path mapping", () => {
  it("maps the aliases onto their storage roots", () => {
    expect(davPathToStorage("/", USER_ID)).toEqual({ kind: "root" });
    expect(davPathToStorage("/home", USER_ID)).toEqual({
      kind: "storage",
      path: `/${USER_ID}`,
    });
    expect(davPathToStorage("/shared/notes", USER_ID)).toEqual({
      kind: "storage",
      path: "/shared/notes",
    });
  });

  it("percent-decodes segments", () => {
    expect(davPathToStorage("/home/My%20Report.pdf", USER_ID)).toEqual({
      kind: "storage",
      path: `/${USER_ID}/My Report.pdf`,
    });
  });

  it("refuses traversal and encoded separators", () => {
    expect(davPathToStorage("/home/../shared", USER_ID)).toBeNull();
    expect(davPathToStorage("/home/%2e%2e/shared", USER_ID)).toBeNull();
    // %2F would otherwise smuggle a second path segment through one name.
    expect(davPathToStorage("/home/a%2Fb", USER_ID)).toBeNull();
    expect(davPathToStorage("/home/%ZZ", USER_ID)).toBeNull();
  });

  it("refuses paths outside the two aliases", () => {
    expect(davPathToStorage(`/${USER_ID}`, USER_ID)).toBeNull();
    expect(davPathToStorage("/etc", USER_ID)).toBeNull();
  });

  it("round-trips storage paths back to dav paths", () => {
    expect(storagePathToDav(`/${USER_ID}`, USER_ID)).toBe("/home");
    expect(storagePathToDav(`/${USER_ID}/a/b.txt`, USER_ID)).toBe(
      "/home/a/b.txt",
    );
    expect(storagePathToDav("/shared", USER_ID)).toBe("/shared");
    expect(storagePathToDav("/other-user/x", USER_ID)).toBeNull();
  });

  it("marks collections with a trailing slash and encodes segments", () => {
    expect(davHref("/dav", "/home/My Report.pdf", false)).toBe(
      "/dav/home/My%20Report.pdf",
    );
    expect(davHref("/dav", "/home", true)).toBe("/dav/home/");
    expect(davHref("/dav", "/", true)).toBe("/dav/");
  });

  it("takes only the path from a Destination header", () => {
    expect(
      destinationPath("https://api.denizlg24.com/dav/home/b.txt", "/dav"),
    ).toBe("/home/b.txt");
    expect(destinationPath("/dav/home/b.txt", "/dav")).toBe("/home/b.txt");
    expect(destinationPath("/dav/home/sub/", "/dav")).toBe("/home/sub");
    expect(destinationPath("/dav", "/dav")).toBe("/");
    expect(destinationPath("/elsewhere/x", "/dav")).toBeNull();
  });
});
