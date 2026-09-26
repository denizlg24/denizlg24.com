import { describe, expect, test } from "bun:test";
import {
  computePayout,
  danishDeductionLines,
  formatMinutes,
  grossForMinutes,
  payoutPeriodBounds,
  sessionMinutes,
  weekStartDay,
  zonedDayKey,
} from "./payroll";

describe("payoutPeriodBounds", () => {
  test("a regular cycle runs from the 11th to the 10th", () => {
    expect(
      payoutPeriodBounds({
        payoutDate: "2026-11-25",
        cycleCloseDay: 10,
        employmentStart: "2026-01-01",
        isFirst: false,
      }),
    ).toEqual({
      periodStart: "2026-10-11",
      periodEnd: "2026-11-10",
      partial: false,
    });
  });

  test("the first payout is partial from the employment start", () => {
    expect(
      payoutPeriodBounds({
        payoutDate: "2026-10-25",
        cycleCloseDay: 10,
        employmentStart: "2026-09-22",
        isFirst: true,
      }),
    ).toEqual({
      periodStart: "2026-09-22",
      periodEnd: "2026-10-10",
      partial: true,
    });
  });

  test("a first payout rolled into the next cycle owns everything since the start", () => {
    // Started on the 3rd of October, but the employer only pays from the
    // November run: that payout covers 3 Oct – 10 Nov.
    expect(
      payoutPeriodBounds({
        payoutDate: "2026-11-25",
        cycleCloseDay: 10,
        employmentStart: "2026-10-03",
        isFirst: true,
      }),
    ).toEqual({
      periodStart: "2026-10-03",
      periodEnd: "2026-11-10",
      partial: true,
    });
  });

  test("a close day after the payout day closes in the previous month", () => {
    expect(
      payoutPeriodBounds({
        payoutDate: "2026-01-05",
        cycleCloseDay: 20,
        employmentStart: "2025-01-01",
        isFirst: false,
      }),
    ).toEqual({
      periodStart: "2025-11-21",
      periodEnd: "2025-12-20",
      partial: false,
    });
  });

  test("January reaches back into December", () => {
    const bounds = payoutPeriodBounds({
      payoutDate: "2027-01-25",
      cycleCloseDay: 10,
      employmentStart: "2026-01-01",
      isFirst: false,
    });
    expect(bounds.periodStart).toBe("2026-12-11");
    expect(bounds.periodEnd).toBe("2027-01-10");
  });
});

describe("computePayout", () => {
  test("Danish lines apply in order on a shrinking taxable base", () => {
    const lines = danishDeductionLines(); // ATP 99, pension 0%, AM 8%, A-skat 37% over 4 300
    const result = computePayout(2_000_000, lines);
    const byId = Object.fromEntries(
      result.lines.map((line) => [line.lineId, line]),
    );
    expect(byId.atp?.amountMinor).toBe(9_900);
    // AM-bidrag on gross less ATP.
    expect(byId["am-bidrag"]?.baseMinor).toBe(1_990_100);
    expect(byId["am-bidrag"]?.amountMinor).toBe(159_208);
    // A-skat on what is left, less the personfradrag.
    const taxBase = 1_990_100 - 159_208 - 430_000;
    expect(byId["a-skat"]?.baseMinor).toBe(taxBase);
    expect(byId["a-skat"]?.amountMinor).toBe(Math.round(taxBase * 0.37));
    expect(result.netMinor).toBe(
      2_000_000 - result.lines.reduce((sum, line) => sum + line.amountMinor, 0),
    );
  });

  test("an allowance larger than the base deducts nothing", () => {
    const result = computePayout(300_000, [
      {
        id: "tax",
        name: "Tax",
        kind: "percent",
        ratePercent: 37,
        base: "gross",
        allowanceMinor: 430_000,
        reducesTaxableBase: true,
      },
    ]);
    expect(result.netMinor).toBe(300_000);
  });

  test("fixed lines never take pay below zero", () => {
    const result = computePayout(5_000, [
      {
        id: "atp",
        name: "ATP",
        kind: "fixed",
        amountMinor: 9_900,
        base: "gross",
        reducesTaxableBase: true,
      },
    ]);
    expect(result.netMinor).toBe(0);
    expect(result.deductionsMinor).toBe(5_000);
  });

  test("no lines is gross", () => {
    expect(computePayout(12_345, []).netMinor).toBe(12_345);
  });
});

describe("sessionMinutes", () => {
  const shift = {
    start: "2026-09-21T07:00:00.000Z",
    end: "2026-09-21T15:30:00.000Z",
    breaks: [
      { start: "2026-09-21T11:00:00.000Z", end: "2026-09-21T11:30:00.000Z" },
    ],
  };

  test("unpaid breaks come off worked time", () => {
    expect(sessionMinutes(shift, false)).toEqual({
      workedMinutes: 480,
      breakMinutes: 30,
    });
  });

  test("paid breaks count", () => {
    expect(sessionMinutes(shift, true).workedMinutes).toBe(510);
  });

  test("an open shift and break run to now", () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    expect(
      sessionMinutes(
        {
          start: "2026-09-21T07:00:00.000Z",
          breaks: [{ start: "2026-09-21T11:45:00.000Z" }],
        },
        false,
        now,
      ),
    ).toEqual({ workedMinutes: 285, breakMinutes: 15 });
  });

  test("a break outside the shift is clipped to it", () => {
    expect(
      sessionMinutes(
        {
          start: "2026-09-21T07:00:00.000Z",
          end: "2026-09-21T08:00:00.000Z",
          breaks: [
            {
              start: "2026-09-21T07:30:00.000Z",
              end: "2026-09-21T09:00:00.000Z",
            },
          ],
        },
        false,
      ),
    ).toEqual({ workedMinutes: 30, breakMinutes: 30 });
  });
});

describe("helpers", () => {
  test("formatMinutes reads as h:mm", () => {
    expect(formatMinutes(0)).toBe("0:00");
    expect(formatMinutes(485)).toBe("8:05");
  });

  test("gross rounds to the minor unit", () => {
    expect(grossForMinutes(90, 15_000)).toBe(22_500);
    expect(grossForMinutes(1, 15_000)).toBe(250);
  });

  test("a late-evening shift in Copenhagen counts on its local day", () => {
    expect(zonedDayKey("2026-09-21T22:30:00.000Z", "Europe/Copenhagen")).toBe(
      "2026-09-22",
    );
  });

  test("weeks start on Monday", () => {
    expect(weekStartDay("2026-09-27")).toBe("2026-09-21");
    expect(weekStartDay("2026-09-21")).toBe("2026-09-21");
  });
});

describe("payoutPeriodBounds first-payout floor", () => {
  test("a first payout reaches back at most one extra cycle", () => {
    expect(
      payoutPeriodBounds({
        payoutDate: "2026-11-25",
        cycleCloseDay: 10,
        employmentStart: "2023-02-01",
        isFirst: true,
      }),
    ).toEqual({
      periodStart: "2026-09-11",
      periodEnd: "2026-11-10",
      partial: true,
    });
  });
});
