import "server-only";
import { store } from "./db";

export const runRetentionDays = 90;

export async function purgeExpiredRuns(): Promise<number> {
  const s = await store();
  const cutoff = new Date(
    Date.now() - runRetentionDays * 86_400_000,
  ).toISOString();
  if (s.kind === "pg") {
    const result = await s.sql`
      DELETE FROM stockwatcher_chat_runs WHERE started_at < ${cutoff}`;
    return result.count;
  }
  return Number(
    s.db.prepare("DELETE FROM chat_runs WHERE started_at < ?").run(cutoff)
      .changes,
  );
}
