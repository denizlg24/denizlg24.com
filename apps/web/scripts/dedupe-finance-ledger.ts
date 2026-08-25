/**
 * Collapses bank rows this account's provider handed us twice, then backfills
 * the content key that stops it happening again.
 *
 * The bank mints a transaction id whose last digits are a per-run counter, not
 * part of the transaction's identity: the same booked purchase came back as
 * `...0001` on one nightly sync and `...0002` on the next. Ingest treated a
 * provider id as the whole identity and wrote `syntheticKey: undefined`
 * alongside it, so the second reading had nothing to recognise and inserted a
 * second row. Balances and expense totals then counted it twice.
 *
 * Two rows are merged only when both hold: they agree on account, amount,
 * currency, normalized descriptor and effective date, *and* their provider ids
 * differ only in a trailing run of digits. The second condition is what keeps
 * two genuinely identical purchases on one day apart — those carry unrelated
 * ids. Clusters that fail it are reported, never merged.
 *
 * The survivor is the row seen first. Anything the owner or the matcher put on
 * a loser (category, note, link, transfer) moves across only where the
 * survivor has nothing, and every reference to a loser is repointed before it
 * is deleted.
 *
 * The backfill then writes `syntheticKey` on every bank row that lacks one,
 * numbering repeats within an account the way ingest does. It has to run after
 * the merge: two duplicate rows would otherwise compute the same key and trip
 * the unique index on (accountId, syntheticKey).
 *
 *   bun --env-file=../../.env scripts/dedupe-finance-ledger.ts
 *     --execute      apply instead of reporting
 *     --verbose      print every cluster, not just the totals
 */
import mongoose from "mongoose";
import { transactionSyntheticKey } from "@/lib/finance/core";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceLedgerEntry,
  FinanceMatchReview,
  FinanceTransfer,
  type IFinanceLedgerEntry,
} from "@/models/Finance";

const execute = process.argv.includes("--execute");
const verbose = process.argv.includes("--verbose");

/**
 * Whether two provider ids are the same transaction under a different run
 * counter: equal length, and differing only across a trailing stretch of
 * digits. `202608170611472677970001` and `...0002` qualify; two ids that
 * diverge anywhere earlier do not.
 */
function differsOnlyByTrailingCounter(left: string, right: string): boolean {
  if (left === right || left.length !== right.length) return false;
  let index = 0;
  while (index < left.length && left[index] === right[index]) index += 1;
  const leftTail = left.slice(index);
  const rightTail = right.slice(index);
  return (
    leftTail.length <= 4 && /^\d+$/.test(leftTail) && /^\d+$/.test(rightTail)
  );
}

