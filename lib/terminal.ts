import { symbolPattern } from "./universes";

export const securityFunctions = [
  { code: "GP", label: "Price graph", detail: "Chart with studies" },
  { code: "DES", label: "Description", detail: "Profile and key statistics" },
  { code: "FA", label: "Financials", detail: "Income, balance sheet, cash flow" },
  { code: "ANR", label: "Analysts", detail: "Ratings, targets and changes" },
  { code: "ERN", label: "Earnings", detail: "Next report and EPS surprises" },
  { code: "HDS", label: "Holders", detail: "Institutions, funds and insiders" },
  { code: "MGMT", label: "Management", detail: "Officers, pay and governance" },
  { code: "DVD", label: "Dividends", detail: "Dividend and split history" },
  { code: "RELS", label: "Relationships", detail: "Peers, holders, indices, board" },
  { code: "SPLC", label: "Supply chain", detail: "Customers and suppliers from SEC filings" },
  { code: "CN", label: "Company news", detail: "Latest headlines" },
  { code: "HVT", label: "Volatility", detail: "Realised volatility, 10–90 day, with percentile" },
  { code: "BETA", label: "Beta", detail: "Regression vs any benchmark, rolling beta" },
  { code: "SEAS", label: "Seasonality", detail: "Monthly returns by year, averages and hit rate" },
  { code: "BTST", label: "Backtest", detail: "Test crossover, RSI, breakout and momentum rules" },
] as const;
export type SecurityFunction = (typeof securityFunctions)[number]["code"];

export const monitorFunctions = [
  { code: "MOST", label: "Most active", detail: "Top gainers, losers and volume" },
  { code: "WEI", label: "World indices", detail: "Global equity benchmarks" },
  { code: "ECO", label: "Economics", detail: "Rates, inflation, jobs (FRED)" },
  { code: "GC", label: "Yield curve", detail: "US Treasury curve, 2s10s and 3m10y" },
  { code: "FXC", label: "FX crosses", detail: "Currency cross-rate matrix" },
  { code: "CMDTY", label: "Commodities", detail: "Energy, metals and agriculture futures" },
  { code: "CRYP", label: "Crypto", detail: "Digital assets and listed proxies" },
  { code: "CORR", label: "Correlation", detail: "Correlation matrix of any tickers" },
] as const;
export type MonitorFunction = (typeof monitorFunctions)[number]["code"];

export const overlayFunction = {
  code: "G",
  label: "Overlay chart",
  detail: "Overlay any tickers, FRED series and ratios, e.g. G ^GSPC ^VIX",
} as const;

export const workspaceFunctions = [
  { code: "DESK", label: "Desk", detail: "Your launchpad", view: "desk" },
  { code: "MKT", label: "Markets", detail: "Heat map and compare", view: "markets" },
  { code: "PORT", label: "Portfolio", detail: "Positions and P&L", view: "portfolio" },
  { code: "W", label: "Watchlists", detail: "Quote monitors", view: "watchlists" },
  { code: "ALRT", label: "Alerts", detail: "Price alerts", view: "alerts" },
  { code: "RES", label: "Research", detail: "Filings and journal", view: "research" },
  { code: "RPT", label: "Reports", detail: "Saved reports and decks", view: "reports" },
  { code: "PREF", label: "Settings", detail: "Preferences", view: "settings" },
] as const;
type WorkspaceCode = (typeof workspaceFunctions)[number]["code"];
export type WorkspaceView = (typeof workspaceFunctions)[number]["view"];

export type Command =
  | { kind: "security"; ticker: string; fn: SecurityFunction }
  | { kind: "monitor"; fn: MonitorFunction }
  | { kind: "overlay"; series: string[] }
  | { kind: "view"; view: WorkspaceView }
  | { kind: "help" }
  | { kind: "search"; query: string };

