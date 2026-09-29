import type {
  MacrosDistributionApprovedDevice,
  MacrosDistributionPublishedResponse,
  MacrosDistributionRegistration,
  MacrosDistributionRequest,
  MacrosDistributionRequestStatus,
} from "@repo/schemas/macros";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/connection";
import { distributionRequests } from "@/db/schema";
import { createAuthEmail, getPublicAppUrl, sendEmail } from "@/lib/email";

type DistributionRequestRow = typeof distributionRequests.$inferSelect;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function serializeDistributionRequest(
  row: DistributionRequestRow,
): MacrosDistributionRequest {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    udid: row.udid,
    note: row.note,
    status: row.status,
    appleDeviceId: row.appleDeviceId,
    decidedAt: iso(row.decidedAt),
    registeredAt: iso(row.registeredAt),
    installableAt: iso(row.installableAt),
    notifiedAt: iso(row.notifiedAt),
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A UDID is requested once. Re-submitting it edits a request still waiting
 * for a decision; after one, the caller learns only the status.
 */
export async function submitDistributionRequest(input: {
  name: string;
  email: string;
  udid: string;
  note?: string;
}): Promise<{
  status: MacrosDistributionRequestStatus;
  created: boolean;
}> {
  const note = input.note || null;
  const [created] = await db
    .insert(distributionRequests)
    .values({ name: input.name, email: input.email, udid: input.udid, note })
    .onConflictDoNothing({ target: distributionRequests.udid })
    .returning({ status: distributionRequests.status });
  if (created) return { status: created.status, created: true };

  const [updated] = await db
    .update(distributionRequests)
    .set({ name: input.name, email: input.email, note, updatedAt: new Date() })
    .where(
      and(
        eq(distributionRequests.udid, input.udid),
        eq(distributionRequests.status, "pending"),
      ),
    )
    .returning({ status: distributionRequests.status });
  if (updated) return { status: updated.status, created: false };

  const [existing] = await db
    .select({ status: distributionRequests.status })
    .from(distributionRequests)
    .where(eq(distributionRequests.udid, input.udid))
    .limit(1);
  return { status: existing?.status ?? "pending", created: false };
}

export async function listDistributionRequests(): Promise<
  MacrosDistributionRequest[]
> {
  const rows = await db
    .select()
    .from(distributionRequests)
    .orderBy(desc(distributionRequests.createdAt));
  return rows.map(serializeDistributionRequest);
}

export async function decideDistributionRequest(
  id: string,
  action: "approve" | "decline",
): Promise<MacrosDistributionRequest | null> {
  const now = new Date();
  const [row] = await db
    .update(distributionRequests)
    .set({
      status: action === "approve" ? "approved" : "declined",
      decidedAt: now,
      updatedAt: now,
    })
    .where(eq(distributionRequests.id, id))
    .returning();
  return row ? serializeDistributionRequest(row) : null;
}

export async function listApprovedDevices(): Promise<
  MacrosDistributionApprovedDevice[]
> {
  return db
    .select({
      id: distributionRequests.id,
      udid: distributionRequests.udid,
      name: distributionRequests.name,
    })
    .from(distributionRequests)
    .where(eq(distributionRequests.status, "approved"))
    .orderBy(asc(distributionRequests.createdAt));
}

export async function recordRegistrations(
  items: MacrosDistributionRegistration[],
): Promise<number> {
  let updated = 0;
  for (const item of items) {
    const now = new Date();
    const changes =
      "appleDeviceId" in item
        ? {
            appleDeviceId: item.appleDeviceId,
            registeredAt: now,
            lastError: null,
            updatedAt: now,
          }
        : { lastError: item.error, updatedAt: now };
    const rows = await db
      .update(distributionRequests)
      .set(changes)
      .where(eq(distributionRequests.id, item.id))
      .returning({ id: distributionRequests.id });
    updated += rows.length;
  }
  return updated;
}

async function sendInstallEmail(to: string, name: string, version: string) {
  const email = createAuthEmail({
    actionLabel: "Install Macros",
    actionUrl: getPublicAppUrl("/ios/install"),
    body: `Hi ${name}, Macros ${version} is ready for your iPhone. Open this email on that iPhone and tap the button, then confirm the install. It only installs on the iPhone you registered.`,
    preheader: "Macros is ready to install on your iPhone.",
    title: "Macros is ready",
  });
  await sendEmail({ to, subject: "Macros is ready for your iPhone", ...email });
}

/**
 * Marks the UDIDs baked into the build just published as installable and
 * emails anyone who has not been told yet. A failed email leaves `notifiedAt`
 * empty, so the next publish tries again.
 */
export async function recordPublishedBuild(
  version: string,
  udids: string[],
): Promise<MacrosDistributionPublishedResponse> {
  if (udids.length === 0) return { installable: 0, notified: 0, failed: 0 };

  const now = new Date();
  const installable = await db
    .update(distributionRequests)
    .set({ installableAt: now, updatedAt: now })
    .where(
      and(
        inArray(distributionRequests.udid, udids),
        eq(distributionRequests.status, "approved"),
      ),
    )
    .returning({ id: distributionRequests.id });

  const pending = await db
    .select({
      id: distributionRequests.id,
      name: distributionRequests.name,
      email: distributionRequests.email,
    })
    .from(distributionRequests)
    .where(
      and(
        inArray(distributionRequests.udid, udids),
        eq(distributionRequests.status, "approved"),
        isNull(distributionRequests.notifiedAt),
      ),
    );

  let notified = 0;
  let failed = 0;
  for (const request of pending) {
    try {
      await sendInstallEmail(request.email, request.name, version);
      await db
        .update(distributionRequests)
        .set({ notifiedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(distributionRequests.id, request.id));
      notified += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await db
        .update(distributionRequests)
        .set({ lastError: `Install email: ${message}`, updatedAt: new Date() })
        .where(eq(distributionRequests.id, request.id));
    }
  }

  return { installable: installable.length, notified, failed };
}
