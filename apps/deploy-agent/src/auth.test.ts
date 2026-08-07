import { describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { bearerToken, requireAgentToken, tokensMatch } from "./auth";

const TOKEN = "a".repeat(32);

describe("bearerToken", () => {
  it("extracts a bearer token case-insensitively", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("BEARER abc")).toBe("abc");
  });

  it("returns null for anything else", () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken("")).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer   ")).toBeNull();
  });
});

describe("tokensMatch", () => {
  it("matches identical tokens", () => {
    expect(tokensMatch(TOKEN, TOKEN)).toBe(true);
  });

  it("rejects different tokens", () => {
    expect(tokensMatch("b".repeat(32), TOKEN)).toBe(false);
  });

  it("rejects tokens of a different length without throwing", () => {
    expect(tokensMatch("short", TOKEN)).toBe(false);
    expect(tokensMatch(`${TOKEN}extra`, TOKEN)).toBe(false);
    expect(tokensMatch("", TOKEN)).toBe(false);
  });
});

describe("requireAgentToken", () => {
  const app = new Hono();
  app.use("*", requireAgentToken(TOKEN));
  app.get("/protected", (context) => context.json({ ok: true }));

  it("allows a correct token", async () => {
    const response = await app.request("/protected", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status).toBe(200);
  });

  it("rejects a missing token", async () => {
    const response = await app.request("/protected");
    expect(response.status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const response = await app.request("/protected", {
      headers: { authorization: "Bearer nope" },
    });
    expect(response.status).toBe(401);
  });
});
