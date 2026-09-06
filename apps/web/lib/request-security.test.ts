import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { isCrossOriginCookieRequest } from "./request-security";

function request(
  url: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, { headers });
}

describe("isCrossOriginCookieRequest", () => {
  it("accepts a direct same-origin browser write", () => {
    expect(
      isCrossOriginCookieRequest(
        request("https://denizlg24.com/api/admin/latex/projects/1", {
          origin: "https://denizlg24.com",
        }),
      ),
    ).toBe(false);
  });

  it("accepts the public origin preserved by the Forge proxy", () => {
    expect(
      isCrossOriginCookieRequest(
        request("http://127.0.0.1:3000/api/admin/latex/projects/1", {
          host: "127.0.0.1:3000",
          origin: "https://denizlg24.com",
          "x-forwarded-host": "denizlg24.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe(false);
  });

  it("rejects an unrelated browser origin behind the proxy", () => {
    expect(
      isCrossOriginCookieRequest(
        request("http://127.0.0.1:3000/api/admin/latex/projects/1", {
          origin: "https://attacker.example",
          "x-forwarded-host": "denizlg24.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe(true);
  });

  it("rejects malformed forwarded origin headers", () => {
    expect(
      isCrossOriginCookieRequest(
        request("http://127.0.0.1:3000/api/admin/latex/projects/1", {
          origin: "https://denizlg24.com",
          "x-forwarded-host": "denizlg24.com, attacker.example",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe(true);
  });

  it("retains Bearer-authenticated desktop access", () => {
    expect(
      isCrossOriginCookieRequest(
        request("http://127.0.0.1:3000/api/admin/latex/projects/1", {
          authorization: "Bearer desktop-token",
          origin: "tauri://localhost",
        }),
      ),
    ).toBe(false);
  });
});
