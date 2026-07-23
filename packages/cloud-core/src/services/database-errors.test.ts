import { describe, expect, it } from "bun:test";

import { isPostgresErrorCode } from "./database-errors";

describe("isPostgresErrorCode", () => {
  it("recognizes direct and Drizzle-wrapped Postgres errors", () => {
    const postgresError = Object.assign(new Error("duplicate key"), {
      code: "23505",
    });
    const drizzleError = new Error("Failed query", { cause: postgresError });

    expect(isPostgresErrorCode(postgresError, "23505")).toBe(true);
    expect(isPostgresErrorCode(drizzleError, "23505")).toBe(true);
  });

  it("rejects unrelated or malformed errors", () => {
    expect(isPostgresErrorCode(new Error("other"), "23505")).toBe(false);
    expect(
      isPostgresErrorCode(
        Object.assign(new Error("numeric code"), { code: 23_505 }),
        "23505",
      ),
    ).toBe(false);
    expect(isPostgresErrorCode("23505", "23505")).toBe(false);
  });
});
