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

  test("reports no balance, since a transaction sum is not a closing balance", async () => {
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
    expect(await provider.fetchBalances("csv-account")).toEqual([]);
    expect(await provider.connectionState("csv-account")).toEqual({
      status: "active",
    });
  });

  test("keeps quoted fields containing newlines in one record", () => {
    const csv =
      'date,amount,currency,description\n2026-07-28,-12.50,EUR,"Cafe\nLisbon"\n2026-07-29,-3.00,EUR,Bakery';
    const transactions = parseFinanceCsv(csv, "csv-account");
    expect(transactions).toHaveLength(2);
    expect(transactions[0]?.descriptor).toBe("Cafe\nLisbon");
    expect(transactions[1]?.descriptor).toBe("Bakery");
  });

  test("gives identical rows distinct synthetic ids", () => {
    const csv =
      "date,amount,currency,description\n2026-07-28,-2.50,EUR,Cafe\n2026-07-28,-2.50,EUR,Cafe";
    const [first, second] = parseFinanceCsv(csv, "csv-account");
    expect(first?.providerTxnId).not.toBe(second?.providerTxnId);
  });

  test("keeps the first synthetic id stable when a duplicate appears later", () => {
    const single = parseFinanceCsv(
      "date,amount,currency,description\n2026-07-28,-2.50,EUR,Cafe",
      "csv-account",
    );
    const doubled = parseFinanceCsv(
      "date,amount,currency,description\n2026-07-28,-2.50,EUR,Cafe\n2026-07-28,-2.50,EUR,Cafe",
      "csv-account",
    );
    expect(doubled[0]?.providerTxnId).toBe(single[0]?.providerTxnId);
  });
});
