import { describe, expect, test } from "bun:test";
import type {
  FinanceEnvelope,
  FinanceEnvelopeStatus,
  FinanceLedgerEntry,
  LocationPlace,
} from "@repo/schemas";
import { type BriefSnapshot, buildStoreBrief } from "./location-brief";

const timestamp = "2026-10-01T10:00:00.000Z";

function purchase(
  id: string,
  amountMinor: number,
  effectiveDate: string,
  descriptor: string,
  category = "Groceries",
): FinanceLedgerEntry {
  return {
    id,
    origin: "bank",
    state: "booked",
    identityKind: "provider",
    accountId: "account-1",
    amountMinor,
    currency: "EUR",
    effectiveDate,
    valueDate: effectiveDate,
    descriptor,
    normalizedDescriptor: descriptor.toLowerCase(),
    category,
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const groceries: FinanceEnvelope = {
  id: "groceries",
  name: "Groceries",
  kind: "capped",
  categories: ["Groceries"],
  includeUncategorized: false,
  currency: "EUR",
  limitMinor: 40_000,
  period: "monthly",
  periodStartDay: 1,
  rollover: "none",
  startDate: "2026-01-01",
  contributions: [],
  status: "active",
  sortOrder: 0,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const status: FinanceEnvelopeStatus = {
  envelopeId: "groceries",
  name: "Groceries",
  kind: "capped",
  currency: "EUR",
  period: "monthly",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  limitMinor: 40_000,
  carryInMinor: 0,
  spentMinor: 37_000,
  refundedMinor: 0,
  committedMinor: 0,
  availableMinor: 3_000,
  projectedMinor: 70_000,
  elapsedFraction: 0.5,
  paceRatio: 1.8,
  entryCount: 12,
};

const snapshot: BriefSnapshot = {
  asOfDate: "2026-10-16",
  currency: "EUR",
  envelopes: [groceries],
  statuses: [status],
  ledger: {
    rows: [
      purchase("n1", -1_800, "2026-09-20", "NETTO 1234 KBH"),
      purchase("n2", -2_200, "2026-10-03", "NETTO 5678 KBH"),
      purchase("n3", -1_500, "2026-10-12", "NETTO 1234 KBH"),
      purchase("other", -900, "2026-10-10", "LIDL 22"),
    ],
  },
};

function place(
  name: string,
  distanceMetres: number,
  category: string | null,
): LocationPlace {
  return { name, category, latitude: 55.67, longitude: 12.56, distanceMetres };
}

describe("buildStoreBrief", () => {
  test("a shop bought from beats a nearer one never bought from", () => {
    const brief = buildStoreBrief({
      places: [
        place("Flying Tiger", 8, "MKPOICategoryStore"),
        place("Netto", 30, "MKPOICategoryFoodMarket"),
      ],
      snapshot,
    });
    if ("skip" in brief) throw new Error(brief.skip);
    expect(brief.place.name).toBe("Netto");
    expect(brief.merchant?.purchases).toBe(3);
    expect(brief.merchant?.medianMinor).toBe(1_800);
    expect(brief.merchant?.thisMonthMinor).toBe(3_700);
    expect(brief.envelope?.name).toBe("Groceries");
    expect(brief.envelope?.daysLeft).toBe(16);
    expect(brief.envelope?.perDayMinor).toBe(187);
  });

  test("a shop with no history and no envelope is not worth a word", () => {
    const brief = buildStoreBrief({
      places: [place("Flying Tiger", 8, "MKPOICategoryStore")],
      snapshot,
    });
    expect(brief).toEqual({ skip: "no spending history at Flying Tiger" });
  });

  test("places further than 75 m are neighbours, not the shop", () => {
    const brief = buildStoreBrief({
      places: [place("Netto", 120, "MKPOICategoryFoodMarket")],
      snapshot,
    });
    expect(brief).toEqual({ skip: "nothing named within 75 m" });
  });

  test("a Danish name with ø matches the bank's mangled descriptor", () => {
    const foetex = Array.from({ length: 12 }, (_, index) =>
      purchase(
        `f${index}`,
        -(1_000 + index * 100),
        `2026-10-${String(index + 1).padStart(2, "0")}`,
        index % 2 ? "Føtex · F?TEX LYNGBY" : "Føtex · F?TEX FISKETORV",
      ),
    );
    const brief = buildStoreBrief({
      places: [
        place("Frisør Stella", 5, "MKPOICategoryBeauty"),
        place("Føtex", 13, "MKPOICategoryFoodMarket"),
      ],
      snapshot: {
        ...snapshot,
        ledger: { rows: [...snapshot.ledger.rows, ...foetex] },
      },
    });
    if ("skip" in brief) throw new Error(brief.skip);
    expect(brief.place.name).toBe("Føtex");
    expect(brief.merchant?.purchases).toBe(12);
    expect(brief.envelope?.name).toBe("Groceries");
  });

  test("a park is not a shop", () => {
    const brief = buildStoreBrief({
      places: [place("Kongens Have", 10, "MKPOICategoryPark")],
      snapshot,
    });
    expect(brief).toEqual({ skip: "no shop among the places nearby" });
  });
});
