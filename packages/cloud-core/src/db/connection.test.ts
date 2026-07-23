import { describe, expect, it } from "bun:test";

import { createDb, createRawClient } from "./connection";

const TEST_DATABASE_URL = "postgresql://user:password@localhost:5432/test";

describe("PostgreSQL connection pools", () => {
  it("uses bounded application defaults", async () => {
    const db = createDb(TEST_DATABASE_URL);

    expect(db.$client.options.max).toBe(5);
    expect(db.$client.options.idle_timeout).toBe(20);

    await db.$client.end();
  });

  it("limits transient clients to one connection", async () => {
    const client = createRawClient(TEST_DATABASE_URL);

    expect(client.options.max).toBe(1);
    expect(client.options.idle_timeout).toBe(20);

    await client.end();
  });

  it("accepts explicit pool limits", async () => {
    const db = createDb(TEST_DATABASE_URL, {
      max: 3,
      idleTimeoutSeconds: 45,
    });

    expect(db.$client.options.max).toBe(3);
    expect(db.$client.options.idle_timeout).toBe(45);

    await db.$client.end();
  });
});
