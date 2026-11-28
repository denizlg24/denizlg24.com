import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { resolveName } from "../entities";
import { altFetch, altJson, altText } from "../http";
import { AltBadRequest, type AltResult, AltUnavailable } from "../types";
import type { WarnFeed, WarnNotice, WarnTicker } from "./types";
import { type Cell, excelDate, readWorkbook, type Sheet } from "./xlsx";

type Draft = Omit<WarnNotice, "ticker">;

const noticeDoc = z.array(
  z.object({
    state: z.string(),
    company: z.string(),
    location: z.string().nullable(),
    noticeDate: z.string().nullable(),
    effectiveDate: z.string().nullable(),
    employees: z.number().nullable(),
    type: z.string().nullable(),
    ticker: z.string().nullable(),
  }),
);

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export function toIso(value: Cell | undefined): string | null {
  if (typeof value === "number") return excelDate(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(text);
  if (!us) return null;
  const year = us[3].length === 2 ? `20${us[3]}` : us[3];
  return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

const toCount = (value: Cell | undefined) => {
  const n =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

const text = (value: Cell | undefined) =>
  typeof value === "string"
    ? value.replace(/\s+/g, " ").trim() || null
    : value == null
      ? null
      : String(value);

export function parseCalifornia(sheets: Sheet[]): Draft[] {
  const sheet = sheets.find((s) => s.name.trim() === "Detailed WARN Report");
  if (!sheet)
    throw new AltUnavailable("California WARN workbook changed shape.");
  const out: Draft[] = [];
  for (const row of sheet.rows.slice(2)) {
    const company = text(row[4]);
    if (!company) continue;
    out.push({
      state: "CA",
      company,
      location: text(row[0])?.replace(/ County$/, "") ?? null,
      noticeDate: toIso(row[1]),
      effectiveDate: toIso(row[3]),
      employees: toCount(row[6]),
      type: text(row[5]),
    });
  }
  return out;
}

export function parseNewJersey(sheets: Sheet[]): Draft[] {
  const out: Draft[] = [];
  for (const sheet of sheets.slice(0, 2)) {
    const year = /^(\d{4})/.exec(sheet.name)?.[1];
    if (!year) continue;
    for (const row of sheet.rows.slice(1)) {
      const company = text(row[0]);
      const month = MONTHS.indexOf(
        String(row[2] ?? "")
          .trim()
          .toLowerCase(),
      );
      if (!company || month < 0) continue;
      out.push({
        state: "NJ",
        company,
        location: text(row[1]),
        noticeDate: `${year}-${String(month + 1).padStart(2, "0")}-01`,
        effectiveDate: toIso(row[3]),
        employees: toCount(row[4]),
        type: null,
      });
    }
  }
  return out;
}

export function parseIllinois(sheets: Sheet[]): Draft[] {
  const sheet = sheets.find((s) => s.name === "Layoffs");
  if (!sheet) throw new AltUnavailable("Illinois WARN workbook changed shape.");
  const out: Draft[] = [];
  for (const row of sheet.rows.slice(1)) {
    const company = text(row[0]);
    if (!company) continue;
    out.push({
      state: "IL",
      company,
      location: text(row[3]),
      noticeDate: toIso(row[28]),
      effectiveDate: null,
      employees: toCount(row[27]) ?? toCount(row[26]),
      type: text(row[19]),
    });
  }
  return out;
}

const stripTags = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

export function parseWashington(html: string): Draft[] {
  const out: Draft[] = [];
  for (const [, row] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) =>
      stripTags(m[1]),
    );
    if (cells.length < 7 || !toIso(cells[6])) continue;
    out.push({
      state: "WA",
      company: cells[0],
      location: cells[1] || null,
      noticeDate: toIso(cells[6]),
      effectiveDate: toIso(cells[2]),
      employees: toCount(cells[3]),
      type: [cells[4], cells[5]].filter(Boolean).join(" ") || null,
    });
  }
  return out;
}

const hiddenFields = (html: string) => {
  const fields = new URLSearchParams();
  for (const [tag] of html.matchAll(/<input[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    const type = /type="([^"]*)"/.exec(tag)?.[1];
    if (name && (type === "hidden" || name === "ucPSW$txtSearch"))
      fields.set(name, /value="([^"]*)"/.exec(tag)?.[1] ?? "");
  }
  return fields;
};

const WA_URL = "https://fortress.wa.gov/esd/file/warn/Public/SearchWARN.aspx";

