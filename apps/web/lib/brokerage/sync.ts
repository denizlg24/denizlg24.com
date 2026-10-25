import type { BrokerageSyncInput, BrokerageSyncResult } from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import {
  BrokerageActivityModel,
  BrokerageSnapshotModel,
  BrokerageSyncState,
} from "@/models/Brokerage";
import { FlexError, parseFlexStatements, pullFlexStatement } from "./flex";

export const BROKERAGE_STATE_ID = "ibkr";

export class BrokerageNotConfiguredError extends Error {
  constructor(variable: string) {
    super(`${variable} is not set`);
    this.name = "BrokerageNotConfiguredError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new BrokerageNotConfiguredError(name);
  return value;
}

/**
 * Pulls a Flex statement and upserts it. Every write is keyed — snapshots by
 * (account, day), activity by IBKR's transaction id — so re-pulling an
 * overlapping period is harmless, and a daily query covering several days
 * repairs any day a missed run skipped.
 */
export async function runBrokerageSync(
  input: BrokerageSyncInput = {},
): Promise<BrokerageSyncResult> {
  const token = requireEnv("IBKR_FLEX_TOKEN");
  const queryId = requireEnv(
    input.history ? "IBKR_FLEX_HISTORY_QUERY_ID" : "IBKR_FLEX_QUERY_ID",
  );

  await connectDB();
  const attemptedAt = new Date();
  await BrokerageSyncState.updateOne(
    { _id: BROKERAGE_STATE_ID },
    { $set: { lastAttemptAt: attemptedAt } },
    { upsert: true },
  );

  try {
    const statements = parseFlexStatements(
      await pullFlexStatement({ token, queryId }),
    );
    if (statements.length === 0) {
      throw new FlexError("Flex statement contained no account statements");
    }

    const snapshots = statements.flatMap((statement) =>
      statement.snapshot ? [statement.snapshot] : [],
    );
    if (snapshots.length > 0) {
      await BrokerageSnapshotModel.bulkWrite(
        snapshots.map((snapshot) => ({
          replaceOne: {
            filter: {
              accountId: snapshot.accountId,
              reportDate: snapshot.reportDate,
            },
            replacement: { ...snapshot, syncedAt: attemptedAt },
            upsert: true,
          },
        })),
      );
    }

    const activity = statements.flatMap((statement) =>
      statement.activity.map(({ id, ...row }) => ({
        ...row,
        accountId: statement.accountId,
        activityId: id,
      })),
    );
    if (activity.length > 0) {
      await BrokerageActivityModel.bulkWrite(
        activity.map((row) => ({
          replaceOne: {
            filter: { accountId: row.accountId, activityId: row.activityId },
            replacement: row,
            upsert: true,
          },
        })),
      );
    }

    const newest = statements.reduce((latest, statement) =>
      statement.toDate > latest.toDate ? statement : latest,
    );
    const baseCurrency = snapshots.find(
      (snapshot) => snapshot.accountId === newest.accountId,
    )?.baseCurrency;
    await BrokerageSyncState.updateOne(
      { _id: BROKERAGE_STATE_ID },
      {
        $set: {
          accountId: newest.accountId,
          ...(baseCurrency ? { baseCurrency } : {}),
          ...(newest.entity ? { entity: newest.entity } : {}),
          lastSyncedAt: attemptedAt,
        },
        $unset: { lastError: 1 },
      },
    );

    const days = statements.map((statement) => statement.toDate).sort();
    return {
      statements: statements.length,
      snapshots: snapshots.length,
      activity: activity.length,
      fromDate: statements.map((s) => s.fromDate).sort()[0] ?? null,
      toDate: days.at(-1) ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await BrokerageSyncState.updateOne(
      { _id: BROKERAGE_STATE_ID },
      { $set: { lastError: message } },
    );
    throw error;
  }
}
