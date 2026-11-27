import { beforeAll, describe, expect, mock, test } from "bun:test";

const MC_PER_USD = 100_000;
let accountMc = 0;
let extensions = 0;

mock.module("server-only", () => ({}));
mock.module("@/lib/ai/config", () => ({ gateway: () => ({}) }));
mock.module("./credits", () => ({
  chargeFor: (usd: number) => Math.max(0, Math.ceil(usd * 2 * MC_PER_USD)),
  creditConfig: () => ({ reserve: 5_000 }),
  credits: (mc: number) => mc / 1000,
  extendHold: async (_user: string, _hold: string, target: number) => {
    extensions++;
    return Math.min(target, accountMc);
  },
}));

let budgetModule: typeof import("./budget");
beforeAll(async () => {
  budgetModule = await import("./budget");
});

const rates = { input: 3 / 1e6, output: 15 / 1e6 };
const step = (usd: number) => ({
  providerMetadata: { gateway: { cost: String(usd) } },
});
const reservation = (amountMc: number) => ({
  ok: true as const,
  holdId: "hold",
  metered: true,
  amountMc,
});
const user = { id: "u", demo: false };

describe("chat budget", () => {
  test("stops a long turn before it spends past the balance", async () => {
    accountMc = 100_000;
    extensions = 0;
    const budget = budgetModule.createBudget(
      user,
      reservation(5_000),
      rates,
      30_000,
    );
    const steps: ReturnType<typeof step>[] = [];
    let continued = 0;
    for (let index = 0; index < 14; index++) {
      steps.push(step(0.17));
      if (!(await budget.affords(steps, budget.projectNext(steps.at(-1)))))
        break;
      continued++;
    }
    expect(budget.exhausted).toBe(true);
    expect(continued).toBeLessThan(14);
    expect(budget.spent(steps)).toBeLessThanOrEqual(accountMc);
    expect(extensions).toBeGreaterThan(0);
  });

  test("prices a step without an inline cost from its tokens", () => {
    const charge = budgetModule.stepCharge(
      { usage: { inputTokens: 100_000, outputTokens: 1_000 } },
      rates,
    );
    expect(charge).toBe(Math.ceil((0.3 + 0.015) * 2 * MC_PER_USD));
  });

  test("an unmetered session is never stopped", async () => {
    const budget = budgetModule.createBudget(
      user,
      { ok: true, holdId: null, metered: false, amountMc: 0 },
      rates,
      1e9,
    );
    expect(await budget.affords([step(100)], 1e9)).toBe(true);
    expect(budget.exhausted).toBe(false);
  });

  test("concurrent guards share one hold without double-extending past it", async () => {
    accountMc = 20_000;
    const budget = budgetModule.createBudget(
      user,
      reservation(5_000),
      rates,
      5_000,
    );
    const results = await Promise.all(
      [1, 2, 3].map(() => budget.affords([step(0.05)], 8_000)),
    );
    expect(results.every(Boolean)).toBe(true);
    expect(await budget.affords([step(0.05)], 20_000)).toBe(false);
  });
});
