import "server-only";
import type { AltHandlers, AltWarmer } from "./handler-types";
import * as archive from "./handlers/archive";
import * as congress from "./handlers/congress";
import * as gov from "./handlers/gov";
import * as market from "./handlers/market";
import * as sec from "./handlers/sec";

const domains: { handlers: AltHandlers; warmers: AltWarmer[] }[] = [
  congress,
  gov,
  sec,
  market,
  archive,
];

export const altHandlers: AltHandlers = Object.assign(
  {},
  ...domains.map((domain) => domain.handlers),
);

export const altWarmers: AltWarmer[] = domains.flatMap(
  (domain) => domain.warmers,
);
