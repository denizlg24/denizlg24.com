import { createServer } from "node:http";

const valid = "1111111111111111111111";
const expired = "9999999999999999999999";
const pending = new Map();

const statement = `<FlexQueryResponse queryName="Stockwatcher" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="U7654321" fromDate="20261119" toDate="20261119" period="LastBusinessDay" whenGenerated="20261120;083000">
<OpenPositions>
<OpenPosition accountId="U7654321" currency="USD" assetCategory="STK" symbol="AAPL" description="APPLE INC" conid="265598" listingExchange="NASDAQ" position="10" markPrice="230" costBasisPrice="150.5" costBasisMoney="1505" levelOfDetail="SUMMARY" reportDate="20261119" />
<OpenPosition accountId="U7654321" currency="GBP" assetCategory="STK" symbol="VOD" description="VODAFONE GROUP PLC" conid="11111" listingExchange="LSE" position="1000" costBasisPrice="0.7" costBasisMoney="700" levelOfDetail="SUMMARY" reportDate="20261119" />
<OpenPosition accountId="U7654321" currency="GBP" assetCategory="STK" symbol="VOD" description="VODAFONE GROUP PLC" conid="11111" listingExchange="LSE" position="600" costBasisPrice="0.6" costBasisMoney="360" levelOfDetail="LOT" openDateTime="20240301;101500" reportDate="20261119" />
<OpenPosition accountId="U7654321" currency="GBP" assetCategory="STK" symbol="VOD" description="VODAFONE GROUP PLC" conid="11111" listingExchange="LSE" position="400" costBasisPrice="0.85" costBasisMoney="340" levelOfDetail="LOT" openDateTime="20250610;141000" reportDate="20261119" />
<OpenPosition accountId="U7654321" currency="USD" assetCategory="STK" symbol="BRK B" description="BERKSHIRE HATHAWAY INC-CL B" conid="72063691" listingExchange="NYSE" position="3" costBasisPrice="400" costBasisMoney="1200" levelOfDetail="SUMMARY" reportDate="20261119" />
<OpenPosition accountId="U7654321" currency="USD" assetCategory="OPT" symbol="AAPL  261218C00250000" conid="99999" listingExchange="CBOE" position="1" costBasisPrice="5" costBasisMoney="500" levelOfDetail="SUMMARY" />
<OpenPosition accountId="U7654321" currency="USD" assetCategory="STK" symbol="TSLA" conid="76792991" listingExchange="NASDAQ" position="-5" costBasisPrice="300" costBasisMoney="-1500" levelOfDetail="SUMMARY" />
</OpenPositions>
<CashReport>
<CashReportCurrency accountId="U7654321" currency="BASE_SUMMARY" endingCash="5000" />
<CashReportCurrency accountId="U7654321" currency="USD" endingCash="4200.5" />
<CashReportCurrency accountId="U7654321" currency="GBP" endingCash="610" />
</CashReport>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

const fail = (code, message) =>
  `<FlexStatementResponse timestamp="20 November, 2026 08:30 AM EST"><Status>Fail</Status><ErrorCode>${code}</ErrorCode><ErrorMessage>${message}</ErrorMessage></FlexStatementResponse>`;

createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:3292");
  const xml = (body) => {
    response.writeHead(200, { "Content-Type": "text/xml" });
    response.end(body);
  };
  const token = url.searchParams.get("t");
  const q = url.searchParams.get("q");
  if (url.pathname === "/flex/SendRequest") {
    if (token === expired) return xml(fail(1012, "Token has expired."));
    if (token !== valid) return xml(fail(1015, "Token is invalid."));
    if (q !== "424242") return xml(fail(1014, "Query is invalid."));
    const reference = String(Date.now());
    pending.set(reference, 0);
    return xml(
      `<FlexStatementResponse timestamp="20 November, 2026 08:30 AM EST"><Status>Success</Status><ReferenceCode>${reference}</ReferenceCode><Url>http://127.0.0.1:3292/flex/GetStatement</Url></FlexStatementResponse>`,
    );
  }
  if (url.pathname === "/flex/GetStatement") {
    if (token !== valid || !pending.has(q))
      return xml(fail(1020, "Invalid request or unable to validate request."));
    const polls = pending.get(q);
    pending.set(q, polls + 1);
    if (polls === 0)
      return xml(
        `<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage></FlexStatementResponse>`,
      );
    pending.delete(q);
    return xml(statement);
  }
  if (url.pathname === "/health") return xml("<ok/>");
  response.writeHead(404);
  response.end();
}).listen(3292, "127.0.0.1");
