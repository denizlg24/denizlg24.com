import { describe, expect, it } from "bun:test";

import { assertIdentifier, triggerFnName, triggerName } from "./pg-outbox";

describe("Postgres sync identifiers", () => {
  it("builds stable trigger names", () => {
    expect(triggerName("public", "users")).toBe("_meili_sync_public_users");
    expect(triggerFnName("public", "users")).toBe(
      "_meili_sync_fn_public_users",
    );
  });

  it("rejects identifiers that could escape SQL quoting", () => {
    expect(() => assertIdentifier("users; drop table users", "table")).toThrow(
      "Invalid table",
    );
    expect(() => assertIdentifier("9users", "table")).toThrow("Invalid table");
    expect(() => assertIdentifier("valid_name", "table")).not.toThrow();
  });
});
