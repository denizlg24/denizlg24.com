import { describe, expect, it } from "bun:test";

import {
  DavLockStore,
  MAX_LOCK_TIMEOUT_SECONDS,
  parseIfHeader,
  parseLockOwner,
  parseLockTokenHeader,
  parseTimeoutHeader,
  renderActiveLock,
} from "./locks";

const USER_ID = "10000000-0000-4000-8000-000000000001";

function lockOn(store: DavLockStore, path: string, depth: "0" | "infinity") {
  return store.create({
    path,
    depth,
    owner: "finder",
    timeoutSeconds: 600,
    userId: USER_ID,
  });
}

describe("dav lock store", () => {
  it("blocks a write that does not present the token", () => {
    const store = new DavLockStore();
    const lock = lockOn(store, "/u/a.txt", "0");
    expect(store.blocking("/u/a.txt", [])).not.toBeNull();
    expect(store.blocking("/u/a.txt", [lock.token])).toBeNull();
    expect(store.blocking("/u/b.txt", [])).toBeNull();
  });

  it("extends a depth-infinity lock over descendants", () => {
    const store = new DavLockStore();
    lockOn(store, "/u/dir", "infinity");
    expect(store.covering("/u/dir/deep/file.txt")).not.toBeNull();
    expect(store.covering("/u/dirother")).toBeNull();
  });

  it("does not extend a depth-0 lock over descendants", () => {
    const store = new DavLockStore();
    lockOn(store, "/u/dir", "0");
    expect(store.covering("/u/dir/file.txt")).toBeNull();
  });

  it("expires locks by timeout", () => {
    const store = new DavLockStore();
    const now = Date.now();
    store.create(
      {
        path: "/u/a.txt",
        depth: "0",
        owner: "",
        timeoutSeconds: 60,
        userId: USER_ID,
      },
      now,
    );
    expect(store.covering("/u/a.txt", now + 59_000)).not.toBeNull();
    expect(store.covering("/u/a.txt", now + 61_000)).toBeNull();
  });

  it("refreshes an existing lock rather than issuing a new token", () => {
    const store = new DavLockStore();
    const lock = lockOn(store, "/u/a.txt", "0");
    const refreshed = store.refresh(lock.token, 900);
    expect(refreshed?.token).toBe(lock.token);
    expect(refreshed?.timeoutSeconds).toBe(900);
    expect(store.refresh("opaquelocktoken:missing", 900)).toBeNull();
  });

  it("releases a deleted subtree and retargets a moved one", () => {
    const store = new DavLockStore();
    lockOn(store, "/u/dir", "infinity");
    lockOn(store, "/u/dir/a.txt", "0");
    store.retargetSubtree("/u/dir", "/u/moved");
    expect(store.covering("/u/moved/a.txt")).not.toBeNull();
    store.releaseSubtree("/u/moved");
    expect(store.size).toBe(0);
  });
});

describe("dav lock headers", () => {
  it("parses Timeout values and clamps Infinite", () => {
    expect(parseTimeoutHeader("Second-120")).toBe(120);
    expect(parseTimeoutHeader("Infinite, Second-120")).toBe(
      MAX_LOCK_TIMEOUT_SECONDS,
    );
    expect(parseTimeoutHeader(undefined)).toBe(3_600);
    expect(parseTimeoutHeader("garbage")).toBe(3_600);
  });

  it("extracts only lock tokens from an If header", () => {
    expect(
      parseIfHeader('(<opaquelocktoken:abc> ["etag"]) (<http://other>)'),
    ).toEqual(["opaquelocktoken:abc"]);
    expect(parseIfHeader(undefined)).toEqual([]);
  });

  it("parses a Lock-Token header", () => {
    expect(parseLockTokenHeader("<opaquelocktoken:abc>")).toBe(
      "opaquelocktoken:abc",
    );
    expect(parseLockTokenHeader(undefined)).toBeNull();
  });

  it("reads the owner regardless of prefix", () => {
    expect(
      parseLockOwner(
        '<D:lockinfo xmlns:D="DAV:"><D:owner>deniz</D:owner></D:lockinfo>',
      ),
    ).toBe("deniz");
    expect(parseLockOwner("<lockinfo/>")).toBe("");
  });

  it("escapes a client-supplied owner instead of replaying it as markup", () => {
    const store = new DavLockStore();
    const lock = store.create({
      path: "/u/a.txt",
      depth: "0",
      owner: '<script xmlns="x"/>',
      timeoutSeconds: 60,
      userId: USER_ID,
    });
    const xml = renderActiveLock(lock, "/dav/home/a.txt");
    expect(xml).not.toContain("<script");
    expect(xml).toContain("&lt;script");
    expect(xml).toContain("<D:lockroot><D:href>/dav/home/a.txt</D:href>");
  });
});
