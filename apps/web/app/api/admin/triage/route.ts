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

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return Math.min(Math.max(1, Math.trunc(parsed)), 200);
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

  const triages = await EmailTriageModel.find(query)
    .sort({ triagedAt: -1 })
    .limit(limit)
    .lean();

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
    nextCursor: items.at(-1)?.triagedAt.toISOString() ?? null,
  });
}
