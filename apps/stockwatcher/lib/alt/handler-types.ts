import type { AltResult } from "./types";

/**
 * One dataset behind `GET /api/alt?dataset=<name>&…`. Handlers validate their
 * own query parameters and throw `AltBadRequest` for bad input.
 */
export type AltHandler = (
  params: URLSearchParams,
) => Promise<AltResult<unknown>>;
export type AltHandlers = Record<string, AltHandler>;

/** A background refresh the worker runs so the first reader after a quiet spell gets live data. */
export type AltWarmer = {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
};
