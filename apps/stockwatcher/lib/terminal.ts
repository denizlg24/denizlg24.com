import { symbolPattern } from "./universes";

export const securityFunctions = [
  { code: "GP", label: "Price graph", detail: "Chart with studies" },
  { code: "DES", label: "Description", detail: "Profile and key statistics" },
  {
    code: "FA",
    label: "Financials",
    detail: "Income, balance sheet, cash flow",
  },
  { code: "ANR", label: "Analysts", detail: "Ratings, targets and changes" },
  { code: "ERN", label: "Earnings", detail: "Next report and EPS surprises" },
  { code: "HDS", label: "Holders", detail: "Institutions, funds and insiders" },
  { code: "MGMT", label: "Management", detail: "Officers, pay and governance" },
  { code: "DVD", label: "Dividends", detail: "Dividend and split history" },
  {
    code: "RELS",
    label: "Relationships",
    detail: "Peers, holders, indices, board",
  },
  {
    code: "SPLC",
    label: "Supply chain",
    detail: "Customers and suppliers from SEC filings",
  },
  { code: "CN", label: "Company news", detail: "Latest headlines" },
  {
    code: "HVT",
    label: "Volatility",
    detail: "Realised volatility, 10–90 day, with percentile",
  },
  {
    code: "BETA",
    label: "Beta",
    detail: "Regression vs any benchmark, rolling beta",
  },
  {
    code: "SEAS",
    label: "Seasonality",
    detail: "Monthly returns by year, averages and hit rate",
  },
  {
    code: "BTST",
    label: "Backtest",
    detail: "Test crossover, RSI, breakout and momentum rules",
  },
  {
    code: "CONG",
    label: "Congress",
    detail: "Trades and holdings disclosed by members of Congress",
  },
  {
    code: "INST",
    label: "13F holders",
    detail: "Institutional holders and quarterly changes from 13F filings",
  },
  {
    code: "EXEC",
    label: "Executive pay",
    detail: "Summary compensation table and pay versus performance",
  },
  {
    code: "ETF",
    label: "ETF holdings",
    detail: "Fund holdings from SEC N-PORT filings",
  },
  {
    code: "CONT",
    label: "Contracts",
    detail: "Federal contract awards from USAspending",
  },
  {
    code: "PACS",
    label: "PAC giving",
    detail: "Corporate PAC money and recipients from the FEC",
  },
  {
    code: "DARK",
    label: "Off-exchange",
    detail: "FINRA off-exchange and short volume (DPI)",
  },
  {
    code: "APPR",
    label: "App ratings",
    detail: "App Store ratings and their history",
  },
  {
    code: "WIKI",
    label: "Attention",
    detail: "Wikipedia page views and spikes",
  },
  {
    code: "WARN",
    label: "Layoffs",
    detail: "WARN layoff notices filed with states",
  },
  {
    code: "WSB",
    label: "Reddit mentions",
    detail: "WallStreetBets mention and rank history",
  },
  {
    code: "ACFT",
    label: "Corporate jets",
    detail: "Registered aircraft and their flights",
  },
] as const;
export type SecurityFunction = (typeof securityFunctions)[number]["code"];

export const altSecurityFunctions = [
  "CONG",
  "INST",
  "EXEC",
  "ETF",
  "CONT",
  "PACS",
  "DARK",
  "APPR",
  "WIKI",
  "WARN",
  "WSB",
  "ACFT",
] as const satisfies readonly SecurityFunction[];
export type AltSecurityFunction = (typeof altSecurityFunctions)[number];
export const isAltSecurityFunction = (
  fn: SecurityFunction,
): fn is AltSecurityFunction =>
  (altSecurityFunctions as readonly string[]).includes(fn);

