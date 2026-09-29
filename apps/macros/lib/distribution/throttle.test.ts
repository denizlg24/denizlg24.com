import { describe, expect, test } from "bun:test";
import { parseOwnerEmails } from "./owners";
import { clientAddress, createThrottle } from "./throttle";

describe("createThrottle", () => {
  test("refuses past the limit inside the window and allows after it", () => {
    const allow = createThrottle({ limit: 2, windowMs: 1000 });
    expect(allow("a", 0)).toBe(true);
    expect(allow("a", 100)).toBe(true);
    expect(allow("a", 200)).toBe(false);
    expect(allow("b", 200)).toBe(true);
    expect(allow("a", 1001)).toBe(true);
  });

  test("forgets the least recently seen key past maxKeys", () => {
    const allow = createThrottle({ limit: 1, windowMs: 1000, maxKeys: 2 });
    allow("a", 0);
    allow("b", 0);
    allow("c", 0);
    expect(allow("a", 1)).toBe(true);
    expect(allow("c", 1)).toBe(false);
  });
});

describe("clientAddress", () => {
  test("takes the first forwarded address", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" },
    });
    expect(clientAddress(request)).toBe("203.0.113.9");
  });
});

describe("parseOwnerEmails", () => {
  test("splits, trims and lowercases", () => {
    expect([...parseOwnerEmails(" A@x.com,, b@Y.com ")]).toEqual([
      "a@x.com",
      "b@y.com",
    ]);
    expect(parseOwnerEmails(undefined).size).toBe(0);
  });
});
