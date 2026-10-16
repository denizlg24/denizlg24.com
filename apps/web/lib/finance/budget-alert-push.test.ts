import { describe, expect, test } from "bun:test";
import { budgetAlertPush } from "./budget-alerts";

describe("budgetAlertPush", () => {
  test("maps alert kinds onto phone kinds and links the envelope", () => {
    expect(
      budgetAlertPush({
        key: "k1",
        kind: "envelope_exceeded",
        title: "Groceries overspent",
        envelopeId: "e1",
      }),
    ).toEqual({
      kind: "budget_overspent",
      title: "Groceries overspent",
      subject: "k1",
      url: "dashboard://money/envelope/e1",
    });
    expect(
      budgetAlertPush({ key: "k2", kind: "income_missed", title: "Salary" })
        ?.kind,
    ).toBe("income_missed");
  });

  test("noisy kinds never reach the phone", () => {
    expect(
      budgetAlertPush({ key: "k", kind: "unbudgeted_spend", title: "x" }),
    ).toBeNull();
    expect(
      budgetAlertPush({ key: "k", kind: "recurring_untracked", title: "x" }),
    ).toBeNull();
  });
});
