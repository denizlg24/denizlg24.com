import {
  type MacrosContribution,
  type MacrosContributionsQuery,
  type MacrosContributorDetail,
  type MacrosFoodReportReason,
  type MacrosModerationEvent,
  type MacrosModerationFood,
  type MacrosModerationOverview,
  type MacrosReportCase,
  type MacrosReportStatusFilter,
  macrosContributionsQuerySchema,
} from "@repo/schemas/macros";
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";

import { db } from "@/db/connection";
import {
  foodContributions,
  foodReports,
  foods,
  moderationEvents,
  session,
  user,
  userBlocks,
  userRestrictions,
} from "@/db/schema";
import {
  getNutritionFoodSummary,
  getNutritionModeration,
  setNutritionItemRemoved,
} from "@/lib/foods/source";
import { contributorRef } from "@/lib/moderation/alias";
import { AUTO_HIDE_ACTOR, AUTO_HIDE_REASON } from "@/lib/moderation/policy";
import { ModerationError } from "@/lib/moderation/service";

type Executor = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

async function logEvent(
  executor: Executor,
  event: {
    actor: string;
    action: string;
    subjectType: "food" | "contributor";
    subjectId: string;
    detail?: Record<string, unknown>;
  },
) {
  await executor.insert(moderationEvents).values({
    ...event,
    detail: event.detail ?? null,
  });
}

function toEvent(
  row: typeof moderationEvents.$inferSelect,
): MacrosModerationEvent {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    detail: row.detail ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The console shows what the catalogue serves today, falling back to Macros'
 * stored copy when the nutrition API cannot answer for an item.
 */
async function loadFoods(
  itemIds: readonly string[],
): Promise<Map<string, MacrosModerationFood>> {
  const unique = [...new Set(itemIds)];
  const [stored, contributions] = await Promise.all([
    unique.length
      ? db
          .select({
            externalItemId: foods.externalItemId,
            name: foods.name,
            brand: foods.brand,
            barcode: foods.barcode,
            iconKey: foods.iconKey,
          })
          .from(foods)
          .where(inArray(foods.externalItemId, unique))
      : [],
    unique.length
      ? db
          .select()
          .from(foodContributions)
          .where(inArray(foodContributions.externalItemId, unique))
      : [],
  ]);
  const storedById = new Map(stored.map((row) => [row.externalItemId, row]));
  const contributionById = new Map(
    contributions.map((row) => [row.externalItemId, row]),
  );

  const entries = await Promise.all(
    unique.map(async (itemId): Promise<[string, MacrosModerationFood]> => {
      const [summary, moderation] = await Promise.all([
        getNutritionFoodSummary(itemId).catch(() => null),
        getNutritionModeration(itemId).catch(() => null),
      ]);
      const local = storedById.get(itemId);
      const contribution = contributionById.get(itemId);
      return [
        itemId,
        {
          itemId,
          name:
            summary?.name ??
            local?.name ??
            contribution?.name ??
            "Unknown food",
          brand: summary?.brand ?? local?.brand ?? contribution?.brand ?? null,
          barcode:
            summary?.barcode ?? local?.barcode ?? contribution?.barcode ?? null,
          iconKey: summary?.iconKey ?? local?.iconKey ?? null,
          servingLabel: summary?.servingLabel ?? null,
          caloriesPerServing: summary?.caloriesPerServing ?? null,
          proteinPerServing: summary?.proteinPerServing ?? null,
          carbsPerServing: summary?.carbsPerServing ?? null,
          fatPerServing: summary?.fatPerServing ?? null,
          source: moderation?.source ?? null,
          removed: Boolean(moderation?.removedAt ?? contribution?.removedAt),
          removedReason:
            moderation?.removedReason ?? contribution?.removedReason ?? null,
          removedBy: contribution?.removedBy ?? null,
          removedAt:
            moderation?.removedAt ??
            contribution?.removedAt?.toISOString() ??
            null,
        },
      ];
    }),
  );
  return new Map(entries);
}

export async function getOverview(): Promise<MacrosModerationOverview> {
  const since7d = new Date(Date.now() - 7 * 86_400_000);
  const since30d = new Date(Date.now() - 30 * 86_400_000);

  const [
    [openStats],
    [contributionStats],
    [restricted],
    [blocks],
    daily,
    events,
  ] = await Promise.all([
    db
      .select({
        reports: count(),
        cases: sql<number>`count(distinct ${foodReports.externalItemId})::int`,
        oldest: sql<Date | null>`min(${foodReports.createdAt})`,
      })
      .from(foodReports)
      .where(eq(foodReports.status, "open")),
    db
      .select({
        total: count(),
        recent: sql<number>`count(*) filter (where ${foodContributions.createdAt} >= ${since7d})::int`,
        removed: sql<number>`count(*) filter (where ${foodContributions.removedAt} is not null)::int`,
        autoHidden: sql<number>`count(*) filter (where ${foodContributions.removedBy} = ${AUTO_HIDE_ACTOR})::int`,
      })
      .from(foodContributions),
    db
      .select({ value: count() })
      .from(userRestrictions)
      .where(
        or(
          isNotNull(userRestrictions.sharingSuspendedAt),
          isNotNull(userRestrictions.suspendedAt),
        ),
      ),
    db.select({ value: count() }).from(userBlocks),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${foodReports.createdAt}), 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(foodReports)
      .where(gte(foodReports.createdAt, since30d))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    db
      .select()
      .from(moderationEvents)
      .orderBy(desc(moderationEvents.createdAt))
      .limit(8),
  ]);

  const byDay = new Map(daily.map((row) => [row.day, row.count]));
  const reports30d = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(Date.now() - (29 - index) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return { day, count: byDay.get(day) ?? 0 };
  });

  const oldest = openStats?.oldest;
  return {
    openCases: openStats?.cases ?? 0,
    openReports: openStats?.reports ?? 0,
    autoHidden: contributionStats?.autoHidden ?? 0,
    oldestOpenReportAt: oldest ? new Date(oldest).toISOString() : null,
    contributions7d: contributionStats?.recent ?? 0,
    contributionsTotal: contributionStats?.total ?? 0,
    removedTotal: contributionStats?.removed ?? 0,
    restrictedContributors: restricted?.value ?? 0,
    blocks: blocks?.value ?? 0,
    reports30d,
    recentEvents: events.map(toEvent),
  };
}

