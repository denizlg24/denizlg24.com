import "server-only";
import { createHash } from "node:crypto";
import { readWorkspace, saveWorkspace } from "../db";
import type { Trade, Workspace } from "../models";
import {
  fetchFlexStatement,
  FlexError,
  parseFlexStatement,
  type BrokerStatement,
} from "./ibkr";
import { dueLinks, markLink, readLink } from "./link";
import { resolveListings } from "./listing";

function stableId(seed: string) {
  const bytes = createHash("sha256").update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function applyStatement(
  userId: string,
  workspace: Workspace,
  statement: BrokerStatement,
  now = new Date(),
): Workspace {
  const syncedAt = now.toISOString();
  const books = [...workspace.books];
  let trades = workspace.trades;
  for (const account of statement.accounts) {
    const bookId = stableId(`${userId}:ibkr:${account.id}`);
    const existing = books.findIndex(
      (book) =>
        book.id === bookId ||
        (book.broker?.provider === "ibkr" &&
          book.broker.account === account.id),
    );
    const id = existing >= 0 ? books[existing]!.id : bookId;
    const book = {
      id,
      name:
        existing >= 0
          ? books[existing]!.name
          : `Interactive Brokers ${account.id}`,
      broker: {
        provider: "ibkr" as const,
        account: account.id,
        asOf: account.asOf,
        syncedAt,
        cash: account.cash,
        skipped: statement.skipped
          .filter((item) => item.account === account.id)
          .map(({ symbol, reason }) => ({
            symbol: symbol.slice(0, 60),
            reason: reason.slice(0, 120),
          }))
          .slice(0, 200),
      },
    };
    if (existing >= 0) books[existing] = book;
    else books.push(book);
    const seen = new Map<string, number>();
    const synced: Trade[] = account.lots.map((lot) => {
      const base = `${lot.symbol}:${lot.currency}:${lot.date}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return {
        id: stableId(`${id}:${base}:${n}`),
        bookId: id,
        symbol: lot.symbol,
        side: "buy",
        quantity: lot.quantity,
        price: lot.price,
        fees: 0,
        currency: lot.currency,
        date: lot.date,
      };
    });
    trades = [...trades.filter((trade) => trade.bookId !== id), ...synced];
  }
  if (books.length > 25)
    throw new Error("Syncing would exceed 25 portfolios. Remove one first.");
  if (trades.length > 5000)
    throw new Error("Syncing would exceed 5,000 transactions.");
  return { ...workspace, books, trades };
}

export type SyncResult =
  | {
      ok: true;
      accounts: Array<{ id: string; positions: number; asOf: string }>;
      skipped: BrokerStatement["skipped"];
    }
  | { ok: false; error: string; relink: boolean };

const running = new Map<string, Promise<SyncResult>>();

export function syncUser(userId: string): Promise<SyncResult> {
  const pending = running.get(userId);
  if (pending) return pending;
  const job = runSync(userId).finally(() => running.delete(userId));
  running.set(userId, job);
  return job;
}

async function runSync(userId: string): Promise<SyncResult> {
  const link = await readLink(userId);
  if (!link)
    return {
      ok: false,
      error: "Interactive Brokers is not connected.",
      relink: true,
    };
  if (!link.token)
    return { ok: false, error: link.error ?? "Connect again.", relink: true };
  let statement: BrokerStatement;
  try {
    statement = await resolveListings(
      parseFlexStatement(await fetchFlexStatement(link.token, link.queryId)),
    );
  } catch (error) {
    const relink = error instanceof FlexError && error.credentials;
    const message =
      error instanceof Error
        ? error.message
        : "Interactive Brokers sync failed.";
    await markLink(userId, relink ? "relink" : "error", message, false);
    return { ok: false, error: message, relink };
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readWorkspace(userId);
    let next: Workspace;
    try {
      next = applyStatement(userId, current.data, statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed.";
      await markLink(userId, "error", message, false);
      return { ok: false, error: message, relink: false };
    }
    if (await saveWorkspace(userId, current.revision, next)) {
      await markLink(userId, "active", null, true);
      return {
        ok: true,
        accounts: statement.accounts.map((account) => ({
          id: account.id,
          positions: account.lots.length,
          asOf: account.asOf,
        })),
        skipped: statement.skipped,
      };
    }
  }
  const message = "The workspace kept changing during sync. Try again.";
  await markLink(userId, "error", message, false);
  return { ok: false, error: message, relink: false };
}

const syncInterval = 6 * 60 * 60 * 1000;
let sweeping = false;

export async function syncDueLinks() {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const userId of await dueLinks(syncInterval)) {
      await syncUser(userId);
    }
  } finally {
    sweeping = false;
  }
}