function clusterKey(row: IFinanceLedgerEntry): string {
  return [
    String(row.accountId),
    row.amountMinor,
    row.currency,
    row.normalizedDescriptor,
    row.effectiveDate,
  ].join("\0");
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * Moves a reference off a row about to be deleted. A pair that would collide
 * with one the survivor already holds is deleted instead of repointed: the
 * unique index on it says that relationship is already recorded.
 */
async function repointOrDrop(
  doc: mongoose.Document,
  field: string,
  to: mongoose.Types.ObjectId,
): Promise<number> {
  doc.set({ [field]: to });
  try {
    await doc.save();
    return 1;
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    await doc.deleteOne();
    return 0;
  }
}

await connectDB();

const rows = await FinanceLedgerEntry.find({ origin: "bank" })
  .sort({ firstSeenAt: 1, createdAt: 1 })
  .exec();

const clusters = new Map<string, IFinanceLedgerEntry[]>();
for (const row of rows) {
  const key = clusterKey(row);
  const bucket = clusters.get(key);
  if (bucket) bucket.push(row);
  else clusters.set(key, [row]);
}

const totals = {
  bankRows: rows.length,
  clustersInspected: 0,
  merged: 0,
  deleted: 0,
  skippedUnrelatedIds: 0,
  referencesRepointed: 0,
  syntheticKeysWritten: 0,
};
const deletedIds = new Set<string>();

for (const bucket of clusters.values()) {
  if (bucket.length < 2) continue;
  totals.clustersInspected += 1;

  const [survivor, ...rest] = bucket;
  const losers = rest.filter((row) => {
    const left = survivor.providerTxnId;
    const right = row.providerTxnId;
    if (!left || !right) return true;
    return differsOnlyByTrailingCounter(left, right);
  });
  const unrelated = rest.length - losers.length;
  totals.skippedUnrelatedIds += unrelated;

  if (losers.length === 0) {
    if (verbose) {
      console.log(
        `keep  ${survivor.effectiveDate} ${survivor.amountMinor} ${survivor.currency} ${survivor.normalizedDescriptor} — ids unrelated, left alone`,
      );
    }
    continue;
  }

  if (verbose) {
    console.log(
      `merge ${survivor.effectiveDate} ${survivor.amountMinor} ${survivor.currency} ${survivor.normalizedDescriptor}`,
    );
    console.log(`      keep   ${survivor.providerTxnId ?? "(no id)"}`);
    for (const loser of losers) {
      console.log(`      drop   ${loser.providerTxnId ?? "(no id)"}`);
    }
    if (unrelated > 0) {
      console.log(`      ${unrelated} row(s) left alone — unrelated ids`);
    }
  }

  for (const loser of losers) {
    // Only fills gaps: a survivor that already carries a category or a link
    // was curated on that row, and the loser must not overwrite it.
    const carried: Record<string, unknown> = {};
    if (!survivor.category && loser.category) carried.category = loser.category;
    if (!survivor.note && loser.note) carried.note = loser.note;
    if (!survivor.linkedLedgerId && loser.linkedLedgerId) {
      carried.linkedLedgerId = loser.linkedLedgerId;
      carried.matchMethod = loser.matchMethod;
      carried.matchConfidence = loser.matchConfidence;
    }
    if (!survivor.transferId && loser.transferId) {
      carried.transferId = loser.transferId;
    }
    const rejected = [
      ...new Set(
        [
          ...(survivor.rejectedMatchIds ?? []),
          ...(loser.rejectedMatchIds ?? []),
        ].map(String),
      ),
    ];
    if (rejected.length > (survivor.rejectedMatchIds ?? []).length) {
      carried.rejectedMatchIds = rejected.map(
        (id) => new mongoose.Types.ObjectId(id),
      );
    }

    if (execute) {
      if (Object.keys(carried).length > 0) {
        survivor.set(carried);
        await survivor.save();
      }

      const repointed = await FinanceLedgerEntry.updateMany(
        { linkedLedgerId: loser._id },
        { $set: { linkedLedgerId: survivor._id } },
      );
      await FinanceLedgerEntry.updateMany(
        { rejectedMatchIds: loser._id },
        { $addToSet: { rejectedMatchIds: survivor._id } },
      );
      await FinanceLedgerEntry.updateMany(
        { rejectedMatchIds: loser._id },
        { $pull: { rejectedMatchIds: loser._id } },
      );
      totals.referencesRepointed += repointed.modifiedCount;

      const transfers = await FinanceTransfer.find({
        $or: [{ debitLedgerId: loser._id }, { creditLedgerId: loser._id }],
      }).exec();
      for (const transfer of transfers) {
        const field = transfer.debitLedgerId.equals(loser._id)
          ? "debitLedgerId"
          : "creditLedgerId";
        totals.referencesRepointed += await repointOrDrop(
          transfer,
          field,
          survivor._id,
        );
      }

      const reviews = await FinanceMatchReview.find({
        $or: [
          { sourceLedgerId: loser._id },
          { candidateBankLedgerId: loser._id },
        ],
      }).exec();
      for (const review of reviews) {
        const field = review.sourceLedgerId.equals(loser._id)
          ? "sourceLedgerId"
          : "candidateBankLedgerId";
        totals.referencesRepointed += await repointOrDrop(
          review,
          field,
          survivor._id,
        );
      }

      await FinanceLedgerEntry.deleteOne({ _id: loser._id });
    }

    deletedIds.add(loser._id.toString());
    totals.deleted += 1;
  }
  totals.merged += 1;
}

// Ingest numbers repeats within one batch; here the whole surviving history is
// the batch, ordered the way it was observed.
const occurrences = new Map<string, number>();
for (const row of rows) {
  if (deletedIds.has(row._id.toString())) continue;
  if (row.syntheticKey) continue;
  if (!row.valueDate) {
    console.warn(`skipping ${row._id.toString()}: bank row has no valueDate`);
    continue;
  }
  const base = transactionSyntheticKey(String(row.accountId), {
    valueDate: row.valueDate,
    amountMinor: row.amountMinor,
    currency: row.currency,
    descriptor: row.descriptor,
    normalizedDescriptor: row.normalizedDescriptor,
  });
  const occurrence = occurrences.get(base) ?? 0;
  occurrences.set(base, occurrence + 1);
  const syntheticKey = transactionSyntheticKey(
    String(row.accountId),
    {
      valueDate: row.valueDate,
      amountMinor: row.amountMinor,
      currency: row.currency,
      descriptor: row.descriptor,
      normalizedDescriptor: row.normalizedDescriptor,
    },
    occurrence,
  );
  if (execute) {
    await FinanceLedgerEntry.updateOne(
      { _id: row._id },
      { $set: { syntheticKey } },
    );
  }
  totals.syntheticKeysWritten += 1;
}

console.log(
  JSON.stringify({ mode: execute ? "execute" : "dry-run", ...totals }),
);
await mongoose.disconnect();
