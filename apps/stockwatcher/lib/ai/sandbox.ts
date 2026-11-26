import "server-only";
import variant from "@jitl/quickjs-singlefile-cjs-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSWASMModule,
  Scope,
} from "quickjs-emscripten";
import { z } from "zod";
import {
  backtest,
  correlationMatrix,
  drawdowns,
  regression,
  returns,
  rollingBeta,
  rollingVolatility,
  strategyKinds,
} from "@/lib/analytics";
import {
  adx,
  cci,
  ema,
  heikinAshi,
  ichimoku,
  macd,
  mfi,
  obv,
  psar,
  rsi,
  sma,
  stdev,
  stochastic,
  trueRange,
  vwap,
  wilder,
  williams,
} from "@/lib/indicators";

export const sandboxLimits = {
  memoryBytes: 64 * 1024 * 1024,
  stackBytes: 1024 * 1024,
  deadlineMs: 5000,
  outputChars: 200_000,
} as const;

const seriesInput = z.array(z.number().nullable());
const numbers = z.array(z.number());
const barsInput = z.array(
  z.object({
    time: z.number(),
    open: z.number(),
    high: z.number(),
    low: z.number(),
    close: z.number(),
    volume: z
      .number()
      .nullish()
      .transform((value) => value ?? null),
  }),
);
const period = z.number().int().min(1).max(5000);
const optional = <T extends z.ZodType>(schema: T) =>
  schema.nullish().transform((value) => value ?? undefined);

type Helper = (args: unknown) => unknown;
const helper =
  <S extends z.ZodType>(
    schema: S,
    run: (args: z.output<S>) => unknown,
  ): Helper =>
  (args) =>
    run(schema.parse(args));

const strategyInput = z.object({
  kind: z.enum(strategyKinds),
  fast: z.number().int().min(2).max(500).default(50),
  slow: z.number().int().min(2).max(500).default(200),
  lower: z.number().default(30),
  upper: z.number().default(70),
  shorts: z.boolean().default(false),
  costBps: z.number().min(0).max(200).default(5),
});

const helpers: Record<string, Helper> = {
  sma: helper(z.tuple([seriesInput, period]), ([values, n]) => sma(values, n)),
  ema: helper(z.tuple([seriesInput, period]), ([values, n]) => ema(values, n)),
  wilder: helper(z.tuple([seriesInput, period]), ([values, n]) =>
    wilder(values, n),
  ),
  stdev: helper(z.tuple([seriesInput, period]), ([values, n]) =>
    stdev(values, n, sma(values, n)),
  ),
  rsi: helper(z.tuple([seriesInput, optional(period)]), ([closes, n]) =>
    rsi(closes, n),
  ),
  macd: helper(
    z.tuple([
      seriesInput,
      optional(period),
      optional(period),
      optional(period),
    ]),
    ([closes, fast, slow, signal]) => macd(closes, fast, slow, signal),
  ),
  bollinger: helper(
    z.tuple([seriesInput, optional(period), optional(z.number().positive())]),
    ([closes, n = 20, width = 2]) => {
      const mid = sma(closes, n);
      const sd = stdev(closes, n, mid);
      const band = (sign: number) =>
        mid.map((value, i) =>
          value == null || sd[i] == null ? null : value + sign * width * sd[i],
        );
      return { mid, upper: band(1), lower: band(-1) };
    },
  ),
  stochastic: helper(
    z.tuple([barsInput, optional(period), optional(period), optional(period)]),
    ([bars, n, smoothK, d]) => stochastic(bars, n, smoothK, d),
  ),
  williams: helper(z.tuple([barsInput, optional(period)]), ([bars, n]) =>
    williams(bars, n),
  ),
  cci: helper(z.tuple([barsInput, optional(period)]), ([bars, n]) =>
    cci(bars, n),
  ),
  obv: helper(z.tuple([barsInput]), ([bars]) => obv(bars)),
  mfi: helper(z.tuple([barsInput, optional(period)]), ([bars, n]) =>
    mfi(bars, n),
  ),
  adx: helper(z.tuple([barsInput, optional(period)]), ([bars, n]) =>
    adx(bars, n),
  ),
  psar: helper(
    z.tuple([
      barsInput,
      optional(z.number().positive()),
      optional(z.number().positive()),
    ]),
    ([bars, step, max]) => psar(bars, step, max),
  ),
  vwap: helper(z.tuple([barsInput]), ([bars]) => vwap(bars)),
  ichimoku: helper(z.tuple([barsInput]), ([bars]) => ichimoku(bars)),
  heikinAshi: helper(z.tuple([barsInput]), ([bars]) => heikinAshi(bars)),
  trueRange: helper(z.tuple([barsInput]), ([bars]) => trueRange(bars)),
  atr: helper(z.tuple([barsInput, optional(period)]), ([bars, n = 14]) =>
    wilder(trueRange(bars), n),
  ),
  returns: helper(z.tuple([numbers]), ([closes]) => returns(closes)),
  drawdowns: helper(z.tuple([numbers]), ([closes]) => drawdowns(closes)),
  rollingVolatility: helper(z.tuple([barsInput, period]), ([bars, window]) =>
    rollingVolatility(bars, window),
  ),
  regression: helper(
    z.tuple([barsInput, barsInput, optional(period)]),
    ([bars, benchmark, step]) => regression(bars, benchmark, step),
  ),
  rollingBeta: helper(
    z.tuple([barsInput, barsInput, period]),
    ([bars, benchmark, window]) => rollingBeta(bars, benchmark, window),
  ),
  correlationMatrix: helper(
    z.tuple([
      z.array(z.object({ symbol: z.string(), bars: barsInput })).min(2),
    ]),
    ([items]) =>
      correlationMatrix(
        items.map(({ symbol, bars }) => ({ symbol, points: bars })),
      ),
  ),
  backtest: helper(z.tuple([barsInput, strategyInput]), ([bars, strategy]) =>
    backtest(bars, strategy),
  ),
};