const securityCodes = new Map<string, SecurityFunction>(
  securityFunctions.map((item) => [item.code, item.code]),
);
const aliases: Record<string, SecurityFunction> = {
  CHART: "GP",
  GIP: "GP",
  INFO: "DES",
  BIO: "DES",
  FIN: "FA",
  ANALYST: "ANR",
  EE: "ERN",
  EVTS: "ERN",
  OWN: "HDS",
  HOLD: "HDS",
  PEOPLE: "MGMT",
  BOARD: "MGMT",
  DVDS: "DVD",
  RV: "RELS",
  PEERS: "RELS",
  N: "CN",
  NEWS: "CN",
  HVG: "HVT",
  VOL: "HVT",
  HV: "HVT",
  REG: "BETA",
  SEASON: "SEAS",
  BT: "BTST",
  BACKTEST: "BTST",
  SPLY: "SPLC",
  SUPPLY: "SPLC",
};
const monitorCodes = new Map<string, MonitorFunction>([
  ["MOST", "MOST"],
  ["TOP", "MOST"],
  ["MOV", "MOST"],
  ["WEI", "WEI"],
  ["WI", "WEI"],
  ["ECO", "ECO"],
  ["ECST", "ECO"],
  ["MACRO", "ECO"],
  ["GC", "GC"],
  ["YC", "GC"],
  ["CURVE", "GC"],
  ["FXC", "FXC"],
  ["FX", "FXC"],
  ["WCR", "FXC"],
  ["CMDTY", "CMDTY"],
  ["GLCO", "CMDTY"],
  ["COMMODITIES", "CMDTY"],
  ["CRYP", "CRYP"],
  ["CRYPTO", "CRYP"],
  ["XBT", "CRYP"],
  ["CORR", "CORR"],
  ["CORRELATION", "CORR"],
]);
const workspaceCodes = new Map<string, WorkspaceView>([
  ...workspaceFunctions.map(
    (item): [WorkspaceCode, WorkspaceView] => [item.code, item.view],
  ),
  ["LAUNCH", "desk"],
  ["BLP", "desk"],
  ["HOME", "desk"],
  ["IMAP", "markets"],
  ["PRTU", "portfolio"],
  ["PORTFOLIO", "portfolio"],
  ["WATCH", "watchlists"],
  ["SETTINGS", "settings"],
]);
const yellowKeys = new Set([
  "EQUITY",
  "EQ",
  "INDEX",
  "CURNCY",
  "CMDTY",
  "COMDTY",
  "CORP",
  "GOVT",
  "GO",
  "<GO>",
]);
const exchangeCodes = new Set(["US", "UN", "UQ", "UW", "LN", "GY", "FP", "NA"]);

const securityFunction = (word: string) =>
  securityCodes.get(word) ?? aliases[word];

/**
 * Parses terminal-style input: `AAPL DES`, `AAPL US Equity GP <GO>`, `MOST`,
 * or a bare function such as `ANR`, which applies to the current security.
 */
export function parseCommand(input: string, current?: string): Command | null {
  const words = input
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter((word) => word && !yellowKeys.has(word));
  if (words.length === 0) return null;
  if (words[0] === "G" || words[0] === "OV") {
    const rest = input.trim().toUpperCase().replace(/^(G|OV)\b/, "").trim();
    const parts = /[;,]/.test(rest)
      ? rest.split(/[;,]/)
      : /[+*/()]|\s-\s/.test(rest)
        ? [rest]
        : rest.split(/\s+/);
    const series = parts
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 8);
    return { kind: "overlay", series };
  }
  if (words.length === 1) {
    const [word] = words;
    if (word === "HELP" || word === "?" || word === "HL") return { kind: "help" };
    const monitor = monitorCodes.get(word);
    if (monitor) return { kind: "monitor", fn: monitor };
    const view = workspaceCodes.get(word);
    if (view) return { kind: "view", view };
    const fn = securityFunction(word);
    if (fn && current) return { kind: "security", ticker: current, fn };
    if (symbolPattern.test(word))
      return { kind: "security", ticker: word, fn: "GP" };
    return { kind: "search", query: input.trim() };
  }
  const last = words.at(-1) ?? "";
  const fn = securityFunction(last);
  const tickerWords = (fn ? words.slice(0, -1) : words).filter(
    (word, i) => i === 0 || !exchangeCodes.has(word),
  );
  if (tickerWords.length === 1 && symbolPattern.test(tickerWords[0]))
    return { kind: "security", ticker: tickerWords[0], fn: fn ?? "GP" };
  return { kind: "search", query: input.trim() };
}

export function suggestFunctions(input: string) {
  const word = input.trim().toUpperCase().split(/\s+/).at(-1) ?? "";
  if (!word) return [];
  const all = [
    ...securityFunctions.map((item) => ({ ...item, scope: "security" as const })),
    ...monitorFunctions.map((item) => ({ ...item, scope: "monitor" as const })),
    { ...overlayFunction, scope: "monitor" as const },
    ...workspaceFunctions.map((item) => ({
      code: item.code,
      label: item.label,
      detail: item.detail,
      scope: "workspace" as const,
    })),
  ];
  return all.filter((item) => item.code.startsWith(word)).slice(0, 6);
}
