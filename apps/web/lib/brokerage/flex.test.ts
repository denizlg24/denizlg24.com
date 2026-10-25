import { describe, expect, test } from "bun:test";
import { FlexError, parseFlexStatements, pullFlexStatement } from "./flex";

function statement(day: string, body: string) {
  return `<FlexStatement accountId="U1" fromDate="${day}" toDate="${day}" period="LastBusinessDay" whenGenerated="${day};050000">
<AccountInformation accountId="U1" currency="EUR" ibEntity="IB-IE" />
${body}
</FlexStatement>`;
}

const FUNDED = statement(
  "20261023",
  `<EquitySummaryInBase>
<EquitySummaryByReportDateInBase accountId="U1" currency="EUR" reportDate="20261022" cash="300" total="1000" />
<EquitySummaryByReportDateInBase accountId="U1" currency="EUR" reportDate="20261023" cash="400" total="1110.5" />
</EquitySummaryInBase>
<ChangeInNAV accountId="U1" currency="EUR" startingValue="1000" endingValue="1110.5" mtm="10.5" depositsWithdrawals="100" assetTransfers="0" internalCashTransfers="0" dividends="0" withholdingTax="0" interest="0" commissions="0" brokerFees="0" otherFees="0" fxTranslation="0" twr="1.05" />
<OpenPositions>
<OpenPosition accountId="U1" currency="EUR" fxRateToBase="1" assetCategory="STK" subCategory="ETF" symbol="SPYL" description="SS SPDR S&amp;P 500 UCIT ETF ACC" conid="42" isin="IE00BFY0GT14" listingExchange="IBIS2" position="10.5" markPrice="67.67" positionValue="710.5" costBasisPrice="66" costBasisMoney="693" fifoPnlUnrealized="17.5" percentOfNAV="63.98" levelOfDetail="SUMMARY" />
<OpenPosition accountId="U1" currency="EUR" fxRateToBase="1" symbol="SPYL" conid="42" position="10.5" levelOfDetail="LOT" />
</OpenPositions>
<CashReport>
<CashReportCurrency accountId="U1" currency="BASE_SUMMARY" levelOfDetail="BaseCurrency" endingCash="400" endingSettledCash="400" />
<CashReportCurrency accountId="U1" currency="EUR" levelOfDetail="Currency" endingCash="400" endingSettledCash="400" />
<CashReportCurrency accountId="U1" currency="USD" levelOfDetail="Currency" endingCash="0.000000001" endingSettledCash="0.000000001" />
</CashReport>
<Trades>
<Trade accountId="U1" currency="EUR" fxRateToBase="1" symbol="SPYL" description="SS SPDR S&amp;P 500" tradeDate="20261023" dateTime="20261023;101601" transactionType="ExchTrade" quantity="0.5" tradePrice="67" netCash="-34.75" ibCommission="-1.25" buySell="BUY" transactionID="900" levelOfDetail="EXECUTION" />
</Trades>
<CashTransactions>
<CashTransaction accountId="U1" currency="USD" fxRateToBase="0.92" symbol="" description="DIVIDEND" dateTime="20261023" amount="10" type="Dividends" transactionID="901" levelOfDetail="DETAIL" />
</CashTransactions>`,
);

const BEFORE_FUNDING = statement(
  "20260731",
  `<EquitySummaryByReportDateInBase accountId="U1" currency="EUR" reportDate="20260730" cash="0" total="0" />
<EquitySummaryByReportDateInBase accountId="U1" currency="EUR" reportDate="20260731" cash="0" total="0" />
<ChangeInNAV accountId="U1" startingValue="0" endingValue="0" depositsWithdrawals="0" twr="0" />`,
);

const xml = `<FlexQueryResponse queryName="q" type="AF"><FlexStatements count="2">${BEFORE_FUNDING}${FUNDED}</FlexStatements></FlexQueryResponse>`;

describe("parseFlexStatements", () => {
  const statements = parseFlexStatements(xml);
  const funded = statements[1];

  test("reads one statement per day and skips the snapshot of an unfunded day", () => {
    expect(statements).toHaveLength(2);
    expect(statements[0]?.snapshot).toBeNull();
    expect(funded?.toDate).toBe("2026-10-23");
    expect(funded?.entity).toBe("IB-IE");
  });

  test("takes the equity row of the statement's own day", () => {
    expect(funded?.snapshot?.nav).toBe(1110.5);
    expect(funded?.snapshot?.cashBase).toBe(400);
    expect(funded?.snapshot?.baseCurrency).toBe("EUR");
  });

  test("keeps summary positions only and decodes entities", () => {
    const positions = funded?.snapshot?.positions ?? [];
    expect(positions).toHaveLength(1);
    expect(positions[0]?.description).toBe("SS SPDR S&P 500 UCIT ETF ACC");
    expect(positions[0]?.quantity).toBe(10.5);
    expect(positions[0]?.valueBase).toBe(710.5);
  });

  test("drops conversion dust from cash", () => {
    expect(funded?.snapshot?.cash).toEqual([
      { currency: "EUR", amount: 400, settled: 400 },
    ]);
  });

  test("counts deposits as flows, not return", () => {
    expect(funded?.snapshot?.change?.flows).toBe(100);
    expect(funded?.snapshot?.change?.twr).toBe(1.05);
  });

  test("converts activity to base at IBKR's rate", () => {
    const [trade, dividend] = funded?.activity ?? [];
    expect(trade).toMatchObject({
      id: "trade:900",
      side: "BUY",
      amount: -34.75,
      commission: -1.25,
    });
    expect(dividend).toMatchObject({ id: "cash:901", type: "Dividends" });
    expect(dividend?.amountBase).toBeCloseTo(9.2);
    expect(dividend?.symbol).toBeUndefined();
  });
});

describe("pullFlexStatement", () => {
  function scripted(responses: string[]) {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return new Response(responses.shift() ?? "");
    };
    return { urls, fetchImpl };
  }

  test("polls past a statement still generating", async () => {
    const { urls, fetchImpl } = scripted([
      "<FlexStatementResponse><Status>Success</Status><ReferenceCode>77</ReferenceCode><Url>https://gdcdyn.example/GetStatement</Url></FlexStatementResponse>",
      "<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode></FlexStatementResponse>",
      xml,
    ]);
    const body = await pullFlexStatement({
      token: "t",
      queryId: "1",
      fetchImpl,
      pollIntervalMs: 0,
    });
    expect(body).toBe(xml);
    expect(urls.every((url) => url.includes("ndcdyn"))).toBe(true);
    expect(urls[2]).toContain("q=77");
  });

  test("surfaces a refused request with its code", async () => {
    const { fetchImpl } = scripted([
      "<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode><ErrorMessage>Token has expired.</ErrorMessage></FlexStatementResponse>",
    ]);
    const pull = pullFlexStatement({
      token: "t",
      queryId: "1",
      fetchImpl,
      pollIntervalMs: 0,
    });
    await expect(pull).rejects.toBeInstanceOf(FlexError);
    await expect(pull).rejects.toThrow("Token has expired.");
  });
});
