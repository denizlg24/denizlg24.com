import "server-only";
import { z } from "zod";
import { secFetch, secHeaders, takeSlot } from "../../sec-data";
import { cached } from "../cache";
import { AltUnavailable } from "../types";

const LABEL = "SEC EDGAR";

function unavailable(error: unknown): AltUnavailable {
  if (error instanceof AltUnavailable) return error;
  const status = Number(
    /HTTP (\d{3})/.exec(error instanceof Error ? error.message : "")?.[1],
  );
  if (status === 404)
    return new AltUnavailable("SEC EDGAR has no such document.", 404, false);
  if (status)
    return new AltUnavailable(
      `${LABEL} returned HTTP ${status}.`,
      502,
      status >= 500 || status === 429,
    );
  if (error instanceof Error && error.name === "TimeoutError")
    return new AltUnavailable(`${LABEL} did not answer in time.`);
  if (error instanceof Error && /too large/i.test(error.message))
    return new AltUnavailable(
      "The SEC document is too large to process.",
      502,
      false,
    );
  return new AltUnavailable(`${LABEL} is unavailable right now.`);
}

export async function secText(
  url: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<string> {
  try {
    return await (await secFetch(url, options)).text();
  } catch (error) {
    throw unavailable(error);
  }
}

export async function secJson<S extends z.ZodType>(
  url: string,
  schema: S,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<z.infer<S>> {
  const text = await secText(url, options);
  try {
    return schema.parse(JSON.parse(text));
  } catch {
    throw new AltUnavailable(
      `${LABEL} sent a response in an unexpected shape.`,
    );
  }
}

/** Range requests share secFetch's limiter; secFetch itself cannot send the header. */
export async function secRange(url: string, range: string): Promise<Response> {
  await takeSlot();
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { ...secHeaders(), Range: range },
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    throw unavailable(error);
  }
  if (!response.ok && response.status !== 206)
    throw unavailable(new Error(`HTTP ${response.status}`));
  return response;
}

export const archiveUrl = (cik: string, accession: string, file = "") =>
  `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${file}`;

export const padCik = (cik: string | number) => String(cik).padStart(10, "0");

const submissionsSchema = z.object({
  name: z.string(),
  filings: z.object({
    recent: z.object({
      accessionNumber: z.array(z.string()),
      filingDate: z.array(z.string()),
      reportDate: z.array(z.string()),
      form: z.array(z.string()),
      primaryDocument: z.array(z.string()),
    }),
  }),
});

const filingRowSchema = z.object({
  accession: z.string(),
  form: z.string(),
  filed: z.string(),
  period: z.string(),
  primaryDocument: z.string(),
});
export type FilingRow = z.infer<typeof filingRowSchema>;

const filingListSchema = z.object({
  name: z.string(),
  filings: z.array(filingRowSchema),
});

/** A company's recent filings of the given forms, newest first. */
export async function recentFilings(
  cik: string,
  forms: (form: string) => boolean,
  tag: string,
  ttlMs = 30 * 60_000,
) {
  return cached({
    source: "sec-submissions",
    key: `${padCik(cik)}:${tag}`,
    ttlMs,
    schema: filingListSchema,
    load: async () => {
      const data = await secJson(
        `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`,
        submissionsSchema,
        { timeoutMs: 30_000, maxBytes: 40_000_000 },
      );
      const recent = data.filings.recent;
      const filings: FilingRow[] = [];
      recent.form.forEach((form, index) => {
        if (!forms(form)) return;
        filings.push({
          accession: recent.accessionNumber[index],
          form,
          filed: recent.filingDate[index],
          period: recent.reportDate[index],
          primaryDocument: recent.primaryDocument[index],
        });
      });
      return { name: data.name, filings };
    },
  });
}

const eftsSchema = z.object({
  hits: z.object({
    total: z.object({ value: z.number() }),
    hits: z.array(
      z.object({
        _id: z.string(),
        _source: z.object({
          ciks: z.array(z.string()),
          display_names: z.array(z.string()),
          period_ending: z.string().nullable().optional(),
          file_date: z.string(),
          adsh: z.string(),
          form: z.string(),
        }),
      }),
    ),
  }),
});
export type EftsResult = z.infer<typeof eftsSchema>["hits"];

/** EDGAR full-text search; covers filings within minutes of acceptance. */
export async function efts(
  params: Record<string, string>,
): Promise<EftsResult> {
  const url = `https://efts.sec.gov/LATEST/search-index?${new URLSearchParams(params)}`;
  return (await secJson(url, eftsSchema, { timeoutMs: 25_000 })).hits;
}
