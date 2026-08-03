import { describe, expect, test } from "bun:test";
import {
  alpha,
  annualizedVolatility,
  beta,
  cagr,
  maxDrawdown,
  mean,
  sharpe,
  simpleReturns,
  sortino,
  stdev,
} from "./stats";

describe("returns", () => {
  test("simple returns are one shorter than the series", () => {
    const result = simpleReturns([100, 110, 99]);
    expect(result).toHaveLength(2);
    expect(result[0] as number).toBeCloseTo(0.1, 10);
    expect(result[1] as number).toBeCloseTo(-0.1, 10);
  });

  test("a zero prior value yields zero rather than infinity", () => {
    expect(simpleReturns([0, 50])).toEqual([0]);
  });
});

describe("dispersion", () => {
  test("stdev is the sample deviation", () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 4);
  });

  test("a single observation has no dispersion", () => {
    expect(stdev([5])).toBe(0);
    expect(mean([])).toBe(0);
  });

  test("volatility annualises by the square root of the period count", () => {
    const returns = [0.01, -0.01, 0.02, -0.02, 0.015];
    const result = annualizedVolatility(returns, 252) as number;
    expect(result).toBeCloseTo(stdev(returns) * Math.sqrt(252), 10);
  });
});

describe("cagr", () => {
  test("doubling over two years", () => {
    expect(cagr(100, 200, 2) as number).toBeCloseTo(Math.SQRT2 - 1, 10);
  });

  test("a wiped-out portfolio reports -100% rather than null", () => {
    expect(cagr(100, 0, 3)).toBe(-1);
  });

  test("undefined without a positive start or span", () => {
    expect(cagr(0, 100, 2)).toBeNull();
    expect(cagr(100, 200, 0)).toBeNull();
  });
});

describe("maxDrawdown", () => {
  test("finds the deepest peak-to-trough fall", () => {
    const result = maxDrawdown([100, 120, 60, 80]);
    expect(result?.maxDrawdown).toBeCloseTo(0.5, 10);
    expect(result?.peakIndex).toBe(1);
    expect(result?.troughIndex).toBe(2);
  });

  test("a monotonic climb never draws down", () => {
    expect(maxDrawdown([1, 2, 3, 4])?.maxDrawdown).toBe(0);
  });

  test("an empty curve has no drawdown at all", () => {
    expect(maxDrawdown([])).toBeNull();
  });
});

describe("risk-adjusted ratios", () => {
  test("sharpe is null when returns never move", () => {
    expect(sharpe([0.01, 0.01, 0.01])).toBeNull();
  });

  test("sharpe rises with mean return", () => {
    const calm = sharpe([0.01, 0.005, 0.011, 0.004]) as number;
    const better = sharpe([0.02, 0.015, 0.021, 0.014]) as number;
    expect(better).toBeGreaterThan(calm);
  });

  test("sortino ignores upside deviation", () => {
    const symmetric = [0.02, -0.02, 0.02, -0.02];
    const upsideHeavy = [0.06, -0.02, 0.06, -0.02];
    expect(sortino(upsideHeavy) as number).toBeGreaterThan(
      sortino(symmetric) as number,
    );
  });

  test("sortino is null with no downside", () => {
    expect(sortino([0.01, 0.02, 0.03])).toBeNull();
  });
});

describe("benchmark relative", () => {
  const benchmark = [0.01, -0.02, 0.03, -0.01, 0.02];

  test("a doubled series has a beta of two", () => {
    const doubled = benchmark.map((value) => value * 2);
    expect(beta(doubled, benchmark) as number).toBeCloseTo(2, 10);
  });

  test("tracking the benchmark exactly leaves no alpha", () => {
    expect(alpha(benchmark, benchmark) as number).toBeCloseTo(0, 10);
  });

  test("beta aligns series from the right when lengths differ", () => {
    const longer = [0.5, ...benchmark.map((value) => value * 2)];
    expect(beta(longer, benchmark) as number).toBeCloseTo(2, 10);
  });

  test("alpha aligns series from the right when lengths differ", () => {
    // The leading 0.5 predates the benchmark and must not reach either mean.
    const longer = [0.5, ...benchmark];
    expect(alpha(longer, benchmark) as number).toBeCloseTo(0, 10);
  });

  test("a flat benchmark has no variance to regress against", () => {
    expect(beta([0.01, 0.02], [0.01, 0.01])).toBeNull();
  });
});
