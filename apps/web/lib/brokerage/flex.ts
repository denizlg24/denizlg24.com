import type {
  BrokerageActivity,
  BrokerageCashBalance,
  BrokerageNavChange,
  BrokeragePosition,
  BrokerageSnapshot,
} from "@repo/schemas";

/**
 * Interactive Brokers Flex Web Service: a two-step pull. `SendRequest` queues a
 * statement for a saved Flex Query and returns a reference code; `GetStatement`
 * answers "not ready" until it is generated, then returns the XML.
 *
 * `SendRequest` also returns the host to poll, and it has named
 * `gdcdyn.interactivebrokers.com`, which refused connections. The same
 * reference code works on the host it was issued from, so that is used for
 * both calls.
 */
const FLEX_BASE_URL =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService";

/** Statement still generating (1019), or temporarily unavailable (1018, 1021). */
const RETRYABLE_CODES = new Set(["1018", "1019", "1021"]);

export class FlexError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "FlexError";
    this.code = code;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FlexPullOptions {
  token: string;
  queryId: string;
  fetchImpl?: FetchLike;
  pollIntervalMs?: number;
  maxPolls?: number;
}

function tagText(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim();
}

export async function pullFlexStatement({
  token,
  queryId,
  fetchImpl = fetch,
  pollIntervalMs = 5_000,
  maxPolls = 48,
}: FlexPullOptions): Promise<string> {
  const headers = { "User-Agent": "denizlg24.com/1.0" };
  const params = (q: string) =>
    new URLSearchParams({ t: token, q, v: "3" }).toString();

  const queued = await (
    await fetchImpl(`${FLEX_BASE_URL}/SendRequest?${params(queryId)}`, {
      headers,
    })
  ).text();
  if (tagText(queued, "Status") !== "Success") {
    throw new FlexError(
      tagText(queued, "ErrorMessage") ?? "Flex request refused",
      tagText(queued, "ErrorCode"),
    );
  }
  const reference = tagText(queued, "ReferenceCode");
  if (!reference) throw new FlexError("Flex request returned no reference");

  for (let poll = 0; poll < maxPolls; poll++) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const body = await (
      await fetchImpl(`${FLEX_BASE_URL}/GetStatement?${params(reference)}`, {
        headers,
      })
    ).text();
    if (!body.includes("<FlexStatementResponse")) return body;
    const code = tagText(body, "ErrorCode");
    if (code && RETRYABLE_CODES.has(code)) continue;
    throw new FlexError(
      tagText(body, "ErrorMessage") ?? "Flex statement refused",
      code,
    );
  }
  throw new FlexError("Flex statement was not ready in time");
}

// ---------------------------------------------------------------------------
// Parsing. A Flex statement is flat: every row is a self-closing element whose
// data is entirely in attributes, grouped under one `FlexStatement` per
// account and day (with "breakout by day") or per account and period.
// ---------------------------------------------------------------------------

type Attributes = Record<string, string>;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|\w+);/gi, (entity, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
    }
    if (name.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(name.slice(1), 10));
    }
    return ENTITIES[name] ?? entity;
  });
}

function attributes(source: string): Attributes {
  const result: Attributes = {};
  for (const match of source.matchAll(/(\w+)="([^"]*)"/g)) {
    const [, key, value] = match;
    if (key && value !== undefined) result[key] = decode(value);
  }
  return result;
}

function elements(body: string, tag: string): Attributes[] {
  return [...body.matchAll(new RegExp(`<${tag}\\s([^<>]*?)/?>`, "g"))].map(
    (match) => attributes(match[1] ?? ""),
  );
}

