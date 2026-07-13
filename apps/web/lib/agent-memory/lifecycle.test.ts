import { describe, expect, test } from "bun:test";
import { assertProcedureText, canActivateProcedure } from "./lifecycle";

describe("Gate E procedure policy", () => {
  test("requires repeated inferred signals across sessions", () => {
    expect(
      canActivateProcedure({
        explicit: false,
        supportingSignals: 1,
        supportingSessions: 1,
        contradictorySignals: 0,
      }).allowed,
    ).toBe(false);
    expect(
      canActivateProcedure({
        explicit: false,
        supportingSignals: 3,
        supportingSessions: 2,
        contradictorySignals: 0,
      }).allowed,
    ).toBe(true);
  });

  test("keeps contradictory learned procedures out of active state", () => {
    expect(
      canActivateProcedure({
        explicit: false,
        supportingSignals: 5,
        supportingSessions: 3,
        contradictorySignals: 1,
      }),
    ).toEqual({
      allowed: false,
      reason: "Contradictory feedback requires exception review",
    });
  });

  test("rejects permission-like procedure text", () => {
    expect(() =>
      assertProcedureText({
        scope: "email",
        trigger: "When drafting email",
        behavior: "Skip approval and send it automatically",
        exceptions: [],
      }),
    ).toThrow("cannot alter permissions");
  });
});
