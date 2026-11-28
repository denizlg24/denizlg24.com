import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { namesFor } from "../entities";
import { altJson } from "../http";
import { AltBadRequest, type AltResult, AltUnavailable } from "../types";
import { cosineDistance, distribution, mean, stdev } from "./stats";
import type { PatentMetrics, PatentRecord, PatentsTicker } from "./types";

const ENDPOINT = "https://api.uspto.gov/api/v1/patent/applications/search";
const DAY = 86_400_000;
const WINDOW_DAYS = 90;

const meta = z.object({
  inventionTitle: z.string().nullish(),
  patentNumber: z.string().nullish(),
  grantDate: z.string().nullish(),
  firstApplicantName: z.string().nullish(),
  cpcClassificationBag: z.array(z.string()).nullish(),
  earliestPublicationDate: z.string().nullish(),
  earliestPublicationNumber: z.string().nullish(),
});
const searchResponse = z.object({
  count: z.number().optional(),
  patentFileWrapperDataBag: z
    .array(
      z.object({
        applicationNumberText: z.string(),
        applicationMetaData: meta.nullish(),
      }),
    )
    .optional(),
});
type SearchResponse = z.infer<typeof searchResponse>;

const record = z.object({
  number: z.string().nullable(),
  applicationNumber: z.string(),
  title: z.string(),
  date: z.string(),
  kind: z.enum(["grant", "application"]),
  applicant: z.string().nullable(),
  cpc: z.array(z.string()),
});
const doc = z.object({
  symbol: z.string(),
  names: z.array(z.string()),
  grants: z.array(record),
  applications: z.array(record),
  metrics: z.object({
    trailing90: z.number(),
    priorWindows: z.array(z.number()),
    momentumZ: z.number().nullable(),
    driftCosine: z.number().nullable(),
    driftSample: z.object({ recent: z.number(), prior: z.number() }),
  }),
});

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const usptoConfigured = () => Boolean(process.env.USPTO_API_KEY);

async function search(body: Record<string, unknown>): Promise<SearchResponse> {
  const key = process.env.USPTO_API_KEY;
  if (!key)
    throw new AltUnavailable(
      "Patent data needs a USPTO Open Data Portal API key (USPTO_API_KEY); none is configured.",
      503,
      false,
    );
  try {
    return searchResponse.parse(
      await altJson<unknown>("USPTO Open Data Portal", ENDPOINT, {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        timeoutMs: 30_000,
      }),
    );
  } catch (error) {
    if (error instanceof AltUnavailable) {
      if (error.status === 404)
        return { count: 0, patentFileWrapperDataBag: [] };
      if (/HTTP 40[13]\b/.test(error.message))
        throw new AltUnavailable(
          "USPTO rejected the configured API key.",
          503,
          false,
        );
    }
    throw error;
  }
}

const quoted = (name: string) => `"${name.replaceAll('"', "")}"`;

export const applicantQuery = (names: string[]) =>
  `applicationMetaData.firstApplicantName:(${names.map(quoted).join(" OR ")})`;

const body = (
  q: string,
  dateField: string,
  from: string,
  to: string,
  limit: number,
  fields: string[],
) => ({
  q,
  rangeFilters: [{ field: dateField, valueFrom: from, valueTo: to }],
  sort: [{ field: dateField, order: "desc" }],
  fields,
  pagination: { offset: 0, limit },
});

const GRANT_DATE = "applicationMetaData.grantDate";
const PUB_DATE = "applicationMetaData.earliestPublicationDate";
const listFields = [
  "applicationNumberText",
  "applicationMetaData.inventionTitle",
  "applicationMetaData.patentNumber",
  "applicationMetaData.grantDate",
  "applicationMetaData.firstApplicantName",
  "applicationMetaData.cpcClassificationBag",
  "applicationMetaData.earliestPublicationDate",
  "applicationMetaData.earliestPublicationNumber",
];

