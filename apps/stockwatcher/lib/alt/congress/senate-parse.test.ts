import { describe, expect, test } from "bun:test";
import { parseSenateListing, parseSenatePtr, senateCsrf } from "./senate-parse";

describe("Senate eFD", () => {
  test("reads the agreement token", () => {
    expect(
      senateCsrf(
        `<input type="hidden" name="csrfmiddlewaretoken" value="abc123">`,
      ),
    ).toBe("abc123");
  });

  test("reads a report-list row", () => {
    const row = [
      "Shelley M",
      "Capito",
      "Capito, Shelley Moore (Senator)",
      `<a href="/search/view/ptr/6a1c-uuid/" target="_blank">Periodic Transaction Report for 11/05/2026</a>`,
      "11/10/2026",
    ];
    expect(parseSenateListing(row)).toMatchObject({
      uuid: "6a1c-uuid",
      kind: "ptr",
      last: "Capito",
      filedAt: "2026-11-10",
      path: "/search/view/ptr/6a1c-uuid/",
    });
    expect(
      parseSenateListing(["a", "b", "c", "no link", "11/10/2026"]),
    ).toBeNull();
  });

  test("reads the transactions table", () => {
    const html = `<table><thead><tr><th>#</th></tr></thead><tbody>
<tr><td>1</td><td>11/05/2026</td><td>Spouse</td><td><a href="x">AAPL</a></td><td>Apple Inc. &amp; Co</td><td>Stock</td><td>Sale (Partial)</td><td>$15,001 - $50,000</td><td>--</td></tr>
<tr><td>2</td><td>11/06/2026</td><td>Self</td><td>--</td><td>Treasury Bill</td><td>Other Securities</td><td>Purchase</td><td>$1,001 - $15,000</td><td>note</td></tr>
</tbody></table>`;
    const rows = parseSenatePtr(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      owner: "spouse",
      ticker: "AAPL",
      asset: "Apple Inc. & Co",
      side: "partial_sale",
      transactedAt: "2026-11-05",
      amountMin: 15001,
      amountMax: 50000,
      note: null,
    });
    expect(rows[1]).toMatchObject({
      ticker: null,
      side: "buy",
      owner: "self",
      note: "note",
    });
  });
});
