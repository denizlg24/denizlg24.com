import { and, desc, eq, gt } from "drizzle-orm";

import { db } from "@/db/connection";
import { session } from "@/db/schema";
import { describeLastActive, describeUserAgent } from "./device-labels";

export interface AccountDevice {
  id: string;
  label: string;
  current: boolean;
  /** When Better Auth last refreshed the session, so accurate to about a day. */
  lastActiveAt: string;
  lastActive: string;
}

/**
 * Read straight from the table rather than through `listSessions`, which
 * refuses any session older than a day (`freshAge`) and would hand every
 * session token to the browser.
 */
export async function listAccountDevices(
  userId: string,
  currentSessionId: string,
): Promise<AccountDevice[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: session.id,
      userAgent: session.userAgent,
      updatedAt: session.updatedAt,
    })
    .from(session)
    .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
    .orderBy(desc(session.updatedAt));

  return rows
    .map((row) => ({
      id: row.id,
      label: describeUserAgent(row.userAgent),
      current: row.id === currentSessionId,
      lastActiveAt: row.updatedAt.toISOString(),
      lastActive: describeLastActive(row.updatedAt, now),
    }))
    .sort((a, b) => Number(b.current) - Number(a.current));
}

export async function findSessionToken(userId: string, sessionId: string) {
  const [row] = await db
    .select({ token: session.token })
    .from(session)
    .where(and(eq(session.id, sessionId), eq(session.userId, userId)))
    .limit(1);
  return row?.token ?? null;
}
