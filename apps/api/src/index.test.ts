import { describe, expect, it } from "bun:test";

import pkg from "../package.json";
import app from "./index";

describe("GET /healthz", () => {
  it("returns ok status and version", async () => {
    const res = await app.request("/healthz");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: pkg.version });
  });

  // The admin shell polls this cross-origin with `credentials: "include"` to
  // decide whether the Pi is reachable. A response missing either header is
  // discarded by the browser and rejects like a dead host, which is
  // indistinguishable from the Pi actually being down.
  it("allows credentialed cross-origin reads from a trusted origin", async () => {
    const res = await app.request("/healthz", {
      headers: { Origin: "http://localhost:3002" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3002",
    );
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    expect(res.headers.get("vary")).toBe("Origin");
  });

  it("does not grant CORS to an untrusted origin", async () => {
    const res = await app.request("/healthz", {
      headers: { Origin: "https://evil.example" },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("reports the deployed image version", async () => {
    const previousVersion = process.env.APP_VERSION;
    process.env.APP_VERSION = "test-sha";

    try {
      const res = await app.request("/healthz");

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        status: "ok",
        version: "test-sha",
      });
    } finally {
      if (previousVersion === undefined) {
        delete process.env.APP_VERSION;
      } else {
        process.env.APP_VERSION = previousVersion;
      }
    }
  });
});