async function fetchWashington(): Promise<Draft[]> {
  const out: Draft[] = [];
  let html = await altText("Washington ESD WARN", WA_URL);
  out.push(...parseWashington(html));
  for (let page = 2; page <= 6; page++) {
    const form = hiddenFields(html);
    form.set("__EVENTTARGET", "ucPSW$gvMain");
    form.set("__EVENTARGUMENT", `Page$${page}`);
    html = await altText("Washington ESD WARN", WA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    out.push(...parseWashington(html));
  }
  return out;
}

const texasRow = z.object({
  notice_date: z.string().nullish(),
  job_site_name: z.string().nullish(),
  city_name: z.string().nullish(),
  total_layoff_number: z.string().nullish(),
  layoff_date: z.string().nullish(),
});

export function parseTexas(rows: z.infer<typeof texasRow>[]): Draft[] {
  return rows.flatMap((row) =>
    row.job_site_name
      ? [
          {
            state: "TX",
            company: row.job_site_name.trim(),
            location: row.city_name ?? null,
            noticeDate: toIso(row.notice_date),
            effectiveDate: toIso(row.layoff_date),
            employees: toCount(row.total_layoff_number),
            type: null,
          },
        ]
      : [],
  );
}

const workbook = async (label: string, url: string) =>
  readWorkbook(
    Buffer.from(
      await (
        await altFetch(label, url, { timeoutMs: 60_000, maxBytes: 25_000_000 })
      ).arrayBuffer(),
    ),
  );

export const warnStates: Record<string, () => Promise<Draft[]>> = {
  CA: async () =>
    parseCalifornia(
      await workbook(
        "California EDD WARN",
        "https://edd.ca.gov/siteassets/files/jobs_and_training/warn/warn_report1.xlsx",
      ),
    ),
  NJ: async () =>
    parseNewJersey(
      await workbook(
        "New Jersey WARN",
        "https://www.nj.gov/labor/assets/PDFs/WARN/WARN_Notice_Archive.xlsx",
      ),
    ),
  IL: async () =>
    parseIllinois(
      await workbook(
        "Illinois WARN",
        "https://apps.illinoisworknet.com/iebs/api/public/export?search=&layoffTypes=&trade=0&dateReportedStart=Invalid%20Date&dateReportedEnd=Invalid%20Date&statuses=4&reasons=&eventCauses=&naicsCodes=1&naicIndustries=&naics=&unionsInvolved=0&geolocation=1&cities=&counties=&lwias=&includeAdditionalLwias=false&edrs=&lat=0&lng=0&distance=.5&memberType=1&users=&accessList=&bookmarked=false",
      ),
    ),
  WA: fetchWashington,
  TX: async () =>
    parseTexas(
      z.array(texasRow).parse(
        await altJson<unknown>(
          "Texas Workforce Commission WARN",
          `https://data.texas.gov/resource/8w53-c4f6.json?${new URLSearchParams(
            {
              $order: "notice_date DESC",
              $limit: "1500",
            },
          )}`,
        ),
      ),
    ),
};

async function stateNotices(state: string) {
  const load = warnStates[state];
  return cached({
    source: "warn",
    key: state,
    ttlMs: 6 * 3_600_000,
    schema: noticeDoc,
    load: async () => {
      const drafts = await load();
      const resolved = new Map<string, string | null>();
      for (const name of new Set(drafts.map((d) => d.company)))
        resolved.set(name, (await resolveName(name))?.ticker ?? null);
      return drafts.map((d) => ({
        ...d,
        ticker: resolved.get(d.company) ?? null,
      }));
    },
  });
}

type Loaded = {
  notices: WarnNotice[];
  states: WarnFeed["states"];
  fetchedAt: number;
  stale: boolean;
};

async function loadStates(only: string | null): Promise<Loaded> {
  const wanted = only ? [only] : Object.keys(warnStates);
  const results = await Promise.allSettled(wanted.map(stateNotices));
  const notices: WarnNotice[] = [];
  const states: WarnFeed["states"] = [];
  let fetchedAt = 0;
  let stale = false;
  results.forEach((result, i) => {
    const state = wanted[i];
    if (result.status === "fulfilled") {
      notices.push(...result.value.value);
      states.push({ state, ok: true, count: result.value.value.length });
      fetchedAt = Math.max(fetchedAt, result.value.fetchedAt);
      stale ||= result.value.stale;
    } else
      states.push({
        state,
        ok: false,
        count: 0,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : "Unavailable.",
      });
  });
  if (!states.some((s) => s.ok))
    throw new AltUnavailable("No state WARN source answered.");
  return { notices, states, fetchedAt: fetchedAt || Date.now(), stale };
}

const byRecency = (a: WarnNotice, b: WarnNotice) =>
  (b.noticeDate ?? "").localeCompare(a.noticeDate ?? "") ||
  (b.employees ?? 0) - (a.employees ?? 0);

const SOURCE = "State WARN notices (CA, NJ, IL, WA, TX)";

export async function warnRecent(
  state: string | null,
  days: number,
  limit = 150,
): Promise<AltResult<WarnFeed>> {
  if (state && !warnStates[state])
    throw new AltBadRequest(
      `state must be one of ${Object.keys(warnStates).join(", ")}.`,
    );
  const loaded = await loadStates(state);
  const cutoff = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const notices = loaded.notices
    .filter((n) => n.noticeDate && n.noticeDate >= cutoff)
    .sort(byRecency)
    .slice(0, limit);
  return {
    data: { days, states: loaded.states, notices },
    source: SOURCE,
    asOf: notices[0]?.noticeDate ?? null,
    fetchedAt: loaded.fetchedAt,
    stale: loaded.stale,
  };
}

export async function warnTicker(
  rawSymbol: string,
): Promise<AltResult<WarnTicker>> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol))
    throw new AltBadRequest("Invalid symbol.");
  const loaded = await loadStates(null);
  const notices = loaded.notices
    .filter((n) => n.ticker === symbol)
    .sort(byRecency)
    .slice(0, 100);
  return {
    data: { symbol, notices },
    source: SOURCE,
    asOf: notices[0]?.noticeDate ?? null,
    fetchedAt: loaded.fetchedAt,
    stale: loaded.stale,
  };
}
