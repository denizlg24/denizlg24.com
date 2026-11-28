import "server-only";
import { z } from "zod";
import { cached } from "../cache";
import { AltUnavailable } from "../types";
import { secRange, secText } from "./edgar";
import { streamLines, zipDirectory, zipEntryStream } from "./zip";

const PAGE =
  "https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets";
const KEEP = 300;

const filersSchema = z.object({
  dataset: z.string(),
  period: z.string(),
  filers: z.array(
    z.object({ cik: z.string(), name: z.string(), value: z.number() }),
  ),
});
export type TopFilers = z.infer<typeof filersSchema>;

const months: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};
const isoFromDera = (text: string) => {
  const match = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(text);
  return match && months[match[2]]
    ? `${match[3]}-${months[match[2]]}-${match[1]}`
    : "";
};

async function* rows(
  fetchRange: (range: string) => Promise<Response>,
  entry: Parameters<typeof zipEntryStream>[1],
): AsyncGenerator<string[]> {
  let first = true;
  for await (const line of streamLines(
    await zipEntryStream(fetchRange, entry),
  )) {
    if (first) {
      first = false;
      continue;
    }
    yield line.split("\t");
  }
}

async function build(): Promise<TopFilers> {
  const page = await secText(PAGE);
  const path = /href="(\/files\/[^"]*_form13f\.zip)"/.exec(page)?.[1];
  if (!path)
    throw new AltUnavailable("The SEC 13F data set listing changed shape.");
  const url = `https://www.sec.gov${path}`;
  const fetchRange = (range: string) => secRange(url, range);
  const directory = await zipDirectory(fetchRange);
  const need = (name: string) => {
    const entry = directory.get(name);
    if (!entry) throw new AltUnavailable(`The 13F data set has no ${name}.`);
    return entry;
  };

  const values = new Map<string, number>();
  for await (const [accession, , , value] of rows(
    fetchRange,
    need("SUMMARYPAGE.tsv"),
  ))
    values.set(accession, Number(value));

  const submissions = new Map<string, { cik: string; period: string }>();
  const periodCounts = new Map<string, number>();
  for await (const [accession, , type, cik, period] of rows(
    fetchRange,
    need("SUBMISSION.tsv"),
  )) {
    if (type !== "13F-HR") continue;
    const iso = isoFromDera(period);
    submissions.set(accession, { cik, period: iso });
    periodCounts.set(iso, (periodCounts.get(iso) ?? 0) + 1);
  }
  const period = [...periodCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];
  if (!period)
    throw new AltUnavailable("The 13F data set holds no holdings reports.");

  const top = [...submissions.entries()]
    .filter(
      ([accession, item]) => item.period === period && values.has(accession),
    )
    .sort((a, b) => (values.get(b[0]) ?? 0) - (values.get(a[0]) ?? 0))
    .slice(0, KEEP);
  const wanted = new Set(top.map(([accession]) => accession));
  const names = new Map<string, string>();
  for await (const cells of rows(fetchRange, need("COVERPAGE.tsv")))
    if (wanted.has(cells[0])) names.set(cells[0], cells[9] ?? "");

  const seen = new Set<string>();
  const filers: TopFilers["filers"] = [];
  for (const [accession, item] of top) {
    if (seen.has(item.cik)) continue;
    seen.add(item.cik);
    filers.push({
      cik: item.cik,
      name: names.get(accession) || item.cik,
      value: values.get(accession) ?? 0,
    });
  }
  return { dataset: url, period, filers };
}

/**
 * The largest 13F filers, ranked by reported portfolio value in SEC's quarterly
 * Form 13F data set. Only the three small summary tables are read, through
 * range requests, so the 100 MB archive is never downloaded.
 */
export const topFilers = () =>
  cached({
    source: "sec-13f-bulk",
    key: "top-filers",
    ttlMs: 7 * 86_400_000,
    schema: filersSchema,
    load: build,
  });
