import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

const { buildSeries, parseRegSho, weekdaysBack, foldAts } = await import(
  "./finra"
);
const { flattenEvents, mapTrades } = await import("./polymarket");
const { applicantQuery, computeMetrics, toRecords } = await import("./patents");
const {
  parseCalifornia,
  parseIllinois,
  parseNewJersey,
  parseTexas,
  parseWashington,
  toIso,
} = await import("./warn");
const { selectApps } = await import("./apps");
const { attentionStats, pickArticle } = await import("./wiki");
const { cosineDistance, distribution, zScore } = await import("./stats");
const { excelDate } = await import("./xlsx");

describe("FINRA Reg SHO", () => {
  const file = [
    "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market",
    "20261127|AAPL|600000.5|100|1000000.25|B,Q,N",
    "20261127|TINY|3|0|6495.5|Q",
    "20261127|MSFT|300000|0|900000|B,Q,N",
    "",
  ].join("\n");

  test("parses fractional volumes and drops thin symbols", () => {
    const rows = parseRegSho(file);
    expect(rows.map((r) => r[0])).toEqual(["AAPL", "MSFT"]);
    expect(rows[0][1]).toBeCloseTo(600000.5);
  });

  test("series computes DPI and a z-score against earlier days", () => {
    const days = Array.from({ length: 8 }, (_, i) => ({
      date: `2026-11-${String(10 + i).padStart(2, "0")}`,
      rows: [["AAPL", 400_000 + (i % 2) * 20_000, 0, 1_000_000]] as [
        string,
        number,
        number,
        number,
      ][],
    }));
    days[7].rows = [["AAPL", 700_000, 0, 1_000_000]];
    const series = buildSeries("AAPL", days);
    expect(series.points).toHaveLength(8);
    expect(series.latest?.dpi).toBeCloseTo(0.7);
    expect(series.dpiZScore).toBeGreaterThan(5);
  });

  test("weekdaysBack skips weekends and runs newest first", () => {
    expect(weekdaysBack(new Date("2026-11-30T12:00:00Z"), 3)).toEqual([
      "2026-11-30",
      "2026-11-27",
      "2026-11-26",
    ]);
  });

  test("folds weekly ATS and OTC rows by week", () => {
    const weeks = foldAts([
      {
        weekStartDate: "2026-10-12",
        summaryTypeCode: "ATS_W_SMBL",
        totalWeeklyShareQuantity: 10,
        totalWeeklyTradeCount: 2,
        totalNotionalSum: 100,
      },
      {
        weekStartDate: "2026-10-12",
        summaryTypeCode: "OTC_W_SMBL",
        totalWeeklyShareQuantity: 30,
        totalWeeklyTradeCount: 4,
        totalNotionalSum: 300,
      },
    ]);
    expect(weeks).toEqual([
      {
        weekStart: "2026-10-12",
        atsShares: 10,
        atsTrades: 2,
        atsNotional: 100,
        nonAtsShares: 30,
        nonAtsTrades: 4,
        nonAtsNotional: 300,
      },
    ]);
  });
});

describe("Polymarket", () => {
  test("trades are ranked by notional", () => {
    const trades = mapTrades([
      {
        proxy_wallet: "0xa",
        side: "BUY",
        size: 100,
        price: 0.5,
        timestamp: 1,
        title: "A?",
        outcome: "Yes",
      },
      {
        proxy_wallet: "0xb",
        side: "SELL",
        size: 100000,
        price: 0.9,
        timestamp: 2,
        title: "B?",
        outcome: "No",
        pseudonym: "Tiny-App",
      },
    ]);
    expect(trades[0].wallet).toBe("0xb");
    expect(trades[0].notional).toBeCloseTo(90000);
    expect(trades[0].pseudonym).toBe("Tiny-App");
  });

  test("events flatten to markets with probabilities, skipping closed ones", () => {
    const markets = flattenEvents([
      {
        title: "Fed December",
        slug: "fed-dec",
        tags: [{ slug: "fed" }],
        markets: [
          {
            id: "1",
            question: "Cut 25?",
            slug: "cut",
            outcomes: ["Yes", "No"],
            outcomePrices: ["0.2", "0.8"],
            volume24hr: 10,
          },
          {
            id: "2",
            question: "Old?",
            slug: "old",
            outcomes: [],
            outcomePrices: [],
            closed: true,
          },
        ],
      },
    ]);
    expect(markets).toHaveLength(1);
    expect(markets[0].outcomes[0]).toEqual({ label: "Yes", probability: 0.2 });
    expect(markets[0].tags).toEqual(["fed"]);
  });
});