function describeIssue(name: string, error: unknown) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    const where = issue.path.length
      ? ` (argument ${issue.path.join(".")})`
      : "";
    return `ta.${name}: ${issue.message}${where}`;
  }
  return error instanceof Error
    ? `ta.${name}: ${error.message}`
    : `ta.${name} failed`;
}

const prelude = (names: string[]) => `"use strict";
const host = __host;
delete globalThis.__host;
const call = (name, args) => JSON.parse(host(name, JSON.stringify(args)));
const finite = (values) => values.filter((v) => v != null && Number.isFinite(v));
const sum = (values) => finite(values).reduce((a, b) => a + b, 0);
const mean = (values) => {
  const x = finite(values);
  return x.length ? sum(x) / x.length : null;
};
const percentile = (values, p) => {
  const x = finite(values).sort((a, b) => a - b);
  if (!x.length) return null;
  const rank = (p / 100) * (x.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return x[lo] + (x[hi] - x[lo]) * (rank - lo);
};
const median = (values) => percentile(values, 50);
const std = (values) => {
  const x = finite(values);
  if (x.length < 2) return null;
  const m = mean(x);
  return Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / (x.length - 1));
};
const zscore = (values) => {
  const m = mean(values);
  const s = std(values);
  return values.map((v) => (v == null || !Number.isFinite(v) || !s ? null : (v - m) / s));
};
const pctChange = (values, n = 1) =>
  values.map((v, i) =>
    i < n || v == null || values[i - n] == null || values[i - n] === 0
      ? null
      : (v / values[i - n] - 1) * 100,
  );
const windowed = (values, n, pick) =>
  values.map((_, i) => {
    if (i + 1 < n) return null;
    const w = values.slice(i + 1 - n, i + 1);
    return w.some((v) => v == null) ? null : pick(...w);
  });
const highest = (values, n) => windowed(values, n, Math.max);
const lowest = (values, n) => windowed(values, n, Math.min);
const last = (values) => values[values.length - 1];
const ta = { sum, mean, median, percentile, std, zscore, pctChange, highest, lowest, last };
for (const name of ${JSON.stringify(names)}) ta[name] = (...args) => call(name, args);
ta.rma = ta.wilder;
Object.freeze(ta);
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};
globalThis.__ta = ta;
globalThis.__data = deepFreeze(JSON.parse(globalThis.__dataJson));
delete globalThis.__dataJson;
globalThis.__serialize = (result) => {
  if (result && typeof result.then === "function")
    throw new Error("The code must be synchronous: return a plain value, not a Promise");
  const json = JSON.stringify(result);
  if (json === undefined) throw new Error("The code must return a JSON-serialisable value");
  return json;
};
`;

