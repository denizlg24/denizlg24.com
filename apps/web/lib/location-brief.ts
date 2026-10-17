import type {
  FinanceEnvelopeStatus,
  FinanceLedgerEntry,
  LocationPlace,
} from "@repo/schemas";
import type { BudgetSnapshot } from "@/lib/finance/budget-overview";
import {
  commonDescriptorTokens,
  descriptorTokens,
  identityDescriptor,
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

type LedgerRows = BriefSnapshot["ledger"]["rows"];

/**
 * What his banks print before the merchant on a card payment. Usually common
 * enough to be caught statistically too, but a short history must not turn
 * `compra` into the shop.
 */
const CARD_PREFIXES = new Set([
  "compra",
  "estrang",
  "estr",
  "debito",
  "comiss",
  "comissao",
  "pagamento",
  "dankort",
  "mobilepay",
]);

/**
 * Words that say what kind of place it is, not which: `CAFE NORD` is Nord.
 * As a merchant word, `cafe` would fence every café in town and lend one
 * café's history to the next.
 */
const GENERIC_PLACE_WORDS = new Set([
  "cafe",
  "caffe",
  "coffee",
  "restaurant",
  "restaurante",
  "pizza",
  "pizzeria",
  "bageri",
  "bakery",
  "kiosk",
  "store",
  "shop",
  "market",
  "marked",
  "super",
  "supermarket",
  "supermercado",
  "mini",
  "bistro",
  "grill",
  "kebab",
]);

/**
 * The word in a card descriptor that names the merchant: the first one that
 * is not a bank code. Terminals lead with the brand and follow with the
 * branch (`lidl 247 lyngby`, `foetex fisketorvet`, `rema 1000 naerum`), so
 * every later word is a place, and matching on those would make "Lyngby
 * Station" the shop he spends at in Føtex Lyngby.
 */
export function merchantToken(descriptor: string, common: ReadonlySet<string>) {
  return (
    descriptorTokens(identityDescriptor(descriptor)).find(
      (token) =>
        !common.has(token) &&
        !CARD_PREFIXES.has(token) &&
        !GENERIC_PLACE_WORDS.has(token),
    ) ?? null
  );
}

/** Bank codes common enough across his distinct merchants to name nobody. */
export function commonMerchantWords(rows: LedgerRows) {
  // Counted over distinct names, not rows: a bank code sits on every kind of
  // counterparty, while the shop he goes to most sits on a fifth of his rows
  // and is exactly the one this has to recognise.
  return commonDescriptorTokens([
    ...new Set(
      rows
        .filter((row) => row.origin === "bank")
        .map((row) => descriptorTokens(identityDescriptor(row.descriptor)))
        .map((tokens) => [...new Set(tokens)].sort().join(" ")),
    ),
  ]);
}

/**
 * A place's name words in both spellings a Danish letter reaches a card
 * terminal in: `Føtex` is `F?TEX` on one statement and `FOETEX` on another.
 */
export function placeTokens(name: string) {
  const transliterated = name
    .replace(/ø/g, "oe")
    .replace(/Ø/g, "OE")
    .replace(/å/g, "aa")
    .replace(/Å/g, "AA");
  return [
    ...new Set([
      ...descriptorTokens(identityDescriptor(name)),
      ...descriptorTokens(identityDescriptor(transliterated)),
    ]),
  ];
}

/**
 * Whether a place's name names this merchant. A prefix counts both for a
 * name run into its branch (`lidlfisketorvet`) and for a shorter place name.
 */
export function placeNamesMerchant(placeTokens: string[], merchant: string) {
  return placeTokens.some(
    (token) => token === merchant || merchant.startsWith(token),
  );
}

export type BriefSnapshot = Pick<
  BudgetSnapshot,
  "asOfDate" | "currency" | "envelopes" | "statuses"
> & { ledger: Pick<BudgetSnapshot["ledger"], "rows"> };

/** Purchases in the history window, as the brief and the geofences count them. */
export function recentPurchases(snapshot: BriefSnapshot) {
  const since = new Date(`${snapshot.asOfDate}T00:00:00.000Z`);
  since.setUTCDate(since.getUTCDate() - HISTORY_DAYS);
  const from = since.toISOString().slice(0, 10);
  return snapshot.ledger.rows.filter(
    (row) =>
      row.origin === "bank" &&
      row.amountMinor < 0 &&
      row.effectiveDate >= from &&
      isCountableSpendRow(row),
  );
}

/** The shop and the numbers about it, or why there is nothing to say. */
export function buildStoreBrief(input: {
  places: LocationPlace[];
  snapshot: BriefSnapshot;
}): StoreBrief | { skip: string } {
  const { snapshot } = input;
  const nearby = input.places.filter(
    (place) => place.distanceMetres <= MAX_PLACE_METRES,
  );
  if (!nearby.length) {
    return { skip: `nothing named within ${MAX_PLACE_METRES} m` };
  }

  const purchases = recentPurchases(snapshot);
  const common = commonMerchantWords(snapshot.ledger.rows);
  const merchantOf = new Map(
    purchases.map((row) => [row.id, merchantToken(row.descriptor, common)]),
  );

  // A shop the owner has bought from beats a nearer one he never has: the
  // nearest pin in a mall is as likely to be the shop next door.
  let chosen: { place: LocationPlace; rows: FinanceLedgerEntry[] } | null =
    null;
  for (const place of nearby) {
    const tokens = placeTokens(place.name);
    if (!tokens.length) continue;
    const rows = purchases.filter((row) => {
      const merchant = merchantOf.get(row.id);
      return merchant ? placeNamesMerchant(tokens, merchant) : false;
    });
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

/**
 * The merchant words of everything he has bought in the history window, most
 * frequent first: the phone fences the shops nearby whose names carry one.
 */
export function merchantTokens(snapshot: BriefSnapshot, limit = 150) {
  const common = commonMerchantWords(snapshot.ledger.rows);
  const counts = new Map<string, number>();
  for (const row of recentPurchases(snapshot)) {
    const token = merchantToken(row.descriptor, common);
    if (token) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}