export const monitorFunctions = [
  {
    code: "MOST",
    label: "Most active",
    detail: "Top gainers, losers and volume",
  },
  { code: "WEI", label: "World indices", detail: "Global equity benchmarks" },
  { code: "ECO", label: "Economics", detail: "Rates, inflation, jobs (FRED)" },
  {
    code: "GC",
    label: "Yield curve",
    detail: "US Treasury curve, 2s10s and 3m10y",
  },
  { code: "FXC", label: "FX crosses", detail: "Currency cross-rate matrix" },
  {
    code: "CMDTY",
    label: "Commodities",
    detail: "Energy, metals and agriculture futures",
  },
  {
    code: "CRYP",
    label: "Crypto",
    detail: "Digital assets and listed proxies",
  },
  {
    code: "CORR",
    label: "Correlation",
    detail: "Correlation matrix, e.g. CORR AAPL MSFT NVDA",
  },
  {
    code: "EQS",
    label: "Screener",
    detail: "Screen the S&P 500 by sector, moves and range",
  },
  {
    code: "RRG",
    label: "Rotation",
    detail: "Relative rotation of sectors, regions and factors",
  },
  {
    code: "GRID",
    label: "Chart grid",
    detail: "Up to nine linked charts, e.g. GRID AAPL MSFT NVDA SPY",
  },
  {
    code: "PRSK",
    label: "Portfolio risk",
    detail: "VaR, beta, risk contribution and stress of your book",
  },
  {
    code: "TOP",
    label: "News wire",
    detail: "Headlines across watchlists, positions or trending",
  },
  {
    code: "EVTS",
    label: "Calendar",
    detail: "Earnings calendar by week, with FOMC decisions",
  },
  {
    code: "FEAR",
    label: "Fear & Greed",
    detail: "CNN sentiment index, history, drivers and alerts",
  },
  {
    code: "CONG",
    label: "Congress trades",
    detail: "Latest House and Senate stock trade disclosures",
  },
  {
    code: "TRMP",
    label: "Presidential trades",
    detail: "Transactions in the President's OGE 278-T reports",
  },
  {
    code: "FUND",
    label: "13F managers",
    detail: "Any fund manager's holdings and quarterly changes",
  },
  {
    code: "CONT",
    label: "Contracts",
    detail: "Largest recent federal contract awards",
  },
  {
    code: "PACS",
    label: "Corporate PACs",
    detail: "Top corporate PACs by giving this cycle",
  },
  {
    code: "DARK",
    label: "Off-exchange",
    detail: "Highest off-exchange and short volume today",
  },
  {
    code: "PMKT",
    label: "Polymarket",
    detail: "Prediction-market odds and the largest trades",
  },
  {
    code: "WARN",
    label: "Layoffs",
    detail: "Latest WARN layoff notices by state",
  },
  {
    code: "WSB",
    label: "Retail attention",
    detail: "Most-mentioned tickers on WallStreetBets, latest snapshot",
  },
  {
    code: "ACFT",
    label: "Corporate jets",
    detail: "Latest corporate jet flights across companies",
  },
] as const;
export type MonitorFunction = (typeof monitorFunctions)[number]["code"];

export const altMonitorFunctions = [
  "CONG",
  "TRMP",
  "FUND",
  "CONT",
  "PACS",
  "DARK",
  "PMKT",
  "WARN",
  "WSB",
  "ACFT",
] as const satisfies readonly MonitorFunction[];
export type AltMonitorFunction = (typeof altMonitorFunctions)[number];
export const isAltMonitorFunction = (
  fn: MonitorFunction,
): fn is AltMonitorFunction =>
  (altMonitorFunctions as readonly string[]).includes(fn);

export const overlayFunction = {
  code: "G",
  label: "Overlay chart",
  detail: "Overlay any tickers, FRED series and ratios, e.g. G ^GSPC ^VIX",
} as const;

export const workspaceFunctions = [
  { code: "DESK", label: "Desk", detail: "Your launchpad", view: "desk" },
  {
    code: "MKT",
    label: "Markets",
    detail: "Heat map and compare",
    view: "markets",
  },
  {
    code: "PORT",
    label: "Portfolio",
    detail: "Positions and P&L",
    view: "portfolio",
  },
  {
    code: "W",
    label: "Watchlists",
    detail: "Quote monitors",
    view: "watchlists",
  },
  { code: "ALRT", label: "Alerts", detail: "Price alerts", view: "alerts" },
  {
    code: "RES",
    label: "Research",
    detail: "Filings and journal",
    view: "research",
  },
  {
    code: "RPT",
    label: "Reports",
    detail: "Saved reports and decks",
    view: "reports",
  },
  { code: "PREF", label: "Settings", detail: "Preferences", view: "settings" },
] as const;
type WorkspaceCode = (typeof workspaceFunctions)[number]["code"];
export type WorkspaceView = (typeof workspaceFunctions)[number]["view"];