describe("patents", () => {
  test("applicant query quotes and ORs names", () => {
    expect(applicantQuery(["Apple Inc.", 'A "B"'])).toBe(
      'applicationMetaData.firstApplicantName:("Apple Inc." OR "A B")',
    );
  });

  test("momentum is a z-score against earlier windows; drift is cosine distance", () => {
    const same = computeMetrics(
      [5, 4, 6, 5, 4, 6, 5, 5],
      [["G06F1/00"]],
      [["G06F1/00"]],
    );
    expect(same.driftCosine).toBeNull();
    const recent = Array.from({ length: 12 }, () => ["G06F1/00"]);
    const prior = Array.from({ length: 12 }, () => ["A61K1/00"]);
    const m = computeMetrics([20, 4, 6, 5, 4, 6, 5, 5], recent, prior);
    expect(m.momentumZ).toBeGreaterThan(5);
    expect(m.driftCosine).toBeCloseTo(1);
    expect(m.priorWindows).toHaveLength(7);
  });

  test("maps file wrapper rows to records", () => {
    const records = toRecords(
      {
        count: 1,
        patentFileWrapperDataBag: [
          {
            applicationNumberText: "17/1",
            applicationMetaData: {
              inventionTitle: "T",
              patentNumber: "123",
              grantDate: "2026-01-06",
              cpcClassificationBag: ["G06F3/0488"],
            },
          },
          {
            applicationNumberText: "17/2",
            applicationMetaData: { inventionTitle: "No date" },
          },
        ],
      },
      "grant",
    );
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ number: "123", date: "2026-01-06" });
  });
});

describe("WARN parsers", () => {
  test("toIso handles serials, ISO and US dates", () => {
    expect(toIso(46203)).toBe("2026-06-30");
    expect(toIso("11/18/2026")).toBe("2026-11-18");
    expect(toIso("6/2/25")).toBe("2025-06-02");
    expect(toIso("2026-01-05T00:00:00.000")).toBe("2026-01-05");
    expect(toIso("soon")).toBeNull();
  });

  test("California detailed sheet", () => {
    const [notice] = parseCalifornia([
      {
        name: "Detailed WARN Report ",
        rows: [
          ["WARN REPORT"],
          [
            "County/Parish",
            "Notice Date",
            "Processed Date",
            "Effective Date",
            "Company",
            "Layoff/Closure",
            "No. OfEmployees",
            "Address",
            "Industry",
          ],
          [
            "Los Angeles County",
            46203,
            46204,
            46266,
            "McDonald's Corporation",
            "Closure Permanent",
            2,
            "17030 Green Drive",
            "72",
          ],
        ],
      },
    ]);
    expect(notice).toEqual({
      state: "CA",
      company: "McDonald's Corporation",
      location: "Los Angeles",
      noticeDate: "2026-06-30",
      effectiveDate: "2026-09-01",
      employees: 2,
      type: "Closure Permanent",
    });
  });

  test("New Jersey takes the year from the sheet and the month from the row", () => {
    const [notice] = parseNewJersey([
      {
        name: "2026 WARN Notices",
        rows: [
          [
            "Company",
            "City",
            "Month Posted",
            "Effective Date",
            "Workforce Affected",
          ],
          ["The Fresh Market", "Montvale", "January", 46124, 55],
          [null, null, null, null, null],
        ],
      },
    ]);
    expect(notice).toMatchObject({
      state: "NJ",
      noticeDate: "2026-01-01",
      employees: 55,
    });
  });

  test("Illinois layoffs sheet", () => {
    const row: (string | number | null)[] = Array(34).fill(null);
    row[0] = "Momence Packing Co.";
    row[3] = "Momence";
    row[19] = "Plant Closure";
    row[27] = 274;
    row[28] = 45810;
    const [notice] = parseIllinois([{ name: "Layoffs", rows: [[], row] }]);
    expect(notice).toMatchObject({
      company: "Momence Packing Co.",
      employees: 274,
      type: "Plant Closure",
      noticeDate: "2025-06-02",
    });
  });

  test("Washington table rows", () => {
    const html = `<table><tr><th>Company</th></tr>
      <tr><td>Seattle Marriott Redmond</td><td>Redmond</td><td>1/5/2027</td><td>91</td><td>Closure</td><td>Permanent</td><td>11/4/2026</td><td>&nbsp;</td></tr></table>`;
    expect(parseWashington(html)).toEqual([
      {
        state: "WA",
        company: "Seattle Marriott Redmond",
        location: "Redmond",
        noticeDate: "2026-11-04",
        effectiveDate: "2027-01-05",
        employees: 91,
        type: "Closure Permanent",
      },
    ]);
  });

  test("Texas Socrata rows", () => {
    const [notice] = parseTexas([
      {
        notice_date: "2026-06-23T00:00:00.000",
        job_site_name: "JPMorgan Chase & Co.",
        city_name: "Plano",
        total_layoff_number: "244",
        layoff_date: "2026-08-21T00:00:00.000",
      },
    ]);
    expect(notice).toMatchObject({
      state: "TX",
      noticeDate: "2026-06-23",
      effectiveDate: "2026-08-21",
      employees: 244,
    });
  });
});

