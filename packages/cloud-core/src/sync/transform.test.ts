import { describe, expect, it } from "bun:test";
import { ObjectId } from "mongodb";

import { transformDocument, transformPgRow } from "./transform";

describe("sync transforms", () => {
  it("maps MongoDB ids, dates, nested objects, and field filters", () => {
    const id = new ObjectId();
    const createdAt = new Date("2026-07-23T12:00:00.000Z");
    const result = transformDocument(
      {
        _id: id,
        name: "Ada",
        createdAt,
        secret: "hidden",
        nested: { enabled: true },
      },
      {
        excludeFields: ["secret"],
      },
    );

    expect(result).toEqual({
      id: id.toHexString(),
      name: "Ada",
      createdAt: Math.floor(createdAt.getTime() / 1000),
      nested: { enabled: true },
    });
  });

  it("maps Postgres ids and rejects missing identifiers", () => {
    expect(
      transformPgRow(
        {
          user_id: 42,
          name: "Grace",
          ignored: "value",
        },
        "user_id",
        { includeFields: ["name"] },
      ),
    ).toEqual({
      id: "42",
      name: "Grace",
    });

    expect(() => transformPgRow({ name: "Grace" }, "id", {})).toThrow(
      'Row missing id column "id"',
    );
  });
});
