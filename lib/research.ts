import "server-only";
import { XMLParser } from "fast-xml-parser";
import type {
  CompanyResearch,
  Filing,
  HoldingsReport,
  Mention,
} from "./research-types";

const secHeaders = () => ({
  "User-Agent":
    process.env.SEC_USER_AGENT ||
    "Stockwatcher research contact research@denizlg24.com",
});
async function sec<T>(host: string, path: string, ttl = 3600): Promise<T> {
  const response = await fetch(`https://${host}${path}`, {
    headers: secHeaders(),
    next: { revalidate: ttl },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok)
    throw new Error(`SEC EDGAR returned HTTP ${response.status}.`);
  return path.endsWith(".xml")
    ? ((await response.text()) as T)
    : ((await response.json()) as T);
}

type Recent = {
  form: string[];
  primaryDocument: string[];
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
};
type Submission = {
  name: string;
  filings: { recent: Recent; files?: Array<{ name: string }> };
};
type SecFact = {
  units: Record<
    string,
    Array<{
      val: number;
      end: string;
      start?: string;
      filed: string;
      form: string;
    }>
  >;
};

const archive = (cik: string, accession: string) =>
  `/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}`;
const submission = (cik: string) =>
  sec<Submission>(
    "data.sec.gov",
    `/submissions/CIK${cik.padStart(10, "0")}.json`,
  );

export async function companyResearch(
  symbol: string,
): Promise<CompanyResearch> {
  const tickers = await sec<
    Record<string, { ticker: string; cik_str: number }>
  >("www.sec.gov", "/files/company_tickers.json", 86400);
  const item = Object.values(tickers).find((item) => item.ticker === symbol);
  if (!item) return null;
  const cik = String(item.cik_str);
  const [record, facts] = await Promise.all([
    submission(cik),
    sec<{ facts: Record<string, Record<string, SecFact>> }>(
      "data.sec.gov",
      `/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`,
    ).catch(() => null),
  ]);
  const recent = record.filings.recent;
  const filings: Filing[] = recent.form
    .flatMap((form, index) => {
      if (!/^(10-[KQ]|8-K|20-F|6-K|40-F|DEF 14A)(\/A)?$/.test(form)) return [];
      return [
        {
          form,
          filed: recent.filingDate[index],
          report: recent.reportDate[index],
          url: `https://www.sec.gov${archive(cik, recent.accessionNumber[index])}/${recent.primaryDocument[index]}`,
        },
      ];
    })
    .slice(0, 12);
  const taxonomy = facts?.facts["us-gaap"] ?? {};
  const metrics = [
    [
      "Revenue",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "SalesRevenueNet",
    ],
    ["Net income", "NetIncomeLoss", "ProfitLoss"],
    ["Diluted EPS", "EarningsPerShareDiluted"],
    ["Operating cash flow", "NetCashProvidedByUsedInOperatingActivities"],
    ["Cash and equivalents", "CashAndCashEquivalentsAtCarryingValue"],
    ["Assets", "Assets"],
    ["Liabilities", "Liabilities"],
  ].flatMap(([label, ...keys]) => {
    const metric = keys.map((key) => taxonomy[key]).find(Boolean);
    const unit = Object.keys(metric?.units ?? {}).find(
      (key) => key === "USD" || key === "USD/shares",
    );
    if (!metric || !unit) return [];
    const mostRecent = metric.units[unit]
      .filter(
        (entry) =>
          /^10-K(?:\/A)?$/.test(entry.form) &&
          (!entry.start ||
            (Date.parse(entry.end) - Date.parse(entry.start)) / 86_400_000 >=
              350),
      )
      .toSorted(
        (a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed),
      )[0];
    return mostRecent
      ? [
          {
            label,
            unit,
            value: mostRecent.val,
            period: mostRecent.end,
            filed: mostRecent.filed,
            form: mostRecent.form,
          },
        ]
      : [];
  });
  return {
    company: record.name,
    cik,
    filings,
    facts: metrics,
    url: `https://www.sec.gov/edgar/browse/?CIK=${cik}`,
  };
}

const parser = new XMLParser({
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: false,
  isArray: (_name, path) => path === "informationTable.infoTable",
});
type RawHolding = {
  nameOfIssuer?: string;
  cusip?: string;
  value?: string;
  titleOfClass?: string;
  putCall?: string;
  shrsOrPrnAmt?: { sshPrnamt?: string };
};
type QuarterFiling = {
  accession: string;
  form: string;
  filed: string;
  period: string;
  document: string;
};

function extract13fs(recent: Recent): QuarterFiling[] {
  return recent.form.flatMap((form, index) =>
    form === "13F-HR" || form === "13F-HR/A"
      ? [
          {
            form,
            accession: recent.accessionNumber[index],
            filed: recent.filingDate[index],
            period: recent.reportDate[index],
            document: recent.primaryDocument[index],
          },
        ]
      : [],
  );
}

async function holdingsFromFiling(cik: string, filing: QuarterFiling) {
  const base = archive(cik, filing.accession);
  const primary = filing.document.split("/").at(-1);
  const listing = await sec<{ directory: { item: Array<{ name: string }> } }>(
    "www.sec.gov",
    `${base}/index.json`,
  );
  const files = listing.directory.item
    .map(({ name }) => name)
    .filter((name) => /^[\w.-]+\.xml$/i.test(name) && name !== primary)
    .slice(0, 6);
  const parsed = await Promise.all(
    files.map(async (file) => {
      const xml = await sec<string>("www.sec.gov", `${base}/${file}`);
      if (xml.length > 12_000_000)
        throw new Error("The filing exceeds the supported table size.");
      return (
        (
          parser.parse(xml) as {
            informationTable?: { infoTable?: RawHolding[] };
          }
        ).informationTable?.infoTable ?? []
      );
    }),
  );
  const factor = filing.filed < "2023-01-03" ? 1000 : 1;
  return parsed.flat().flatMap((item) => {
    const value = Number(item.value) * factor;
    const shares = Number(item.shrsOrPrnAmt?.sshPrnamt);
    if (
      !item.nameOfIssuer ||
      !Number.isFinite(value) ||
      !Number.isFinite(shares)
    )
      return [];
    return [
      {
        name: item.nameOfIssuer,
        cusip: item.cusip ?? "",
        value,
        shares,
        type: item.titleOfClass ?? "",
        putCall: item.putCall ?? "",
      },
    ];
  });
}

async function amendmentKind(cik: string, filing: QuarterFiling) {
  const doc = filing.document.split("/").at(-1) ?? "";
  if (!/^[\w.-]+\.xml$/i.test(doc))
    throw new Error("The 13F amendment type could not be verified.");
  const xml = await sec<string>(
    "www.sec.gov",
    `${archive(cik, filing.accession)}/${doc}`,
  );
  const parsed = parser.parse(xml) as {
    edgarSubmission?: {
      formData?: { coverPage?: { amendmentInfo?: { amendmentType?: string } } };
    };
  };
  const kind =
    parsed.edgarSubmission?.formData?.coverPage?.amendmentInfo?.amendmentType
      ?.trim()
      .toUpperCase();
  if (kind === "RESTATEMENT") return "replace";
  if (kind === "NEW HOLDINGS") return "append";
  throw new Error("The 13F amendment type could not be verified.");
}

export async function holdingsReport(cik: string): Promise<HoldingsReport> {
  const record = await submission(cik);
  const filings = extract13fs(record.filings.recent);
  for (const file of record.filings.files?.slice(0, 3) ?? []) {
    if (filings.some((item) => item.form === "13F-HR")) break;
    if (!/^CIK\d+-submissions-\d+\.json$/.test(file.name)) continue;
    filings.push(
      ...extract13fs(
        await sec<Recent>("data.sec.gov", `/submissions/${file.name}`),
      ),
    );
  }
  const original = filings.find((item) => item.form === "13F-HR");
  if (!original)
    throw new Error("No 13F holdings report was found for this filer.");
  const amendments = filings
    .filter(
      (item) =>
        item.form === "13F-HR/A" &&
        item.period === original.period &&
        item.filed >= original.filed,
    )
    .reverse();
  if (amendments.length > 10)
    throw new Error(
      "This report has more than 10 amendments. Review its filings on SEC EDGAR.",
    );
  let included = [original];
  for (const amendment of amendments) {
    included =
      (await amendmentKind(cik, amendment)) === "replace"
        ? [amendment]
        : [...included, amendment];
  }
  const reports = await Promise.all(
    included.map((item) => holdingsFromFiling(cik, item)),
  );
  const holdings = reports.flat().sort((a, b) => b.value - a.value);
  if (!holdings.length)
    throw new Error("The filing does not contain a readable holdings table.");
  const latest = included.at(-1)!;
  return {
    manager: record.name,
    period: original.period,
    filed: latest.filed,
    url: `https://www.sec.gov${archive(cik, latest.accession)}/${latest.accession}-index.html`,
    amended: included.length > 1 || latest.form === "13F-HR/A",
    holdings,
  };
}

export async function socialMentions(): Promise<Mention[]> {
  const response = await fetch(
    "https://apewisdom.io/api/v1.0/filter/wallstreetbets/page/1",
    {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(6500),
    },
  );
  if (!response.ok)
    throw new Error("WallStreetBets mention data is temporarily unavailable.");
  const data = (await response.json()) as {
    results?: Array<{
      ticker: string;
      name: string;
      mentions: number;
      mentions_24h_ago: number;
      rank: number;
      upvotes: number;
    }>;
  };
  return (data.results ?? []).slice(0, 50).map((item) => ({
    symbol: item.ticker,
    name: item.name,
    count: item.mentions,
    prior: item.mentions_24h_ago,
    rank: item.rank,
    upvotes: item.upvotes,
  }));
}
