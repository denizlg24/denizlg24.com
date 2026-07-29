import { describe, expect, test } from "bun:test";
import { CsvBankProvider, parseFinanceCsv } from "./csv";

describe("CSV bank adapter", () => {
  test("normalises CSV rows through the provider seam", async () => {
    const csv =
      'date,amount,currency,description,transaction_id\n2026-07-28,-12.50,EUR,"Cafe, Lisbon",txn-1';
    const transactions = parseFinanceCsv(csv, "csv-account");
    expect(transactions).toEqual([
      {
        accountRef: "csv-account",
        providerTxnId: "txn-1",
        transactionId: "txn-1",
        status: "booked",
        bookingDate: "2026-07-28",
        valueDate: "2026-07-28",
        amountMinor: -1_250,
        currency: "EUR",
        descriptor: "Cafe, Lisbon",
        normalizedDescriptor: "cafe lisbon",
      },
    ]);
  });

  test("implements balances without application-specific branching", async () => {
    const provider = new CsvBankProvider({
      account: {
        accountRef: "csv-account",
        identificationHash: "csv-hash",
        institutionId: "csv",
        institutionName: "CSV",
        displayName: "Imported",
        currency: "EUR",
      },
      csv: "date,amount,currency,description\n2026-07-28,10.00,EUR,Income\n2026-07-29,-2.50,EUR,Cafe",
      fetchedAt: new Date("2026-07-29T12:00:00.000Z"),
    });
    expect((await provider.fetchBalances("csv-account"))[0]?.amountMinor).toBe(
      750,
    );
    expect(await provider.connectionState("csv-account")).toEqual({
      status: "active",
    });
  });
});