export type Command =
  | { kind: "security"; ticker: string; fn: SecurityFunction }
  | { kind: "monitor"; fn: MonitorFunction; symbols?: string[] }
  | { kind: "overlay"; series: string[] }
  | { kind: "view"; view: WorkspaceView }
  | { kind: "help" }
  | { kind: "tour" }
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
  CONGRESS: "CONG",
  "13F": "INST",
  INSTITUTIONS: "INST",
  PAY: "EXEC",
  COMPENSATION: "EXEC",
  ETFH: "ETF",
  CONTRACTS: "CONT",
  PAC: "PACS",
  DPI: "DARK",
  OTC: "DARK",
  RATINGS: "APPR",
  PAGEVIEWS: "WIKI",
  LAYOFFS: "WARN",
  REDDIT: "WSB",
  WALLSTREETBETS: "WSB",
  FLIGHTS: "ACFT",
  JET: "ACFT",
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
  ["EQS", "EQS"],
  ["SCRN", "EQS"],
  ["SCREEN", "EQS"],
  ["RRG", "RRG"],
  ["ROT", "RRG"],
  ["ROTATION", "RRG"],
  ["GRID", "GRID"],
  ["MULTI", "GRID"],
  ["GRAPHS", "GRID"],
  ["PRSK", "PRSK"],
  ["RISK", "PRSK"],
  ["VAR", "PRSK"],
  ["MARS", "PRSK"],
  ["TOP", "TOP"],
  ["NI", "TOP"],
  ["WIRE", "TOP"],
  ["EVTS", "EVTS"],
  ["ACDR", "EVTS"],
  ["CAL", "EVTS"],
  ["CALENDAR", "EVTS"],
  ["FEAR", "FEAR"],
  ["SENT", "FEAR"],
  ["CONG", "CONG"],
  ["CONGRESS", "CONG"],
  ["TRMP", "TRMP"],
  ["POTUS", "TRMP"],
  ["FUND", "FUND"],
  ["13F", "FUND"],
  ["MANAGERS", "FUND"],
  ["CONT", "CONT"],
  ["CONTRACTS", "CONT"],
  ["PACS", "PACS"],
  ["DARK", "DARK"],
  ["DPI", "DARK"],
  ["PMKT", "PMKT"],
  ["POLYMARKET", "PMKT"],
  ["WARN", "WARN"],
  ["LAYOFFS", "WARN"],
  ["WSB", "WSB"],
  ["REDDIT", "WSB"],
  ["ACFT", "ACFT"],
  ["FLIGHTS", "ACFT"],
]);
const workspaceCodes = new Map<string, WorkspaceView>([
  ...workspaceFunctions.map((item): [WorkspaceCode, WorkspaceView] => [
    item.code,
    item.view,
  ]),
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
    const rest = input
      .trim()
      .toUpperCase()
      .replace(/^(G|OV)\b/, "")
      .trim();
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
  const leading = monitorCodes.get(words[0]);
  if (
    leading &&
    words.length > 1 &&
    words.slice(1).every((word) => symbolPattern.test(word))
  )
    return { kind: "monitor", fn: leading, symbols: words.slice(1, 31) };
  if (words.length === 1) {
    const [word] = words;
    if (word === "HELP" || word === "?" || word === "HL")
      return { kind: "help" };
    if (word === "TOUR" || word === "GUIDE") return { kind: "tour" };
    const numbered = /^\d{1,2}$/.test(word)
      ? securityFunctions[Number(word) - 1]?.code
      : undefined;
    if (numbered && current)
      return { kind: "security", ticker: current, fn: numbered };
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

/** Bloomberg-style market keys: F-key → command. */
export const functionKeys: { key: string; command: string; label: string }[] = [
  { key: "F1", command: "HELP", label: "Help and function directory" },
  { key: "F2", command: "GC", label: "Govt · Treasury curve" },
  { key: "F3", command: "TOP", label: "News wire" },
  { key: "F4", command: "EVTS", label: "Earnings calendar" },
  { key: "F6", command: "MOST", label: "Most active" },
  { key: "F7", command: "PRSK", label: "Portfolio risk" },
  { key: "F8", command: "EQS", label: "Equity · screener" },
  { key: "F9", command: "GLCO", label: "Comdty · commodities" },
  { key: "F10", command: "WEI", label: "Index · world indices" },
  { key: "F11", command: "FXC", label: "Crncy · FX crosses" },
];

export const shortcuts: { keys: string; label: string }[] = [
  { keys: "/ or F8 in a field", label: "Focus the command line" },
  { keys: "↑ ↓ (empty command line)", label: "Recall earlier commands" },
  { keys: "Tab", label: "Complete the highlighted suggestion" },
  { keys: "12 <GO>", label: "Open the security function by number" },
  { keys: "?", label: "Keyboard map and function directory" },
  { keys: "⌘/Ctrl K", label: "Search securities" },
  { keys: "⌘/Ctrl J", label: "Toggle the assistant" },
  { keys: "Alt T / Alt W", label: "New panel tab / close tab" },
  { keys: "Alt ← → / Alt 1–9", label: "Switch panel tabs" },
  {
    keys: "⇧T ⇧R ⇧H ⇧V ⇧B ⇧F ⇧C ⇧N ⇧M ⇧A ⇧E",
    label:
      "Chart tools: trend, ray, level, vertical, box, Fibonacci, channel, note, measure, alert, erase",
  },
  { keys: "Esc", label: "Back to the chart cursor, leave full screen" },
  { keys: "Wheel / drag / double-click", label: "Zoom, pan and reset a chart" },
];

export function suggestFunctions(input: string) {
  const word = input.trim().toUpperCase().split(/\s+/).at(-1) ?? "";
  if (!word) return [];
  const all = [
    ...securityFunctions.map((item) => ({
      ...item,
      scope: "security" as const,
    })),
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