function emptyReasonCounts(): Record<MacrosFoodReportReason, number> {
  return { offensive: 0, spam: 0, incorrect: 0, personal_info: 0, other: 0 };
}

async function buildCases(itemIds: string[]): Promise<MacrosReportCase[]> {
  if (itemIds.length === 0) return [];
  const [reports, contributions, foodsById] = await Promise.all([
    db
      .select({
        externalItemId: foodReports.externalItemId,
        reason: foodReports.reason,
        note: foodReports.note,
        status: foodReports.status,
        createdAt: foodReports.createdAt,
      })
      .from(foodReports)
      .where(inArray(foodReports.externalItemId, itemIds))
      .orderBy(desc(foodReports.createdAt)),
    db
      .select({
        externalItemId: foodContributions.externalItemId,
        userId: foodContributions.userId,
      })
      .from(foodContributions)
      .where(inArray(foodContributions.externalItemId, itemIds)),
    loadFoods(itemIds),
  ]);
  const contributorByItem = new Map(
    contributions.map((row) => [row.externalItemId, row.userId]),
  );

  return itemIds.flatMap((itemId) => {
    const rows = reports.filter((row) => row.externalItemId === itemId);
    const food = foodsById.get(itemId);
    if (rows.length === 0 || !food) return [];
    const byReason = emptyReasonCounts();
    for (const row of rows) byReason[row.reason] += 1;
    const open = rows.filter((row) => row.status === "open");
    const contributor = contributorByItem.get(itemId);
    const times = rows.map((row) => row.createdAt.getTime());
    return [
      {
        itemId,
        food,
        contributor: contributor ? contributorRef(contributor) : null,
        open: open.length > 0,
        total: rows.length,
        openCount: open.length,
        byReason,
        // Notes without reporters: what was said matters, not who said it.
        notes: rows.flatMap((row) =>
          row.note
            ? [
                {
                  reason: row.reason,
                  note: row.note,
                  createdAt: row.createdAt.toISOString(),
                },
              ]
            : [],
        ),
        firstReportedAt: new Date(Math.min(...times)).toISOString(),
        lastReportedAt: new Date(Math.max(...times)).toISOString(),
      },
    ];
  });
}

export async function listCases(
  status: MacrosReportStatusFilter,
): Promise<MacrosReportCase[]> {
  const hasOpen = sql<boolean>`bool_or(${foodReports.status} = 'open')`;
  const having =
    status === "open"
      ? hasOpen
      : status === "resolved"
        ? sql`not ${hasOpen}`
        : undefined;
  const grouped = await db
    .select({
      itemId: foodReports.externalItemId,
      last: sql<Date>`max(${foodReports.createdAt})`,
    })
    .from(foodReports)
    .groupBy(foodReports.externalItemId)
    .having(having)
    .orderBy(desc(sql`max(${foodReports.createdAt})`))
    .limit(100);
  return buildCases(grouped.map((row) => row.itemId));
}

export async function getCase(itemId: string) {
  const [found] = await buildCases([itemId]);
  return found ?? null;
}

