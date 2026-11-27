/** Regular-session hours in local minutes after midnight, Monday to Friday. Holidays are not modelled. */
type Session = readonly [open: number, close: number];

type Exchange = {
  name: string;
  city: string;
  zone: string;
  region: "Americas" | "Europe" | "Asia-Pacific";
  sessions: readonly Session[];
};

const hm = (hour: number, minute = 0) => hour * 60 + minute;

export const exchanges = {
  NYSE: {
    name: "NYSE",
    city: "New York",
    zone: "America/New_York",
    region: "Americas",
    sessions: [[hm(9, 30), hm(16)]],
  },
  NASDAQ: {
    name: "Nasdaq",
    city: "New York",
    zone: "America/New_York",
    region: "Americas",
    sessions: [[hm(9, 30), hm(16)]],
  },
  TSX: {
    name: "TSX",
    city: "Toronto",
    zone: "America/Toronto",
    region: "Americas",
    sessions: [[hm(9, 30), hm(16)]],
  },
  LSE: {
    name: "LSE",
    city: "London",
    zone: "Europe/London",
    region: "Europe",
    sessions: [[hm(8), hm(16, 30)]],
  },
  XETRA: {
    name: "Xetra",
    city: "Frankfurt",
    zone: "Europe/Berlin",
    region: "Europe",
    sessions: [[hm(9), hm(17, 30)]],
  },
  EPA: {
    name: "Euronext Paris",
    city: "Paris",
    zone: "Europe/Paris",
    region: "Europe",
    sessions: [[hm(9), hm(17, 30)]],
  },
  AMS: {
    name: "Euronext Amsterdam",
    city: "Amsterdam",
    zone: "Europe/Amsterdam",
    region: "Europe",
    sessions: [[hm(9), hm(17, 30)]],
  },
  SIX: {
    name: "SIX Swiss",
    city: "Zurich",
    zone: "Europe/Zurich",
    region: "Europe",
    sessions: [[hm(9), hm(17, 30)]],
  },
  MIL: {
    name: "Borsa Italiana",
    city: "Milan",
    zone: "Europe/Rome",
    region: "Europe",
    sessions: [[hm(9), hm(17, 30)]],
  },
  BME: {
    name: "BME",
    city: "Madrid",
    zone: "Europe/Madrid",
    region: "Europe",
    sessions: [[hm(9), hm(17, 30)]],
  },
  TSE: {
    name: "TSE",
    city: "Tokyo",
    zone: "Asia/Tokyo",
    region: "Asia-Pacific",
    sessions: [
      [hm(9), hm(11, 30)],
      [hm(12, 30), hm(15, 30)],
    ],
  },
  HKEX: {
    name: "HKEX",
    city: "Hong Kong",
    zone: "Asia/Hong_Kong",
    region: "Asia-Pacific",
    sessions: [
      [hm(9, 30), hm(12)],
      [hm(13), hm(16)],
    ],
  },
  SSE: {
    name: "SSE",
    city: "Shanghai",
    zone: "Asia/Shanghai",
    region: "Asia-Pacific",
    sessions: [
      [hm(9, 30), hm(11, 30)],
      [hm(13), hm(15)],
    ],
  },
  SGX: {
    name: "SGX",
    city: "Singapore",
    zone: "Asia/Singapore",
    region: "Asia-Pacific",
    sessions: [
      [hm(9), hm(12)],
      [hm(13), hm(17)],
    ],
  },
  KRX: {
    name: "KRX",
    city: "Seoul",
    zone: "Asia/Seoul",
    region: "Asia-Pacific",
    sessions: [[hm(9), hm(15, 30)]],
  },
  NSE: {
    name: "NSE",
    city: "Mumbai",
    zone: "Asia/Kolkata",
    region: "Asia-Pacific",
    sessions: [[hm(9, 15), hm(15, 30)]],
  },
  ASX: {
    name: "ASX",
    city: "Sydney",
    zone: "Australia/Sydney",
    region: "Asia-Pacific",
    sessions: [[hm(10), hm(16)]],
  },
} as const satisfies Record<string, Exchange>;

export type ExchangeKey = keyof typeof exchanges;
export const exchangeKeys = Object.keys(exchanges) as [
  ExchangeKey,
  ...ExchangeKey[],
];
export const defaultClockExchanges: ExchangeKey[] = [
  "NYSE",
  "LSE",
  "XETRA",
  "TSE",
];

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

function wallClock(time: number, timeZone: string) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(time))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: weekdays.indexOf(parts.weekday ?? ""),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offset(time: number, timeZone: string) {
  const local = wallClock(time, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return asUtc - Math.floor(time / 1000) * 1000;
}

/** Two passes so a boundary on the far side of a DST change resolves to the right offset. */
function instant(
  date: { year: number; month: number; day: number },
  minute: number,
  timeZone: string,
) {
  const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minute);
  const first = wall - offset(wall, timeZone);
  return wall - offset(first, timeZone);
}

export type ExchangeStatus = {
  state: "open" | "break" | "closed";
  /** The UTC instant of the next open (when closed or on break) or close (when open). */
  next: number;
  localTime: string;
  localDay: string;
};

export function exchangeStatus(key: ExchangeKey, now: number): ExchangeStatus {
  const exchange: Exchange = exchanges[key];
  const local = wallClock(now, exchange.zone);
  const pad = (value: number) => String(value).padStart(2, "0");
  const localTime = `${pad(local.hour)}:${pad(local.minute)}`;
  const localDay = weekdays[local.weekday] ?? "";
  const civil = Date.UTC(local.year, local.month - 1, local.day);
  for (let offsetDays = 0; offsetDays <= 7; offsetDays++) {
    const weekday = (local.weekday + offsetDays) % 7;
    if (weekday >= 5) continue;
    const day = new Date(civil + offsetDays * 86_400_000);
    const date = {
      year: day.getUTCFullYear(),
      month: day.getUTCMonth() + 1,
      day: day.getUTCDate(),
    };
    for (const [index, [open, close]] of exchange.sessions.entries()) {
      const openAt = instant(date, open, exchange.zone);
      const closeAt = instant(date, close, exchange.zone);
      if (now < openAt)
        return {
          state: offsetDays === 0 && index > 0 ? "break" : "closed",
          next: openAt,
          localTime,
          localDay,
        };
      if (now < closeAt)
        return { state: "open", next: closeAt, localTime, localDay };
    }
  }
  return { state: "closed", next: now, localTime, localDay };
}

export function countdown(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${String(rest).padStart(2, "0")}m`;
  return `${rest}m`;
}
