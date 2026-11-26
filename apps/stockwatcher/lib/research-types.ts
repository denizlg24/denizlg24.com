export const managers = {
  "Berkshire Hathaway": "1067983",
  "ARK Investment Management": "1697748",
  "Bridgewater Associates": "1350694",
  "Pershing Square": "1336528",
  "Scion Asset Management": "1649339",
  Appaloosa: "1656456",
} as const;

export type Mention = {
  symbol: string;
  name: string;
  count: number;
  prior: number;
  rank: number;
  upvotes: number;
};
export type Filing = {
  form: string;
  filed: string;
  report: string;
  url: string;
};
export type Fact = {
  label: string;
  unit: string;
  value: number;
  period: string;
  filed: string;
  form: string;
};
export type CompanyResearch = {
  company: string;
  cik: string;
  filings: Filing[];
  facts: Fact[];
  url: string;
} | null;
export type HoldingsReport = {
  manager: string;
  period: string;
  filed: string;
  url: string;
  amended: boolean;
  holdings: Array<{
    name: string;
    cusip: string;
    shares: number;
    value: number;
    type: string;
    putCall: string;
  }>;
};
