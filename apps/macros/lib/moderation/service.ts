import { screenSharedFoodText } from "@repo/macros-core/content-filter";
import type {
  MacrosBlockedContributor,
  MacrosFoodSharing,
  MacrosReportFoodBody,
  MacrosSharingWithheld,
} from "@repo/schemas/macros";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";

import { db } from "@/db/connection";
import {
  foodContributions,
  foodReports,
  foods,
  moderationEvents,
  userBlocks,
  userRestrictions,
} from "@/db/schema";
import { setNutritionItemRemoved } from "@/lib/foods/source";
import { notifyNewReport } from "@/lib/moderation/notify";
import {
  AUTO_HIDE_ACTOR,
  AUTO_HIDE_REASON,
  shouldAutoHide,
} from "@/lib/moderation/policy";

export class ModerationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function getRestriction(userId: string) {
  return db.query.userRestrictions.findFirst({
    where: eq(userRestrictions.userId, userId),
  });
}

export async function isSuspended(userId: string): Promise<boolean> {
  const restriction = await getRestriction(userId);
  return Boolean(restriction?.suspendedAt);
}

/** Null means the food may join the shared catalogue. */
export async function sharingWithheldFor(
  userId: string,
  name: string,
  brand: string | null | undefined,
): Promise<MacrosSharingWithheld> {
  const restriction = await getRestriction(userId);
  if (restriction?.sharingSuspendedAt || restriction?.suspendedAt) {
    return "suspended";
  }
  return screenSharedFoodText(name, brand).ok ? null : "filtered";
}

export async function recordContribution(
  userId: string,
  item: { id: string; barcode: string; name: string; brand: string | null },
) {
  await db
    .insert(foodContributions)
    .values({
      userId,
      externalItemId: item.id,
      barcode: item.barcode,
      name: item.name,
      brand: item.brand,
    })
    .onConflictDoNothing({ target: foodContributions.externalItemId });
}

/**
 * Catalogue items this person must not be shown: everything from a
 * contributor they hid, anything they reported, and anything taken down (the
 * nutrition API drops those itself, but its search cache can lag).
 */
export async function hiddenItemIdsFor(userId: string): Promise<Set<string>> {
  const [contributed, reported] = await Promise.all([
    db
      .select({ id: foodContributions.externalItemId })
      .from(foodContributions)
      .where(
        or(
          isNotNull(foodContributions.removedAt),
          inArray(
            foodContributions.userId,
            db
              .select({ id: userBlocks.blockedUserId })
              .from(userBlocks)
              .where(eq(userBlocks.userId, userId)),
          ),
        ),
      ),
    db
      .select({ id: foodReports.externalItemId })
      .from(foodReports)
      .where(eq(foodReports.reporterUserId, userId)),
  ]);
  return new Set([...contributed, ...reported].map((row) => row.id));
}

async function isLocalCustomFood(itemId: string) {
  const row = await db.query.foods.findFirst({
    where: and(eq(foods.id, itemId), eq(foods.source, "custom")),
    columns: { id: true },
  });
  return Boolean(row);
}

export async function getFoodSharing(
  userId: string,
  itemId: string,
): Promise<MacrosFoodSharing> {
  if (await isLocalCustomFood(itemId)) {
    return {
      shared: false,
      ownContribution: false,
      contributed: false,
      reported: false,
      contributorHidden: false,
    };
  }

  const [contribution, report] = await Promise.all([
    db.query.foodContributions.findFirst({
      where: eq(foodContributions.externalItemId, itemId),
      columns: { userId: true },
    }),
    db.query.foodReports.findFirst({
      where: and(
        eq(foodReports.externalItemId, itemId),
        eq(foodReports.reporterUserId, userId),
      ),
      columns: { id: true },
    }),
  ]);
  const own = contribution?.userId === userId;
  const blocked =
    contribution && !own
      ? await db.query.userBlocks.findFirst({
          where: and(
            eq(userBlocks.userId, userId),
            eq(userBlocks.blockedUserId, contribution.userId),
          ),
          columns: { id: true },
        })
      : undefined;

  return {
    shared: true,
    ownContribution: own,
    contributed: Boolean(contribution) && !own,
    reported: Boolean(report),
    contributorHidden: Boolean(blocked),
  };
}

