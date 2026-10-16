import type {
  FinanceEnvelopeStatus,
  FinanceLedgerEntry,
  LocationPlace,
} from "@repo/schemas";
import type { BudgetSnapshot } from "@/lib/finance/budget-overview";
import {
  commonDescriptorTokens,
  descriptorTokens,
  normalizeFinanceDescriptor,
  sharesIdentity,
} from "@/lib/finance/core";
import {
  daysBetween,
  envelopeClaimsRow,
  isCountableSpendRow,
} from "@/lib/finance/envelope-math";

/**
 * Which named place a visit is at, and the numbers about it: what the owner
 * has spent there and what is left in the envelope it draws on. Pure over a
 * budget snapshot, so the judge (`location-insight.ts`) stays the only part
 * that touches the database, the model or APNs.
 */

/** MapKit categories where money changes hands at the counter. */
const SHOP_CATEGORIES = new Set([
  "MKPOICategoryStore",
  "MKPOICategoryFoodMarket",
  "MKPOICategoryPharmacy",
  "MKPOICategoryBakery",
  "MKPOICategoryCafe",
  "MKPOICategoryRestaurant",
  "MKPOICategoryGasStation",
  "MKPOICategoryBrewery",
  "MKPOICategoryWinery",
]);

/** A visit's centre is accurate to tens of metres; a shop further off is a neighbour. */
const MAX_PLACE_METRES = 75;
const HISTORY_DAYS = 120;

export interface StoreBrief {
  place: LocationPlace;
  currency: string;
  merchant: {
    /** Purchases matched to this shop in the last 120 days. */
    purchases: number;
    medianMinor: number;
    thisMonthMinor: number;
    thisMonthPurchases: number;
    lastPurchase: string | null;
    category: string | null;
  } | null;
  envelope: {
    name: string;
    limitMinor: number;
    spentMinor: number;
    committedMinor: number;
    availableMinor: number;
    projectedMinor: number;
    daysLeft: number;
    /** What is left divided by the days left; zero once it is gone. */
    perDayMinor: number;
  } | null;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor(sorted.length / 2)] ?? 0) : 0;
}

function mode(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * The shop and the numbers about it, or why there is nothing to say.
 * Pure over the snapshot, so it can be tested without a database.
 */
export type BriefSnapshot = Pick<
  BudgetSnapshot,
  "asOfDate" | "currency" | "envelopes" | "statuses"
> & { ledger: Pick<BudgetSnapshot["ledger"], "rows"> };

export function buildStoreBrief(input: {
  places: LocationPlace[];
  snapshot: BriefSnapshot;
}): StoreBrief | { skip: string } {
  const { snapshot } = input;
  const nearby = input.places.filter(
    (place) => place.distanceMetres <= MAX_PLACE_METRES,
  );
  if (!nearby.length) return { skip: "nothing named within 75 m" };

  const since = new Date(`${snapshot.asOfDate}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - HISTORY_DAYS);
  const from = since.toISOString().slice(0, 10);
  const purchases = snapshot.ledger.rows.filter(
    (row) =>
      row.origin === "bank" &&
      row.amountMinor < 0 &&
      row.effectiveDate >= from &&
      isCountableSpendRow(row),
  );
  const common = commonDescriptorTokens(
    snapshot.ledger.rows
      .filter((row) => row.origin === "bank")
      .map((row) => row.normalizedDescriptor),
  );

  // A shop the owner has bought from beats a nearer one he never has: the
  // nearest pin in a mall is as likely to be the shop next door.
  let chosen: { place: LocationPlace; rows: FinanceLedgerEntry[] } | null =
    null;
  for (const place of nearby) {
    const tokens = descriptorTokens(normalizeFinanceDescriptor(place.name));
    if (!tokens.length) continue;
    const rows = purchases.filter((row) =>
      sharesIdentity(tokens, row.normalizedDescriptor, common),
    );
    if (rows.length) {
      chosen = { place, rows };
      break;
    }
  }
  if (!chosen) {
    const shop = nearby.find(
      (place) => place.category && SHOP_CATEGORIES.has(place.category),
    );
    if (!shop) return { skip: "no shop among the places nearby" };
    chosen = { place: shop, rows: [] };
  }

  const month = snapshot.asOfDate.slice(0, 7);
  const thisMonth = chosen.rows.filter((row) =>
    row.effectiveDate.startsWith(month),
  );
  const category = mode(
    chosen.rows.flatMap((row) => (row.category ? [row.category] : [])),
  );
  const merchant = chosen.rows.length
    ? {
        purchases: chosen.rows.length,
        medianMinor: median(chosen.rows.map((row) => -row.amountMinor)),
        thisMonthMinor: thisMonth.reduce(
          (sum, row) => sum - row.amountMinor,
          0,
        ),
        thisMonthPurchases: thisMonth.length,
        lastPurchase:
          [...chosen.rows].sort((a, b) =>
            b.effectiveDate.localeCompare(a.effectiveDate),
          )[0]?.effectiveDate ?? null,
        category,
      }
    : null;

  // The envelope this shop's spending lands in, read off a real purchase so
  // an account-scoped envelope is matched the way the ledger matches it.
  const sample = chosen.rows.find((row) => row.category === category);
  const envelope = sample
    ? snapshot.envelopes.find(
        (candidate) =>
          candidate.status === "active" &&
          candidate.kind === "capped" &&
          envelopeClaimsRow(candidate, sample),
      )
    : undefined;
  const status: FinanceEnvelopeStatus | undefined = envelope
    ? snapshot.statuses.find((entry) => entry.envelopeId === envelope.id)
    : undefined;

  if (!merchant && !status) {
    return { skip: `no spending history at ${chosen.place.name}` };
  }

  const daysLeft = status
    ? Math.max(1, daysBetween(snapshot.asOfDate, status.periodEnd) + 1)
    : 0;
  return {
    place: chosen.place,
    currency: snapshot.currency,
    merchant,
    envelope: status
      ? {
          name: status.name,
          limitMinor: status.limitMinor + status.carryInMinor,
          spentMinor: status.spentMinor,
          committedMinor: status.committedMinor,
          availableMinor: status.availableMinor,
          projectedMinor: status.projectedMinor,
          daysLeft,
          perDayMinor: Math.max(
            0,
            Math.floor(status.availableMinor / daysLeft),
          ),
        }
      : null,
  };
}