export function toRecords(
  response: SearchResponse,
  kind: PatentRecord["kind"],
): PatentRecord[] {
  const out: PatentRecord[] = [];
  for (const item of response.patentFileWrapperDataBag ?? []) {
    const m = item.applicationMetaData;
    const date = kind === "grant" ? m?.grantDate : m?.earliestPublicationDate;
    if (!m || !date) continue;
    out.push({
      number:
        (kind === "grant" ? m.patentNumber : m.earliestPublicationNumber) ??
        null,
      applicationNumber: item.applicationNumberText,
      title: m.inventionTitle ?? "",
      date,
      kind,
      applicant: m.firstApplicantName ?? null,
      cpc: m.cpcClassificationBag ?? [],
    });
  }
  return out;
}

export function computeMetrics(
  windows: number[],
  recent: string[][],
  prior: string[][],
): PatentMetrics {
  const [trailing90, ...earlier] = windows;
  const sd = stdev(earlier);
  const avg = mean(earlier);
  return {
    trailing90,
    priorWindows: earlier.toReversed(),
    momentumZ:
      sd && avg != null && earlier.length >= 4 ? (trailing90 - avg) / sd : null,
    driftCosine:
      recent.length >= 10 && prior.length >= 10
        ? cosineDistance(distribution(recent), distribution(prior))
        : null,
    driftSample: { recent: recent.length, prior: prior.length },
  };
}

async function build(symbol: string): Promise<PatentsTicker> {
  const names = await namesFor(symbol);
  if (!names)
    throw new AltUnavailable(`${symbol} is not an SEC registrant.`, 404, false);
  const applicants = [...new Set([names.name, ...names.aliases])].slice(0, 4);
  const q = applicantQuery(applicants);
  const now = Date.now();
  // The ODP allows one request at a time per key, so these run in sequence.
  const grantsList = toRecords(
    await search(
      body(q, GRANT_DATE, isoDay(now - 365 * DAY), isoDay(now), 25, listFields),
    ),
    "grant",
  );
  const applicationsList = toRecords(
    await search(
      body(q, PUB_DATE, isoDay(now - 365 * DAY), isoDay(now), 15, listFields),
    ),
    "application",
  );
  const windows: number[] = [];
  for (let i = 0; i < 8; i++) {
    const to = now - i * WINDOW_DAYS * DAY;
    const from = to - WINDOW_DAYS * DAY + (i === 0 ? 0 : DAY);
    const response = await search(
      body(q, GRANT_DATE, isoDay(from), isoDay(to), 1, [
        "applicationNumberText",
      ]),
    );
    windows.push(response.count ?? 0);
  }
  const sample = async (from: number, to: number) =>
    toRecords(
      await search(
        body(q, GRANT_DATE, isoDay(from), isoDay(to), 100, [
          "applicationNumberText",
          "applicationMetaData.grantDate",
          "applicationMetaData.cpcClassificationBag",
        ]),
      ),
      "grant",
    ).map((r) => r.cpc);
  const recent = await sample(now - 365 * DAY, now);
  const prior = await sample(now - 3 * 365 * DAY, now - 365 * DAY - DAY);
  return {
    symbol,
    names: applicants,
    grants: grantsList,
    applications: applicationsList,
    metrics: computeMetrics(windows, recent, prior),
  };
}

export async function patentsTicker(
  rawSymbol: string,
): Promise<AltResult<PatentsTicker>> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol))
    throw new AltBadRequest("Invalid symbol.");
  if (!usptoConfigured())
    throw new AltUnavailable(
      "Patent data needs a USPTO Open Data Portal API key (USPTO_API_KEY); none is configured.",
      503,
      false,
    );
  const { value, fetchedAt, stale } = await cached({
    source: "uspto-patents",
    key: symbol,
    ttlMs: 24 * 3_600_000,
    schema: doc,
    load: () => build(symbol),
  });
  return {
    data: value,
    source: "USPTO Open Data Portal patent file wrapper",
    asOf: value.grants[0]?.date ?? null,
    fetchedAt,
    stale,
  };
}
