import "server-only";
import type { AltHandlers, AltWarmer } from "./handler-types";
import * as congress from "./handlers/congress";
import * as gov from "./handlers/gov";
import * as market from "./handlers/market";
import * as sec from "./handlers/sec";

const domains: { handlers: AltHandlers; warmers: AltWarmer[] }[] = [
  congress,
  gov,
  sec,
  market,
];

export const altHandlers: AltHandlers = Object.assign(
  {},
  ...domains.map((domain) => domain.handlers),
);

export const altWarmers: AltWarmer[] = domains.flatMap(
  (domain) => domain.warmers,
);
