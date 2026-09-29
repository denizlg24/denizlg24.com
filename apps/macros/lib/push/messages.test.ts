import { describe, expect, test } from "bun:test";
import {
  buildApnsPayload,
  streakNudgeMessage,
  weeklySummaryMessage,
} from "./messages";

const base = {
  daysLogged: 5,
  averageCalories: 2140.4,
  calorieTarget: 2200,
  trendChangeKg: -0.44,
  energyUnit: "kcal",
  weightUnit: "kg",
};

describe("weeklySummaryMessage", () => {
  test("days, average against target and trend", () => {
    expect(weeklySummaryMessage(base).body).toBe(
      "Logged 5 of 7 days · 2140 kcal a day of 2200 kcal · trend −0.4 kg",
    );
  });

  test("follows the profile's units", () => {
    expect(
      weeklySummaryMessage({ ...base, energyUnit: "kj", weightUnit: "lb" })
        .body,
    ).toBe("Logged 5 of 7 days · 8955 kJ a day of 9205 kJ · trend −1.0 lb");
  });

  test("drops what it does not know", () => {
    expect(
      weeklySummaryMessage({
        ...base,
        calorieTarget: null,
        trendChangeKg: null,
      }).body,
    ).toBe("Logged 5 of 7 days · 2140 kcal a day");
  });

  test("an empty week says so", () => {
    expect(
      weeklySummaryMessage({ ...base, daysLogged: 0, averageCalories: null })
        .body,
    ).toBe("Nothing logged last week. A new week starts today.");
  });
});

describe("buildApnsPayload", () => {
  test("an alert with sound, threaded by kind", () => {
    expect(buildApnsPayload(streakNudgeMessage())).toEqual({
      aps: {
        alert: {
          title: "Nothing logged today",
          body: "You logged yesterday. Add what you've eaten today to keep going.",
        },
        sound: "default",
        "thread-id": "streak-nudge",
      },
      kind: "streak-nudge",
    });
  });
});
