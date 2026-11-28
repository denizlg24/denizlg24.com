import "server-only";
import {
  flightsRecent,
  flightsTicker,
  playTicker,
  wsbTicker,
  wsbTop,
} from "../archive/archive";
import { wsbFilters } from "../archive/types";
import type { AltHandlers, AltWarmer } from "../handler-types";
import { AltBadRequest } from "../types";

function integer(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = params.get(name);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new AltBadRequest(
      `${name} must be an integer from ${min} to ${max}.`,
    );
  return value;
}

function symbol(params: URLSearchParams) {
  const value = params.get("symbol")?.trim().toUpperCase();
  if (!value) throw new AltBadRequest("symbol is required.");
  return value;
}

function filter(params: URLSearchParams) {
  const value = params.get("filter") || "wallstreetbets";
  const found = wsbFilters.find((name) => name === value);
  if (!found)
    throw new AltBadRequest(`filter must be ${wsbFilters.join(" or ")}.`);
  return found;
}

export const handlers: AltHandlers = {
  "wsb.top": (p) => wsbTop(filter(p), integer(p, "limit", 50, 1, 100)),
  "wsb.ticker": (p) => wsbTicker(symbol(p), integer(p, "days", 30, 1, 90)),
  "play.ticker": (p) => playTicker(symbol(p), integer(p, "days", 180, 1, 730)),
  "flights.ticker": (p) =>
    flightsTicker(symbol(p), integer(p, "days", 90, 1, 365)),
  "flights.recent": (p) =>
    flightsRecent(
      integer(p, "days", 7, 1, 90),
      integer(p, "limit", 100, 1, 500),
    ),
};

export const warmers: AltWarmer[] = [];