export async function setFoodRemoved(
  actor: string,
  itemId: string,
  removed: boolean,
  reason: string | null,
) {
  await setNutritionItemRemoved(itemId, removed, reason);
  await db.transaction(async (tx) => {
    await tx
      .update(foodContributions)
      .set({
        removedAt: removed ? new Date() : null,
        removedReason: removed ? reason : null,
        removedBy: removed ? actor : null,
        updatedAt: new Date(),
      })
      .where(eq(foodContributions.externalItemId, itemId));
    if (removed) {
      await tx
        .update(foodReports)
        .set({
          status: "actioned",
          resolvedAt: new Date(),
          resolvedBy: actor,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(foodReports.externalItemId, itemId),
            eq(foodReports.status, "open"),
          ),
        );
    }
    await logEvent(tx, {
      actor,
      action: removed ? "food.removed" : "food.restored",
      subjectType: "food",
      subjectId: itemId,
      detail: reason ? { reason } : undefined,
    });
  });
}

export async function resolveCase(
  actor: string,
  itemId: string,
  action: "dismiss" | "remove",
  reason: string | null,
) {
  const openReports = await db
    .select({ id: foodReports.id })
    .from(foodReports)
    .where(
      and(
        eq(foodReports.externalItemId, itemId),
        eq(foodReports.status, "open"),
      ),
    );
  if (openReports.length === 0) {
    throw new ModerationError("No open reports for this food", 409);
  }

  if (action === "remove") {
    await setFoodRemoved(actor, itemId, true, reason);
    return;
  }

  // Dismissing reports that auto-hid a food puts it back: the hide was only
  // ever a hold pending this decision.
  const contribution = await db.query.foodContributions.findFirst({
    where: eq(foodContributions.externalItemId, itemId),
    columns: { removedBy: true },
  });
  const moderation = await getNutritionModeration(itemId);
  const autoHidden =
    contribution?.removedBy === AUTO_HIDE_ACTOR ||
    (!contribution &&
      Boolean(moderation?.removedAt) &&
      moderation?.removedReason === AUTO_HIDE_REASON);
  if (autoHidden) await setFoodRemoved(actor, itemId, false, null);

  await db.transaction(async (tx) => {
    await tx
      .update(foodReports)
      .set({
        status: "dismissed",
        resolvedAt: new Date(),
        resolvedBy: actor,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(foodReports.externalItemId, itemId),
          eq(foodReports.status, "open"),
        ),
      );
    await logEvent(tx, {
      actor,
      action: "reports.dismissed",
      subjectType: "food",
      subjectId: itemId,
      detail: { reports: openReports.length, ...(reason ? { reason } : {}) },
    });
  });
}

function toContribution(
  row: typeof foodContributions.$inferSelect & { reportCount: number },
): MacrosContribution {
  return {
    itemId: row.externalItemId,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    contributor: contributorRef(row.userId),
    createdAt: row.createdAt.toISOString(),
    removed: Boolean(row.removedAt),
    removedReason: row.removedReason,
    removedBy: row.removedBy,
    reportCount: row.reportCount,
  };
}

const reportCountSql = sql<number>`(
  select count(*)::int from ${foodReports}
  where ${foodReports.externalItemId} = ${foodContributions.externalItemId}
)`;

export async function listContributions(input: MacrosContributionsQuery) {
  const query = macrosContributionsQuerySchema.parse(input);
  const clauses: SQL[] = [];
  if (query.status === "visible")
    clauses.push(isNull(foodContributions.removedAt));
  if (query.status === "removed")
    clauses.push(isNotNull(foodContributions.removedAt));
  if (query.contributor)
    clauses.push(eq(foodContributions.userId, query.contributor));
  if (query.q) {
    const pattern = `%${query.q}%`;
    const match = or(
      ilike(foodContributions.name, pattern),
      ilike(foodContributions.brand, pattern),
      ilike(foodContributions.barcode, pattern),
    );
    if (match) clauses.push(match);
  }
  if (query.cursor) {
    const cursor = new Date(query.cursor);
    if (!Number.isNaN(cursor.getTime())) {
      clauses.push(lt(foodContributions.createdAt, cursor));
    }
  }

  const rows = await db
    .select({
      ...foodContributionColumns(),
      reportCount: reportCountSql,
    })
    .from(foodContributions)
    .where(clauses.length ? and(...clauses) : undefined)
    .orderBy(desc(foodContributions.createdAt))
    .limit(query.limit + 1);

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    contributions: page.map(toContribution),
    nextCursor:
      rows.length > query.limit && last ? last.createdAt.toISOString() : null,
  };
}

function foodContributionColumns() {
  return {
    id: foodContributions.id,
    userId: foodContributions.userId,
    externalItemId: foodContributions.externalItemId,
    barcode: foodContributions.barcode,
    name: foodContributions.name,
    brand: foodContributions.brand,
    removedAt: foodContributions.removedAt,
    removedReason: foodContributions.removedReason,
    removedBy: foodContributions.removedBy,
    createdAt: foodContributions.createdAt,
    updatedAt: foodContributions.updatedAt,
  };
}