describe("app ratings", () => {
  test("keeps apps sold by the company, ranked by rating count", () => {
    const apps = selectApps(
      [
        {
          trackId: 1,
          trackName: "Small",
          sellerName: "Meta Platforms, Inc.",
          userRatingCount: 5,
        },
        {
          trackId: 2,
          trackName: "Big",
          sellerName: "Meta Platforms, Inc.",
          artistName: "Meta Platforms, Inc.",
          userRatingCount: 500,
          averageUserRating: 4.5,
        },
        {
          trackId: 3,
          trackName: "Other",
          sellerName: "Metal Works LLC",
          userRatingCount: 9000,
        },
      ],
      new Set(["META PLATFORMS"]),
    );
    expect(apps.map((a) => a.trackId)).toEqual([2, 1]);
  });
});

describe("Wikipedia attention", () => {
  test("z-score compares the latest day with the previous 30", () => {
    const points = Array.from({ length: 31 }, (_, i) => ({
      date: `2026-10-${String(i + 1).padStart(2, "0")}`,
      views: 1000 + (i % 3) * 10,
    }));
    points.push({ date: "2026-11-01", views: 5000 });
    const stats = attentionStats(points);
    expect(stats.latest?.views).toBe(5000);
    expect(stats.zScore30).toBeGreaterThan(50);
  });

  test("prefers the article whose label matches the company", () => {
    const article = pickArticle(
      [
        {
          article: { value: "https://en.wikipedia.org/wiki/Nvidia_(band)" },
          itemLabel: { value: "Nvidia (band)" },
        },
        {
          article: { value: "https://en.wikipedia.org/wiki/Nvidia" },
          itemLabel: { value: "Nvidia" },
        },
      ],
      "NVIDIA",
    );
    expect(article).toBe("Nvidia");
  });
});

describe("stats", () => {
  test("zScore is null for a flat baseline", () => {
    expect(zScore(5, [1, 1, 1])).toBeNull();
  });
  test("cosine distance of identical mixes is zero", () => {
    const a = distribution([["G06F1/00", "G06F2/00", "H04L1/00"]]);
    expect(cosineDistance(a, a)).toBeCloseTo(0);
  });
  test("excelDate maps serial days", () => {
    expect(excelDate(45810)).toBe("2025-06-02");
    expect(excelDate(5)).toBeNull();
  });
});