const failureShape = z.object({
  name: z.string().optional(),
  message: z.string().optional(),
  stack: z.string().optional(),
});

function describeFailure(value: unknown, timedOut: boolean) {
  if (timedOut)
    return `Timed out after ${sandboxLimits.deadlineMs / 1000} s of computation. Make the code cheaper (fewer symbols, shorter ranges, no nested full scans).`;
  const parsed = failureShape.safeParse(value);
  if (!parsed.success) return String(value);
  const { name, message = "Unknown error", stack } = parsed.data;
  if (/out of memory/i.test(message))
    return `Out of memory (limit ${sandboxLimits.memoryBytes / 1024 / 1024} MB). Process fewer symbols or a shorter range, and avoid building large intermediate arrays.`;
  const line = stack?.match(/compute\.js:(\d+)(?::(\d+))?/);
  const at = line
    ? ` (line ${line[1]}${line[2] ? `, column ${line[2]}` : ""})`
    : "";
  return `${name && name !== "Error" ? `${name}: ` : ""}${message}${at}`;
}

let loaded: Promise<QuickJSWASMModule> | undefined;
const quickjs = () => (loaded ??= newQuickJSWASMModuleFromVariant(variant));

export type SandboxOutcome =
  | { ok: true; json: string }
  | { ok: false; error: string };

export async function runSandbox(
  code: string,
  dataJson: string,
): Promise<SandboxOutcome> {
  const wasm = await quickjs();
  const runtime = wasm.newRuntime();
  const vm = runtime.newContext();
  const deadline = Date.now() + sandboxLimits.deadlineMs;
  let timedOut = false;
  runtime.setMemoryLimit(sandboxLimits.memoryBytes);
  runtime.setMaxStackSize(sandboxLimits.stackBytes);
  runtime.setInterruptHandler(() => (timedOut = Date.now() > deadline));
  try {
    return Scope.withScope((scope): SandboxOutcome => {
      const fail = (error: unknown): SandboxOutcome => ({
        ok: false,
        error: describeFailure(error, timedOut),
      });
      const host = scope.manage(
        vm.newFunction("__host", (nameHandle, argsHandle) => {
          const name = vm.getString(nameHandle);
          const run = Object.hasOwn(helpers, name) ? helpers[name] : undefined;
          if (!run) throw new Error(`ta.${name} does not exist`);
          try {
            const output = run(JSON.parse(vm.getString(argsHandle)));
            return vm.newString(JSON.stringify(output) ?? "null");
          } catch (error) {
            throw new Error(describeIssue(name, error));
          }
        }),
      );
      vm.setProp(vm.global, "__host", host);
      vm.setProp(vm.global, "__dataJson", scope.manage(vm.newString(dataJson)));
      const setup = vm.evalCode(prelude(Object.keys(helpers)), "prelude.js");
      if ("error" in setup && setup.error)
        return fail(vm.dump(scope.manage(setup.error)));
      scope.manage(setup.value);

      const compiled = vm.evalCode(
        `(function (data, ta) {"use strict";${code}\n})`,
        "compute.js",
      );
      if ("error" in compiled && compiled.error)
        return fail(vm.dump(scope.manage(compiled.error)));
      const run = scope.manage(compiled.value);
      const called = vm.callFunction(
        run,
        vm.undefined,
        scope.manage(vm.getProp(vm.global, "__data")),
        scope.manage(vm.getProp(vm.global, "__ta")),
      );
      if ("error" in called && called.error)
        return fail(vm.dump(scope.manage(called.error)));
      const serialised = vm.callFunction(
        scope.manage(vm.getProp(vm.global, "__serialize")),
        vm.undefined,
        scope.manage(called.value),
      );
      if ("error" in serialised && serialised.error)
        return fail(vm.dump(scope.manage(serialised.error)));
      const json = vm.getString(scope.manage(serialised.value));
      if (json.length > sandboxLimits.outputChars)
        return {
          ok: false,
          error: `Result is ${Math.round(json.length / 1000)} KB, over the ${sandboxLimits.outputChars / 1000} KB limit. Aggregate inside the code (summary statistics, top N, downsampled series) and return less.`,
        };
      return { ok: true, json };
    });
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