export async function reportFood(
  userId: string,
  itemId: string,
  input: MacrosReportFoodBody,
) {
  if (await isLocalCustomFood(itemId)) {
    throw new ModerationError("Only shared foods can be reported", 400);
  }
  const contribution = await db.query.foodContributions.findFirst({
    where: eq(foodContributions.externalItemId, itemId),
    columns: { userId: true },
  });
  if (contribution?.userId === userId) {
    throw new ModerationError("You added this food", 400);
  }

  const note = input.note?.trim() || null;
  const existingOpen = await db.query.foodReports.findFirst({
    where: and(
      eq(foodReports.externalItemId, itemId),
      eq(foodReports.status, "open"),
    ),
    columns: { id: true },
  });

  const [report] = await db
    .insert(foodReports)
    .values({ reporterUserId: userId, externalItemId: itemId, ...input, note })
    .onConflictDoUpdate({
      target: [foodReports.reporterUserId, foodReports.externalItemId],
      set: {
        reason: input.reason,
        note,
        status: "open",
        resolvedAt: null,
        resolvedBy: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!report) throw new ModerationError("Report was not saved", 500);

  const openReports = await db
    .select({ reason: foodReports.reason })
    .from(foodReports)
    .where(
      and(
        eq(foodReports.externalItemId, itemId),
        eq(foodReports.status, "open"),
      ),
    );

  let hidden = false;
  if (shouldAutoHide(openReports)) {
    hidden = await autoHide(itemId);
  }

  if (!existingOpen || hidden) {
    await notifyNewReport({
      itemId,
      reason: input.reason,
      openReports: openReports.length,
      hidden,
    }).catch((error: unknown) => {
      console.error("[moderation] report notification failed", error);
    });
  }

  return { report, hidden };
}

async function autoHide(itemId: string): Promise<boolean> {
  const contribution = await db.query.foodContributions.findFirst({
    where: eq(foodContributions.externalItemId, itemId),
    columns: { removedAt: true },
  });
  if (contribution?.removedAt) return false;

  const reason = AUTO_HIDE_REASON;
  await setNutritionItemRemoved(itemId, true, reason);
  await db.transaction(async (tx) => {
    await tx
      .update(foodContributions)
      .set({
        removedAt: new Date(),
        removedReason: reason,
        removedBy: AUTO_HIDE_ACTOR,
        updatedAt: new Date(),
      })
      .where(eq(foodContributions.externalItemId, itemId));
    await tx.insert(moderationEvents).values({
      actor: AUTO_HIDE_ACTOR,
      action: "food.removed",
      subjectType: "food",
      subjectId: itemId,
      detail: { reason },
    });
  });
  return true;
}

export async function blockContributor(
  userId: string,
  itemId: string,
  label: string,
) {
  const contribution = await db.query.foodContributions.findFirst({
    where: eq(foodContributions.externalItemId, itemId),
    columns: { userId: true },
  });
  if (!contribution) {
    throw new ModerationError("No contributor is known for this food", 404);
  }
  if (contribution.userId === userId) {
    throw new ModerationError("You added this food", 400);
  }

  const [block] = await db
    .insert(userBlocks)
    .values({
      userId,
      blockedUserId: contribution.userId,
      viaItemId: itemId,
      viaLabel: label,
    })
    .onConflictDoUpdate({
      target: [userBlocks.userId, userBlocks.blockedUserId],
      set: { viaItemId: itemId, viaLabel: label },
    })
    .returning();
  if (!block) throw new ModerationError("Block was not saved", 500);
  return block;
}

export async function listBlocks(
  userId: string,
): Promise<MacrosBlockedContributor[]> {
  const rows = await db
    .select({
      id: userBlocks.id,
      label: userBlocks.viaLabel,
      createdAt: userBlocks.createdAt,
    })
    .from(userBlocks)
    .where(eq(userBlocks.userId, userId))
    .orderBy(desc(userBlocks.createdAt));
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function unblock(userId: string, blockId: string) {
  const deleted = await db
    .delete(userBlocks)
    .where(and(eq(userBlocks.id, blockId), eq(userBlocks.userId, userId)))
    .returning({ id: userBlocks.id });
  return deleted.length > 0;
}
