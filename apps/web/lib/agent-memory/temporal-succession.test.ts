import { describe, expect, test } from "bun:test";
import {
  classifyTemporalConflict,
  SUCCESSION_MIN_SEPARATION_MS,
  type TemporalConflictSide,
} from "./temporal-succession";

const day = (iso: string) => new Date(iso);

function side(
  overrides: Partial<TemporalConflictSide> = {},
): TemporalConflictSide {
  return {
    explicitness: "explicit",
    observedAt: day("2026-08-01T12:00:00Z"),
    ...overrides,
  };
}

describe("classifyTemporalConflict", () => {
  test("treats a later dated reading of the same value as succession", () => {
    expect(
      classifyTemporalConflict({
        candidate: side({ temporal: { validFrom: "2026-08-04T00:00:00Z" } }),
        prior: side({ temporal: { validFrom: "2026-08-03T00:00:00Z" } }),
      }),
    ).toBe("succession");
  });

  test("keeps two readings of the same instant as a contradiction", () => {
    expect(
      classifyTemporalConflict({
        candidate: side({ temporal: { validFrom: "2026-08-03T00:00:00Z" } }),
        prior: side({ temporal: { validFrom: "2026-08-03T00:00:00Z" } }),
      }),
    ).toBe("contradiction");
  });

  test("drops a link to an older reading as stale", () => {
    expect(
      classifyTemporalConflict({
        candidate: side({ temporal: { validFrom: "2026-08-01T00:00:00Z" } }),
        prior: side({ temporal: { validFrom: "2026-08-03T00:00:00Z" } }),
      }),
    ).toBe("stale");
  });

  test("succeeds a memory whose own window already closed", () => {
    expect(
      classifyTemporalConflict({
        candidate: side({ observedAt: day("2026-08-04T00:00:00Z") }),
        prior: side({
          temporal: {
            validFrom: "2026-01-01T00:00:00Z",
            validUntil: "2026-07-01T00:00:00Z",
          },
        }),
      }),
    ).toBe("succession");
  });

  test("orders undated statements by observation once they are far enough apart", () => {
    expect(
      classifyTemporalConflict({
        candidate: side({
          observedAt: new Date(
            day("2026-08-01T12:00:00Z").getTime() +
              SUCCESSION_MIN_SEPARATION_MS,
          ),
        }),
        prior: side(),
      }),
    ).toBe("succession");
  });

  test("keeps two undated statements from one sitting as a contradiction", () => {
    expect(
      classifyTemporalConflict({
        candidate: side({ observedAt: day("2026-08-01T12:20:00Z") }),
        prior: side({ observedAt: day("2026-08-01T12:00:00Z") }),
      }),
    ).toBe("contradiction");
  });

  test("refuses to let a guess quietly overwrite an owner-stated fact", () => {
    expect(
      classifyTemporalConflict({
        candidate: side({
          explicitness: "inferred",
          temporal: { validFrom: "2026-08-04T00:00:00Z" },
        }),
        prior: side({
          explicitness: "explicit",
          temporal: { validFrom: "2026-08-03T00:00:00Z" },
        }),
      }),
    ).toBe("contradiction");
  });

  test("lets an equally explicit later statement supersede", () => {
    expect(
      classifyTemporalConflict({
        candidate: side({
          explicitness: "inferred",
          temporal: { validFrom: "2026-08-04T00:00:00Z" },
        }),
        prior: side({
          explicitness: "inferred",
          temporal: { validFrom: "2026-08-03T00:00:00Z" },
        }),
      }),
    ).toBe("succession");
  });
});
