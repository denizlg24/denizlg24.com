import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { EmailModel } from "@/models/Email";
import { EmailTriageModel } from "@/models/EmailTriage";

const TRIAGE_CATEGORIES = [
  "spam",
  "newsletter",
  "promo",
  "purchases",
  "fyi",
  "action-needed",
  "scheduled",
] as const;

const TRIAGE_USER_STATUSES = [
  "open",
  "pending",
  "reviewed",
  "archived",
] as const;

function isTriageCategory(
  value: string | null,
): value is (typeof TRIAGE_CATEGORIES)[number] {
  return (
    value !== null && TRIAGE_CATEGORIES.some((category) => category === value)
  );
}

function isTriageUserStatus(
  value: string | null,
): value is (typeof TRIAGE_USER_STATUSES)[number] {
  return (
    value !== null && TRIAGE_USER_STATUSES.some((status) => status === value)
  );
}

const DEFAULT_TRIAGE_LIMIT = 30;
const MAX_TRIAGE_LIMIT = 300;

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? DEFAULT_TRIAGE_LIMIT);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TRIAGE_LIMIT;
  }

  return Math.min(Math.max(1, Math.trunc(parsed)), MAX_TRIAGE_LIMIT);
}

function parseOffset(value: string | null): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.trunc(parsed));
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const status = searchParams.get("status");
  const cursor = searchParams.get("cursor");
  const limit = parseLimit(searchParams.get("limit"));
  const offset = parseOffset(searchParams.get("offset"));

  const query: Record<string, unknown> = {};
  if (category !== "all" && isTriageCategory(category))
    query.category = category;
  if (status === "open") {
    query.userStatus = { $ne: "archived" };
  } else if (status !== "all" && isTriageUserStatus(status)) {
    query.userStatus = status;
  }
  if (cursor) {
    const d = new Date(cursor);
    if (!Number.isNaN(d.getTime())) query.triagedAt = { $lt: d };
  }

  const [triages, totalRows] = await Promise.all([
    EmailTriageModel.find(query)
      .sort({ triagedAt: -1, _id: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    EmailTriageModel.countDocuments(query),
  ]);

  const emailIds = triages.map((t) => t.emailId);
  const emails = await EmailModel.find({ _id: { $in: emailIds } })
    .select("subject from date threadId")
    .lean();
  const emailMap = new Map(emails.map((e) => [e._id.toString(), e]));

  const items = triages.map((t) => {
    const e = emailMap.get(t.emailId.toString());
    return {
      _id: t._id.toString(),
      emailId: t.emailId.toString(),
      accountId: t.accountId.toString(),
      stage: t.stage,
      category: t.category,
      confidence: t.confidence,
      summary: t.summary,
      suggestedTasks: (t.suggestedTasks ?? []).map((s) => ({
        ...s,
        _id: String(s._id),
        kanbanBoardId: s.kanbanBoardId ? s.kanbanBoardId.toString() : undefined,
        kanbanColumnId: s.kanbanColumnId
          ? s.kanbanColumnId.toString()
          : undefined,
        acceptedCardId: s.acceptedCardId
          ? s.acceptedCardId.toString()
          : undefined,
      })),
      suggestedEvents: (t.suggestedEvents ?? []).map((s) => ({
        ...s,
        _id: String(s._id),
        acceptedEventId: s.acceptedEventId
          ? s.acceptedEventId.toString()
          : undefined,
      })),
      userStatus: t.userStatus,
      modelUsed: t.modelUsed,
      triagedAt: t.triagedAt,
      email: e
        ? {
            subject: e.subject,
            from: e.from,
            date: e.date,
            threadId: e.threadId,
          }
        : null,
    };
  });

  return NextResponse.json({
    items,
    totalRows,
    offset,
    limit,
    nextCursor: items.at(-1)?.triagedAt.toISOString() ?? null,
    nextOffset:
      offset + items.length < totalRows ? offset + items.length : null,
  });
}
