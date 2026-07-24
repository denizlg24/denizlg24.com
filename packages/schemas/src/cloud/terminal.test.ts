import { describe, expect, it } from "bun:test";

import {
  terminalClientControlFrameSchema,
  terminalServerControlFrameSchema,
  terminalSessionIdSchema,
} from "./terminal";

describe("terminal wire contracts", () => {
  it("accepts bounded control frames", () => {
    expect(
      terminalClientControlFrameSchema.parse({
        t: "resize",
        cols: 120,
        rows: 40,
      }),
    ).toEqual({ t: "resize", cols: 120, rows: 40 });
    expect(
      terminalClientControlFrameSchema.parse({
        t: "attach",
        id: "maintenance_01",
      }),
    ).toEqual({ t: "attach", id: "maintenance_01" });
    expect(terminalClientControlFrameSchema.parse({ t: "sessions" })).toEqual({
      t: "sessions",
    });
  });

  it("rejects unsafe session ids and terminal sizes", () => {
    expect(terminalSessionIdSchema.safeParse("../host").success).toBe(false);
    expect(terminalSessionIdSchema.safeParse("name;reboot").success).toBe(
      false,
    );
    expect(
      terminalClientControlFrameSchema.safeParse({
        t: "resize",
        cols: 10_000,
        rows: 40,
      }).success,
    ).toBe(false);
  });

  it("keeps binary terminal data outside JSON control frames", () => {
    expect(
      terminalServerControlFrameSchema.safeParse({
        t: "sessions",
        sessions: [
          {
            id: "maintenance",
            attachedClients: 1,
            createdAt: "2026-07-24T12:00:00.000Z",
            lastActivityAt: "2026-07-24T12:01:00.000Z",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      terminalClientControlFrameSchema.safeParse({ t: "data" }).success,
    ).toBe(false);
  });
});
