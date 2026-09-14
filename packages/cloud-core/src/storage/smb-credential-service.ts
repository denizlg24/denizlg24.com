import { and, desc, eq, isNull } from "drizzle-orm";

import type { Database } from "../db";
import { smbCredentials } from "../db/schema";
import type { SmbSessionsPayload } from "./metadata-protocol";
import {
  deriveSmbPrincipal,
  generateSmbSecret,
  SmbCredentialError,
} from "./smb-credentials";

export interface SafeSmbCredential {
  createdAt: Date;
  deviceName: string;
  expiresAt: Date | null;
  id: string;
  lastAuthenticatedAt: Date | null;
  lastAuthenticatedFrom: string | null;
  /** Whether the host reports a session open right now. Never persisted. */
  connected: boolean;
  principal: string;
}

/**
 * Reads the host's view of SMB sign-ins. Null when it cannot be read, which
 * leaves the persisted columns as they are rather than failing the list.
 */
export type SmbSessionsReader = () => Promise<SmbSessionsPayload | null>;

export interface IssuedSmbCredential extends SafeSmbCredential {
  /** Returned once, at creation. Samba holds the only other copy. */
  secret: string;
}

/**
 * Provisions and revokes the Samba account behind a credential.
 *
 * Samba's passdb is on the host and the API runs in a container, so the
 * credential material cannot be written from here. The API therefore only ever
 * *asks* for provisioning; the privileged host agent performs it.
 */
export interface SmbProvisioner {
  provision(input: {
    accountId: string;
    principal: string;
    secret: string;
  }): Promise<void>;
  revoke(principal: string): Promise<void>;
}

/** Bounds how many devices one account can hold, as DAV credentials did. */
export const SMB_MAX_CREDENTIALS_PER_USER = 10;

function toSafe(
  record: typeof smbCredentials.$inferSelect,
  connected = false,
): SafeSmbCredential {
  return {
    connected,
    createdAt: record.createdAt,
    deviceName: record.deviceName,
    expiresAt: record.expiresAt,
    id: record.id,
    lastAuthenticatedAt: record.lastAuthenticatedAt,
    lastAuthenticatedFrom: record.lastAuthenticatedFrom,
    principal: record.principal,
  };
}

/**
 * Lists a user's live device credentials, folding in what the host has seen.
 *
 * `last_authenticated_at` is written here and nowhere else: Samba's audit
 * stream lives on the host, so the API learns of a sign-in only by asking. A
 * newer observation than the stored one is persisted before the list is
 * returned, which is what makes the device page's "waiting for the
 * connection…" poll able to flip. The host answering slowly or not at all
 * degrades to the stored values — the list must not fail because a status
 * column could not be refreshed.
 */
export async function listSmbCredentials(
  db: Database,
  userId: string,
  readSessions?: SmbSessionsReader,
): Promise<SafeSmbCredential[]> {
  const rows = await db
    .select()
    .from(smbCredentials)
    .where(
      and(eq(smbCredentials.userId, userId), isNull(smbCredentials.revokedAt)),
    )
    // Newest first, and ordered at all: an unordered select returns rows in
    // whatever order Postgres finds them, so the list reshuffled between polls.
    .orderBy(desc(smbCredentials.createdAt));
  if (rows.length === 0 || !readSessions) {
    return rows.map((row) => toSafe(row));
  }

  const sessions = await readSessions().catch(() => null);
  if (!sessions) return rows.map((row) => toSafe(row));
  const latest = new Map(
    sessions.connections.map((entry) => [entry.principal, entry]),
  );
  const open = new Set(sessions.open.map((session) => session.principal));

  return Promise.all(
    rows.map(async (row) => {
      const seen = latest.get(row.principal);
      const newer =
        seen &&
        (!row.lastAuthenticatedAt ||
          seen.at > row.lastAuthenticatedAt.getTime());
      if (!newer) return toSafe(row, open.has(row.principal));
      const observedAt = new Date(seen.at);
      await db
        .update(smbCredentials)
        .set({
          lastAuthenticatedAt: observedAt,
          lastAuthenticatedFrom: seen.from.slice(0, 64),
        })
        .where(eq(smbCredentials.id, row.id))
        .catch(console.error);
      return toSafe(
        {
          ...row,
          lastAuthenticatedAt: observedAt,
          lastAuthenticatedFrom: seen.from.slice(0, 64),
        },
        open.has(row.principal),
      );
    }),
  );
}

/**
 * Issues a device credential.
 *
 * Metadata is written before the Samba account exists, per PROVISION_ORDER: a
 * crash then leaves a row that cannot authenticate and is visible for cleanup,
 * where the reverse would leave a working Samba account no row knows about —
 * an unrevocable credential. If provisioning fails the row is rolled back, so
 * a failed issue leaves nothing behind.
 */
export async function issueSmbCredential(
  db: Database,
  provisioner: SmbProvisioner,
  input: { userId: string; deviceName: string; expiresAt?: Date | null },
): Promise<IssuedSmbCredential> {
  const live = await listSmbCredentials(db, input.userId);
  if (live.length >= SMB_MAX_CREDENTIALS_PER_USER) {
    throw new SmbCredentialError(
      `At most ${SMB_MAX_CREDENTIALS_PER_USER} devices may be live at once`,
      "INVALID_DEVICE_NAME",
    );
  }

  const principal = deriveSmbPrincipal(input.deviceName);
  const secret = generateSmbSecret();
  const [row] = await db
    .insert(smbCredentials)
    .values({
      deviceName: input.deviceName,
      expiresAt: input.expiresAt ?? null,
      principal,
      userId: input.userId,
    })
    .returning();
  if (!row) throw new Error("Failed to record the SMB credential");

  try {
    await provisioner.provision({
      accountId: input.userId,
      principal,
      secret,
    });
  } catch (error) {
    // The Samba account was never created, so the row describes nothing.
    await db.delete(smbCredentials).where(eq(smbCredentials.id, row.id));
    throw error;
  }

  return { ...toSafe(row), secret };
}

/**
 * Revokes a device credential.
 *
 * Marked revoked before Samba is told, per REVOKE_ORDER: a crash after marking
 * leaves something that reads revoked but might still authenticate, which is
 * visible and fixed by re-running. The reverse presents as a broken device and
 * invites someone to re-enable it.
 */
export async function revokeSmbCredential(
  db: Database,
  provisioner: SmbProvisioner,
  userId: string,
  id: string,
): Promise<boolean> {
  const [row] = await db
    .update(smbCredentials)
    .set({ revokedAt: new Date(), revokedReason: "revoked by owner" })
    .where(
      and(
        eq(smbCredentials.id, id),
        eq(smbCredentials.userId, userId),
        isNull(smbCredentials.revokedAt),
      ),
    )
    .returning();
  if (!row) return false;
  await provisioner.revoke(row.principal);
  return true;
}