export async function getContributor(
  userId: string,
): Promise<MacrosContributorDetail | null> {
  const account = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { id: true, createdAt: true },
  });
  if (!account) return null;

  const [
    [contributionStats],
    [against],
    [filed],
    [blockedBy],
    restriction,
    recent,
  ] = await Promise.all([
    db
      .select({
        total: count(),
        removed: sql<number>`count(*) filter (where ${foodContributions.removedAt} is not null)::int`,
      })
      .from(foodContributions)
      .where(eq(foodContributions.userId, userId)),
    db
      .select({ value: count() })
      .from(foodReports)
      .where(
        inArray(
          foodReports.externalItemId,
          db
            .select({ id: foodContributions.externalItemId })
            .from(foodContributions)
            .where(eq(foodContributions.userId, userId)),
        ),
      ),
    db
      .select({ value: count() })
      .from(foodReports)
      .where(eq(foodReports.reporterUserId, userId)),
    db
      .select({ value: count() })
      .from(userBlocks)
      .where(eq(userBlocks.blockedUserId, userId)),
    db.query.userRestrictions.findFirst({
      where: eq(userRestrictions.userId, userId),
    }),
    db
      .select({ ...foodContributionColumns(), reportCount: reportCountSql })
      .from(foodContributions)
      .where(eq(foodContributions.userId, userId))
      .orderBy(desc(foodContributions.createdAt))
      .limit(20),
  ]);

  return {
    contributor: contributorRef(userId),
    joinedAt: account.createdAt.toISOString(),
    contributions: contributionStats?.total ?? 0,
    removedContributions: contributionStats?.removed ?? 0,
    reportsAgainst: against?.value ?? 0,
    reportsFiled: filed?.value ?? 0,
    blockedBy: blockedBy?.value ?? 0,
    restriction: {
      sharingSuspended: Boolean(restriction?.sharingSuspendedAt),
      suspended: Boolean(restriction?.suspendedAt),
      reason: restriction?.reason ?? null,
      updatedAt: restriction?.updatedAt.toISOString() ?? null,
    },
    recent: recent.map(toContribution),
  };
}

export async function setRestriction(
  actor: string,
  userId: string,
  input: {
    sharingSuspended: boolean;
    suspended: boolean;
    reason?: string;
    removeContributions: boolean;
  },
) {
  const account = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { id: true },
  });
  if (!account) throw new ModerationError("Contributor not found", 404);

  const now = new Date();
  const current = await db.query.userRestrictions.findFirst({
    where: eq(userRestrictions.userId, userId),
  });
  const values = {
    sharingSuspendedAt: input.sharingSuspended
      ? (current?.sharingSuspendedAt ?? now)
      : null,
    suspendedAt: input.suspended ? (current?.suspendedAt ?? now) : null,
    reason: input.reason?.trim() || null,
    updatedAt: now,
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(userRestrictions)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: userRestrictions.userId, set: values });
    if (input.suspended) {
      await tx.delete(session).where(eq(session.userId, userId));
    }
    await logEvent(tx, {
      actor,
      action: "contributor.restricted",
      subjectType: "contributor",
      subjectId: userId,
      detail: {
        sharingSuspended: input.sharingSuspended,
        suspended: input.suspended,
        ...(values.reason ? { reason: values.reason } : {}),
      },
    });
  });

  if (input.removeContributions) {
    const visible = await db
      .select({ id: foodContributions.externalItemId })
      .from(foodContributions)
      .where(
        and(
          eq(foodContributions.userId, userId),
          isNull(foodContributions.removedAt),
        ),
      );
    for (const row of visible) {
      await setFoodRemoved(
        actor,
        row.id,
        true,
        values.reason ?? "Contributor restricted",
      );
    }
  }
}

/** Audited: the only route that turns a pseudonym back into a person. */
export async function revealContact(actor: string, userId: string) {
  const account = await db.query.user.findFirst({
    where: eq(user.id, userId),
    columns: { email: true },
  });
  if (!account) throw new ModerationError("Contributor not found", 404);
  await logEvent(db, {
    actor,
    action: "contributor.contact_revealed",
    subjectType: "contributor",
    subjectId: userId,
  });
  return account.email;
}

export async function listEvents(input: {
  subjectId?: string;
  limit: number;
}): Promise<MacrosModerationEvent[]> {
  const rows = await db
    .select()
    .from(moderationEvents)
    .where(
      input.subjectId
        ? eq(moderationEvents.subjectId, input.subjectId)
        : undefined,
    )
    .orderBy(desc(moderationEvents.createdAt))
    .limit(input.limit);
  return rows.map(toEvent);
}
