/**
 * Every indicator returns an array the same length as its input, with `null`
 * for the warm-up window. Callers can zip the result straight onto a bar series
 * without tracking offsets.
 */
export type Line = (number | null)[];

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) {
    throw new RangeError(`period must be a positive integer, got ${period}`);
  }
}

export function sma(values: number[], period: number): Line {
  assertPeriod(period);
  const out: Line = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i] as number;
    if (i >= period) sum -= values[i - period] as number;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Line {
  assertPeriod(period);
  const out: Line = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i] as number;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (values[i] as number) * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function wma(values: number[], period: number): Line {
  assertPeriod(period);
  const out: Line = new Array(values.length).fill(null);
  const denominator = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let weighted = 0;
    for (let j = 0; j < period; j++) {
      weighted += (values[i - period + 1 + j] as number) * (j + 1);
    }
    out[i] = weighted / denominator;
  }
  return out;
}

/**
 * Wilder's smoothing — the recursive average behind RSI and ATR. Distinct from
 * `ema`: the decay is 1/period rather than 2/(period+1).
 */
export function wilderSmooth(values: number[], period: number): Line {
  assertPeriod(period);
  const out: Line = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i] as number;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + (values[i] as number)) / period;
    out[i] = prev;
  }
  return out;
}
