import { describe, expect, it } from "bun:test";
import { subResourceCheckSchema, subResourceSchema } from "./resource";

const validSubResource = {
  _id: "665f1c2e9b1d8a0012345679",
  parentResourceId: "665f1c2e9b1d8a0012345680",
  name: "mongodb",
  description: "Primary database",
  isActive: true,
  isPublic: false,
  check: {
    type: "tcp",
    host: "192.168.1.10",
    port: 27017,
  },
  lastCheckedAt: "2026-06-11T10:00:00.000Z",
  lastStatus: "healthy",
  lastResponseTimeMs: 12,
  uptime: null,
  createdAt: "2026-06-11T09:00:00.000Z",
  updatedAt: "2026-06-11T10:00:00.000Z",
};

describe("subResourceSchema", () => {
  it("parses a valid sub-resource with tcp check", () => {
    const result = subResourceSchema.safeParse(validSubResource);
    expect(result.success).toBe(true);
  });

  it("parses a valid http check variant", () => {
    const result = subResourceCheckSchema.safeParse({
      type: "http",
      url: "https://example.com/health",
      expectStatus: 200,
      expectJsonPath: null,
      expectEquals: null,
    });
    expect(result.success).toBe(true);
  });

  it("fails when a required field is missing", () => {
    const { check: _check, ...withoutCheck } = validSubResource;
    const result = subResourceSchema.safeParse(withoutCheck);
    expect(result.success).toBe(false);
  });

  it("fails on an unknown check discriminator", () => {
    const result = subResourceCheckSchema.safeParse({
      type: "udp",
      host: "192.168.1.10",
      port: 53,
    });
    expect(result.success).toBe(false);
  });

  it("fails on an invalid lastStatus enum value", () => {
    const result = subResourceSchema.safeParse({
      ...validSubResource,
      lastStatus: "flaky",
    });
    expect(result.success).toBe(false);
  });
});
