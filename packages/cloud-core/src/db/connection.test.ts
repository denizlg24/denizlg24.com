import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { createDb, createRawClient } from "./connection";

const TEST_DATABASE_URL = "postgresql://user:password@localhost:5432/test";
const ORIGINAL_CONNECT_TIMEOUT = process.env.PGCONNECT_TIMEOUT;

beforeEach(() => {
  delete process.env.PGCONNECT_TIMEOUT;
});

afterAll(() => {
  if (ORIGINAL_CONNECT_TIMEOUT === undefined) {
    delete process.env.PGCONNECT_TIMEOUT;
  } else {
    process.env.PGCONNECT_TIMEOUT = ORIGINAL_CONNECT_TIMEOUT;
  }
});

describe("PostgreSQL connection pools", () => {
  it("uses bounded application defaults", async () => {
    const db = createDb(TEST_DATABASE_URL);

    expect(db.$client.options.max).toBe(5);
    expect(db.$client.options.idle_timeout).toBe(20);
    expect(db.$client.options.connect_timeout).toBe(10);

    await db.$client.end();
  });

  it("limits transient clients to one connection", async () => {
    const client = createRawClient(TEST_DATABASE_URL);

    expect(client.options.max).toBe(1);
    expect(client.options.idle_timeout).toBe(20);
    expect(client.options.connect_timeout).toBe(10);

    await client.end();
  });

  it("accepts explicit pool limits", async () => {
    const db = createDb(TEST_DATABASE_URL, {
      max: 3,
      idleTimeoutSeconds: 45,
      connectTimeoutSeconds: 15,
    });

    expect(db.$client.options.max).toBe(3);
    expect(db.$client.options.idle_timeout).toBe(45);
    expect(db.$client.options.connect_timeout).toBe(15);

    await db.$client.end();
  });

  it("honors the postgres environment timeout", async () => {
    process.env.PGCONNECT_TIMEOUT = "12";
    const db = createDb(TEST_DATABASE_URL);

    expect(db.$client.options.connect_timeout).toBe(12);

    await db.$client.end();
  });

  it("rejects unbounded connection startup", () => {
    expect(() =>
      createDb(TEST_DATABASE_URL, { connectTimeoutSeconds: 0 }),
    ).toThrow("connectTimeoutSeconds must be greater than zero");
  });
});
