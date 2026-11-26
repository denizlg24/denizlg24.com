import "server-only";
import { XMLParser } from "fast-xml-parser";
import { symbolPattern } from "../universes";

const productionFlex =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";

function flexBase() {
  const override = process.env.IBKR_FLEX_URL;
  return override && process.env.DEMO_MODE === "1" ? override : productionFlex;
}

export class FlexError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
    readonly credentials: boolean,
  ) {
    super(message);
  }
}

const credentialCodes = new Set([
  "1011",
  "1012",
  "1013",
  "1014",
  "1015",
  "1016",
]);
const retryCodes = new Set([
  "1001",
  "1004",
  "1005",
  "1006",
  "1007",
  "1008",
  "1009",
  "1018",
  "1019",
  "1021",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name) =>
    ["FlexStatement", "OpenPosition", "CashReportCurrency"].includes(name),
});

type Attributes = Record<string, string | undefined>;
type FlexStatus = {
  Status?: string;
  ReferenceCode?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
};

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function flexGet(path: string, params: Record<string, string>) {
  const url = new URL(`${flexBase()}/${path}`);
  for (const [key, val] of Object.entries(params))
    url.searchParams.set(key, val);
  const response = await fetch(url, {
    headers: { "User-Agent": "Stockwatcher/1.0", Accept: "application/xml" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new FlexError(
      `Interactive Brokers answered ${response.status}.`,
      null,
      false,
    );
  return response.text();
}

function statusError(status: FlexStatus) {
  const code = status.ErrorCode ?? null;
  return new FlexError(
    status.ErrorMessage?.trim() || "Interactive Brokers rejected the request.",
    code,
    code != null && credentialCodes.has(code),
  );
}

/** Runs a Flex query and returns the raw statement XML. */
export async function fetchFlexStatement(token: string, queryId: string) {
  let reference: string | undefined;
  for (let attempt = 0; attempt < 4 && !reference; attempt++) {
    const status = parser.parse(
      await flexGet("SendRequest", { t: token, q: queryId, v: "3" }),
    ).FlexStatementResponse as FlexStatus | undefined;
    if (status?.Status === "Success" && status.ReferenceCode)
      reference = String(status.ReferenceCode);
    else if (status?.ErrorCode && retryCodes.has(String(status.ErrorCode)))
      await pause(3_000 * (attempt + 1));
    else throw statusError(status ?? {});
  }
  if (!reference)
    throw new FlexError(
      "Interactive Brokers is busy. Try again in a few minutes.",
      null,
      false,
    );
  for (let attempt = 0; attempt < 10; attempt++) {
    await pause(attempt === 0 ? 1_500 : 3_000);
    const xml = await flexGet("GetStatement", {
      t: token,
      q: reference,
      v: "3",
    });
    const parsed = parser.parse(xml);
    if (parsed.FlexQueryResponse) return xml;
    const status = parsed.FlexStatementResponse as FlexStatus | undefined;
    if (!status?.ErrorCode || !retryCodes.has(String(status.ErrorCode)))
      throw statusError(status ?? {});
  }
  throw new FlexError(
    "Interactive Brokers is still generating the statement. Try again shortly.",
    "1019",
    false,
  );
}

export type BrokerLot = {
  account: string;
  symbol: string;
  currency: string;
  quantity: number;
  price: number;
  date: string;
};

export type Skipped = { account: string; symbol: string; reason: string };

export type BrokerStatement = {
  accounts: Array<{
    id: string;
    asOf: string;
    lots: BrokerLot[];
    cash: Array<{ currency: string; amount: number }>;
  }>;
  skipped: Skipped[];
};

/** IBKR listing exchange → Yahoo suffix, with any quote-unit rescale. */
const venues: Record<
  string,
  { suffix: string; minor?: Record<string, string> }
> = {
  NASDAQ: { suffix: "" },
  NYSE: { suffix: "" },
  ARCA: { suffix: "" },
  AMEX: { suffix: "" },
  BATS: { suffix: "" },
  IEX: { suffix: "" },
  PINK: { suffix: "" },
  LSE: { suffix: ".L", minor: { GBP: "GBp" } },
  LSEETF: { suffix: ".L", minor: { GBP: "GBp" } },
  LSEIOB1: { suffix: ".IL" },
  SBF: { suffix: ".PA" },
  AEB: { suffix: ".AS" },
  ENEXT_BE: { suffix: ".BR" },
  "ENEXT.BE": { suffix: ".BR" },
  EBR: { suffix: ".BR" },
  BVL: { suffix: ".LS" },
  ISED: { suffix: ".IR" },
  IBIS: { suffix: ".DE" },
  IBIS2: { suffix: ".DE" },
  XETRA: { suffix: ".DE" },
  FWB: { suffix: ".F" },
  FWB2: { suffix: ".F" },
  GETTEX: { suffix: ".MU" },
  SWB: { suffix: ".SG" },
  EBS: { suffix: ".SW" },
  SWX: { suffix: ".SW" },
  VIRTX: { suffix: ".SW" },
  BVME: { suffix: ".MI" },
  "BVME.ETF": { suffix: ".MI" },
  BM: { suffix: ".MC" },
  VSE: { suffix: ".VI" },
  WSE: { suffix: ".WA" },
  SFB: { suffix: ".ST" },
  CPH: { suffix: ".CO" },
  KFB: { suffix: ".CO" },
  OSE: { suffix: ".OL" },
  HEX: { suffix: ".HE" },
  TSE: { suffix: ".TO" },
  VENTURE: { suffix: ".V" },
  ASX: { suffix: ".AX" },
  SEHK: { suffix: ".HK" },
  TSEJ: { suffix: ".T" },
  SGX: { suffix: ".SI" },
  NSE: { suffix: ".NS" },
  JSE: { suffix: ".JO", minor: { ZAR: "ZAc" } },
  TASE: { suffix: ".TA", minor: { ILS: "ILA" } },
  MEXI: { suffix: ".MX" },
};

const supportedAssets = new Set(["STK", "FUND", "ETF"]);

export function yahooListing(
  symbol: string,
  exchange: string,
  currency: string,
) {
  const venue = venues[exchange.toUpperCase()];
  if (!venue) return null;
  let base = symbol.trim().toUpperCase().replace(/[ .]/g, "-");
  if (venue.suffix === ".HK") base = base.padStart(4, "0");
  const unit = venue.minor?.[currency];
  return {
    symbol: `${base}${venue.suffix}`,
    currency: unit ?? currency,
    scale: unit ? 100 : 1,
  };
}

export function flexDate(raw: string | undefined): string | null {
  const text = raw?.split(/[;, ]/)[0]?.trim();
  if (!text) return null;
  let match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return text;
  match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (match) return `${match[3]}-${match[1]}-${match[2]}`;
  return null;
}

const num = (raw: string | undefined) => {
  const parsed = Number(raw?.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export function parseFlexStatement(xml: string): BrokerStatement {
  const root = parser.parse(xml).FlexQueryResponse as
    | { FlexStatements?: { FlexStatement?: Array<Record<string, unknown>> } }
    | undefined;
  if (!root)
    throw new FlexError("The Flex report could not be read.", null, false);
  const statements = root.FlexStatements?.FlexStatement ?? [];
  const skipped: Skipped[] = [];
  const accounts: BrokerStatement["accounts"] = [];
  for (const statement of statements) {
    const head = statement as Attributes;
    const id = head.accountId?.trim();
    if (!id) continue;
    const asOf =
      flexDate(head.toDate) ??
      flexDate(head.whenGenerated) ??
      new Date().toISOString().slice(0, 10);
    const section = statement.OpenPositions as
      | { OpenPosition?: Attributes[] }
      | undefined;
    const rows = section?.OpenPosition ?? [];
    const lotKeys = new Set(
      rows
        .filter((row) => row.levelOfDetail?.toUpperCase() === "LOT")
        .map((row) => row.conid ?? row.symbol),
    );
    const lots: BrokerLot[] = [];
    for (const row of rows) {
      const detail = row.levelOfDetail?.toUpperCase();
      const key = row.conid ?? row.symbol;
      if (detail === "SUMMARY" && lotKeys.has(key)) continue;
      const label = row.symbol?.trim() || row.description?.trim() || "?";
      const asset = row.assetCategory?.toUpperCase() ?? "STK";
      if (!supportedAssets.has(asset)) {
        skipped.push({
          account: id,
          symbol: label,
          reason: `${asset} positions are not tracked`,
        });
        continue;
      }
      const quantity = num(row.position);
      if (quantity == null || quantity === 0) continue;
      if (quantity < 0) {
        skipped.push({ account: id, symbol: label, reason: "short position" });
        continue;
      }
      const currency = row.currency?.trim().toUpperCase() ?? "";
      const listing = yahooListing(
        label,
        row.listingExchange ?? row.exchange ?? "",
        currency,
      );
      if (!listing || !symbolPattern.test(listing.symbol)) {
        skipped.push({
          account: id,
          symbol: label,
          reason: `no quote mapping for ${row.listingExchange || "its exchange"}`,
        });
        continue;
      }
      const basis = num(row.costBasisMoney);
      const unit =
        basis != null && basis > 0 ? basis / quantity : num(row.costBasisPrice);
      if (unit == null || unit <= 0) {
        skipped.push({ account: id, symbol: label, reason: "no cost basis" });
        continue;
      }
      lots.push({
        account: id,
        symbol: listing.symbol,
        currency: listing.currency,
        quantity,
        price: unit * listing.scale,
        date: flexDate(row.openDateTime) ?? flexDate(row.reportDate) ?? asOf,
      });
    }
    const cashSection = statement.CashReport as
      | { CashReportCurrency?: Attributes[] }
      | undefined;
    const cash = (cashSection?.CashReportCurrency ?? [])
      .filter((row) => row.currency && row.currency !== "BASE_SUMMARY")
      .map((row) => ({
        currency: row.currency!.toUpperCase(),
        amount: num(row.endingCash) ?? num(row.endingSettledCash) ?? 0,
      }))
      .filter((row) => row.amount !== 0);
    accounts.push({ id, asOf, lots, cash });
  }
  if (!accounts.length)
    throw new FlexError(
      "The Flex report has no accounts. Check that the query includes Open Positions.",
      null,
      false,
    );
  return { accounts, skipped };
}
