/** Canned terminal outputs. Every figure is a real print from the dated source. */

export const des = {
  name: "Apple Inc.",
  exchange: "NasdaqGS",
  last: 355.58,
  previous: 354.07,
  dayLow: 345.13,
  dayHigh: 356.75,
  yearLow: 243.42,
  yearHigh: 360.83,
  volume: 53_060_252,
  asOf: "25 Nov 2026 · 16:00 ET",
};

export const ern = {
  report: "28 Jan 2027",
  impliedMove: 7.64,
  atmIv: 26.4,
  expiries: 23,
  reference: 355.58,
  asOf: "26 Nov 2026",
};

/** U.S. Treasury daily par yield curve, 25 Nov 2026 against 25 Nov 2025. */
export const curve = [
  { tenor: "1M", today: 4.27, yearAgo: 4.04 },
  { tenor: "3M", today: 4.34, yearAgo: 3.9 },
  { tenor: "6M", today: 4.44, yearAgo: 3.75 },
  { tenor: "1Y", today: 4.56, yearAgo: 3.6 },
  { tenor: "2Y", today: 4.61, yearAgo: 3.43 },
  { tenor: "3Y", today: 4.64, yearAgo: 3.46 },
  { tenor: "5Y", today: 4.65, yearAgo: 3.55 },
  { tenor: "7Y", today: 4.74, yearAgo: 3.77 },
  { tenor: "10Y", today: 4.85, yearAgo: 4.01 },
  { tenor: "20Y", today: 5.28, yearAgo: 4.62 },
  { tenor: "30Y", today: 5.24, yearAgo: 4.67 },
] as const;

export const prsk = {
  scenario: "2020 Covid crash",
  window: "19 Feb – 23 Mar 2020",
  portfolio: -34.46,
  benchmark: -33.92,
};

export const most = [
  {
    symbol: "NVDA",
    name: "NVIDIA",
    last: 149.3,
    change: -3.91,
    volume: 359.53,
  },
  {
    symbol: "ANT",
    name: "Anthropic",
    last: 82.79,
    change: 1.08,
    volume: 292.33,
  },
  { symbol: "SPCX", name: "SpaceX", last: 127.44, change: 1.3, volume: 146.93 },
  { symbol: "INTC", name: "Intel", last: 54.47, change: -0.6, volume: 128.25 },
  {
    symbol: "SNDK",
    name: "Sandisk",
    last: 73.61,
    change: -5.57,
    volume: 121.83,
  },
  { symbol: "GRAB", name: "Grab", last: 2.84, change: 2.53, volume: 110.12 },
  {
    symbol: "RIG",
    name: "Transocean",
    last: 5.03,
    change: 4.14,
    volume: 89.37,
  },
  { symbol: "IREN", name: "IREN", last: 12.85, change: -0.77, volume: 81.91 },
] as const;

export const wire = [
  {
    time: "27 Nov 08:37",
    publisher: "Investing.com",
    title:
      "European shares extend rally, but bruising November leaves AI scars",
    symbols: "NVDA",
  },
  {
    time: "27 Nov 07:34",
    publisher: "Reuters",
    title: "Wall St futures surge as investors return from holiday",
    symbols: "SPY",
  },
  {
    time: "27 Nov 06:31",
    publisher: "Benzinga",
    title:
      "Michael Burry shares stark warning about AI boom, as Nvidia, Oracle and Meta face surging debt insurance costs",
    symbols: "NVDA",
  },
  {
    time: "26 Nov 19:30",
    publisher: "Barchart",
    title:
      "Apple enters the AI agent race as it takes on OpenAI, Anthropic and Meta",
    symbols: "AAPL",
  },
  {
    time: "26 Nov 19:00",
    publisher: "GuruFocus",
    title: "Apple stock rises as AI selloff spares the iPhone maker",
    symbols: "AAPL",
  },
  {
    time: "26 Nov 17:00",
    publisher: "24/7 Wall St.",
    title:
      "Was CrowdStrike’s $43.9 billion bid for Zscaler the right move at the wrong time?",
    symbols: "CRWD ZS",
  },
  {
    time: "26 Nov 15:28",
    publisher: "24/7 Wall St.",
    title:
      "The economy grew way faster than first reported: Q3 GDP revised up to 4.3%",
    symbols: "SPY",
  },
  {
    time: "26 Nov 15:26",
    publisher: "Zacks",
    title:
      "Can Verizon’s new Apple deals and loyalty benefits drive subscriber growth?",
    symbols: "VZ AAPL",
  },
] as const;

export const signed = (value: number, digits = 2) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;
