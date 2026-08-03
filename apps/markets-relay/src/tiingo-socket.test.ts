import { describe, expect, test } from "bun:test";
import { parseIexMessage } from "./tiingo-socket";

/**
 * Field positions taken from Tiingo's IEX websocket docs. If Tiingo ever
 * reorders these, these tests are what catches it instead of the chart.
 */
function tradeFrame(ticker: string, last: number, ts: string) {
  const row: unknown[] = new Array(10).fill(null);
  row[0] = "T";
  row[1] = ts;
  row[3] = ticker;
  row[9] = last;
  return JSON.stringify({ messageType: "A", data: row });
}

function quoteFrame(ticker: string, bid: number, ask: number, ts: string) {
  const row: unknown[] = new Array(10).fill(null);
  row[0] = "Q";
  row[1] = ts;
  row[3] = ticker;
  row[5] = bid;
  row[7] = ask;
  return JSON.stringify({ messageType: "A", data: row });
}

describe("parseIexMessage", () => {
  test("reads a trade into a last price", () => {
    const quote = parseIexMessage(
      tradeFrame("aapl", 231.45, "2026-07-31T15:30:00.123456789Z"),
    );
    expect(quote?.ticker).toBe("AAPL");
    expect(quote?.last).toBe(231.45);
    expect(quote?.bid).toBeNull();
    expect(quote?.source).toBe("ws");
  });

  test("reads a quote into bid and ask without inventing a last", () => {
    const quote = parseIexMessage(
      quoteFrame("msft", 511.2, 511.4, "2026-07-31T15:30:00.000Z"),
    );
    expect(quote?.ticker).toBe("MSFT");
    expect(quote?.bid).toBe(511.2);
    expect(quote?.ask).toBe(511.4);
    expect(quote?.last).toBeNull();
  });

  test("ignores non-data message types", () => {
    expect(
      parseIexMessage(JSON.stringify({ messageType: "I", data: {} })),
    ).toBeNull();
    expect(parseIexMessage(JSON.stringify({ messageType: "H" }))).toBeNull();
  });

  test("ignores malformed frames rather than throwing", () => {
    expect(parseIexMessage("not json")).toBeNull();
    expect(parseIexMessage("null")).toBeNull();
    expect(parseIexMessage(JSON.stringify({ messageType: "A" }))).toBeNull();
  });

  test("a row with neither a price nor a bid is dropped", () => {
    const row: unknown[] = new Array(10).fill(null);
    row[0] = "Q";
    row[3] = "AAPL";
    expect(
      parseIexMessage(JSON.stringify({ messageType: "A", data: row })),
    ).toBeNull();
  });

  test("falls back to now when the timestamp is unusable", () => {
    const row: unknown[] = new Array(10).fill(null);
    row[0] = "T";
    row[1] = "not-a-date";
    row[3] = "AAPL";
    row[9] = 100;
    const quote = parseIexMessage(
      JSON.stringify({ messageType: "A", data: row }),
    );
    expect(Number.isNaN(Date.parse(quote?.ts ?? ""))).toBe(false);
  });
});
