import { describe, expect, it } from "bun:test";

import pkg from "../package.json";
import app from "./index";

describe("GET /healthz", () => {
  it("returns ok status and version", async () => {
    const res = await app.request("/healthz");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", version: pkg.version });
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