function num(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNum(value: string | undefined): number | undefined {
  return value ? num(value) : undefined;
}

/** `20261023` or `20261023;101601` → `2026-10-23`. */
function isoDay(value: string | undefined): string | undefined {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : undefined;
}

function optionalText(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

/** Cash rows IBKR leaves behind after a conversion, e.g. USD 0.000000001. */
const CASH_DUST = 0.005;

export interface ParsedFlexStatement {
  accountId: string;
  fromDate: string;
  toDate: string;
  entity?: string;
  snapshot: BrokerageSnapshot | null;
  activity: BrokerageActivity[];
}

function parsePosition(row: Attributes): BrokeragePosition {
  const fxRateToBase = num(row.fxRateToBase) || 1;
  const unrealizedPnl = num(row.fifoPnlUnrealized);
  return {
    conid: row.conid ?? "",
    symbol: row.symbol ?? "",
    description: row.description ?? "",
    isin: optionalText(row.isin),
    listingExchange: row.listingExchange ?? "",
    assetCategory: row.assetCategory ?? "",
    subCategory: optionalText(row.subCategory),
    currency: row.currency ?? "",
    fxRateToBase,
    quantity: num(row.position),
    markPrice: num(row.markPrice),
    value: num(row.positionValue),
    valueBase: num(row.positionValue) * fxRateToBase,
    costBasis: num(row.costBasisMoney),
    costBasisPrice: num(row.costBasisPrice),
    unrealizedPnl,
    unrealizedPnlBase: unrealizedPnl * fxRateToBase,
    percentOfNav: num(row.percentOfNAV),
  };
}

function parseNavChange(
  row: Attributes | undefined,
): BrokerageNavChange | null {
  if (!row) return null;
  return {
    startingValue: num(row.startingValue),
    endingValue: num(row.endingValue),
    mtm: num(row.mtm),
    flows:
      num(row.depositsWithdrawals) +
      num(row.assetTransfers) +
      num(row.internalCashTransfers),
    dividends: num(row.dividends),
    withholdingTax: num(row.withholdingTax),
    interest: num(row.interest),
    commissions: num(row.commissions),
    fees: num(row.brokerFees) + num(row.otherFees),
    fxTranslation: num(row.fxTranslation),
    twr: num(row.twr),
  };
}

function parseTrade(row: Attributes): BrokerageActivity | null {
  const date = isoDay(row.tradeDate ?? row.dateTime);
  if (!row.transactionID || !date) return null;
  const fxRateToBase = num(row.fxRateToBase) || 1;
  const amount = num(row.netCash);
  const side =
    row.buySell === "BUY" || row.buySell === "SELL" ? row.buySell : undefined;
  return {
    id: `trade:${row.transactionID}`,
    kind: "trade",
    date,
    type: row.transactionType || "Trade",
    symbol: optionalText(row.symbol),
    description: row.description ?? "",
    currency: row.currency ?? "",
    amount,
    amountBase: amount * fxRateToBase,
    side,
    quantity: optionalNum(row.quantity),
    price: optionalNum(row.tradePrice),
    commission: optionalNum(row.ibCommission),
  };
}

function parseCashTransaction(row: Attributes): BrokerageActivity | null {
  const date = isoDay(row.dateTime ?? row.reportDate);
  if (!row.transactionID || !date) return null;
  const fxRateToBase = num(row.fxRateToBase) || 1;
  const amount = num(row.amount);
  return {
    id: `cash:${row.transactionID}`,
    kind: "cash",
    date,
    type: row.type ?? "Cash",
    symbol: optionalText(row.symbol),
    description: row.description ?? "",
    currency: row.currency ?? "",
    amount,
    amountBase: amount * fxRateToBase,
  };
}

function parseStatement(
  header: Attributes,
  body: string,
): ParsedFlexStatement | null {
  const accountId = header.accountId;
  const fromDate = isoDay(header.fromDate);
  const toDate = isoDay(header.toDate);
  if (!accountId || !fromDate || !toDate) return null;

  const account = elements(body, "AccountInformation")[0];
  const baseCurrency = account?.currency ?? "";

  // The equity summary lists the day before the period as well as the period
  // itself; the statement's own day is the row dated `toDate`.
  const equity = elements(body, "EquitySummaryByReportDateInBase").find(
    (row) => isoDay(row.reportDate) === toDate,
  );
  const positions = elements(body, "OpenPosition")
    .filter((row) => !row.levelOfDetail || row.levelOfDetail === "SUMMARY")
    .map(parsePosition);
  const change = parseNavChange(elements(body, "ChangeInNAV")[0]);
  const cash: BrokerageCashBalance[] = elements(body, "CashReportCurrency")
    .filter((row) => row.levelOfDetail === "Currency")
    .map((row) => ({
      currency: row.currency ?? "",
      amount: num(row.endingCash),
      settled: num(row.endingSettledCash),
    }))
    .filter((row) => Math.abs(row.amount) >= CASH_DUST);

  const nav = num(equity?.total);
  // Days before the account was funded come back as all-zero statements.
  const empty =
    nav === 0 &&
    positions.length === 0 &&
    (change === null ||
      (change.startingValue === 0 &&
        change.endingValue === 0 &&
        change.flows === 0));

  const snapshot: BrokerageSnapshot | null =
    empty || !equity || !baseCurrency
      ? null
      : {
          accountId,
          reportDate: toDate,
          baseCurrency,
          nav,
          cashBase: num(equity.cash),
          change,
          positions,
          cash,
        };

  const activity = [
    ...elements(body, "Trade")
      .filter((row) => !row.levelOfDetail || row.levelOfDetail === "EXECUTION")
      .map(parseTrade),
    ...elements(body, "CashTransaction")
      .filter((row) => !row.levelOfDetail || row.levelOfDetail === "DETAIL")
      .map(parseCashTransaction),
  ].filter((row): row is BrokerageActivity => row !== null);

  return {
    accountId,
    fromDate,
    toDate,
    entity: optionalText(account?.ibEntity),
    snapshot,
    activity,
  };
}

export function parseFlexStatements(xml: string): ParsedFlexStatement[] {
  const statements: ParsedFlexStatement[] = [];
  for (const match of xml.matchAll(
    /<FlexStatement\s([^<>]*)>([\s\S]*?)<\/FlexStatement>/g,
  )) {
    const parsed = parseStatement(attributes(match[1] ?? ""), match[2] ?? "");
    if (parsed) statements.push(parsed);
  }
  return statements;
}
