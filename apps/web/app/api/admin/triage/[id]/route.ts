import { type NextRequest, NextResponse } from "next/server";
import { observeDomainRecordSafely } from "@/lib/agent-memory/domain-evidence";
import { fetchEmailBody } from "@/lib/email";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { EmailModel } from "@/models/Email";
import { EmailTriageModel } from "@/models/EmailTriage";

const TRIAGE_USER_STATUSES = ["pending", "reviewed", "archived"] as const;
const TRIAGE_CATEGORIES = [
  "spam",
  "newsletter",
  "promo",
  "purchases",
  "fyi",
  "action-needed",
  "scheduled",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTriageUserStatus(
  value: unknown,
): value is (typeof TRIAGE_USER_STATUSES)[number] {
  return (
    typeof value === "string" &&
    TRIAGE_USER_STATUSES.some((status) => status === value)
  );
}

function isTriageCategory(
  value: unknown,
): value is (typeof TRIAGE_CATEGORIES)[number] {
  return (
    typeof value === "string" &&
    TRIAGE_CATEGORIES.some((category) => category === value)
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();
  const { id } = await params;

  const triage = await EmailTriageModel.findById(id).lean();
  if (!triage) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const email = await EmailModel.findById(triage.emailId).lean();
  if (!email) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  let body: { text: string; html: string } | null = null;
  try {
    const fetched = await fetchEmailBody(String(email.accountId), email.uid);
    if (fetched) body = { text: fetched.text, html: fetched.html };
  } catch (err) {
    console.error("body fetch failed:", err);
  }

  return NextResponse.json({
    triage: {
      ...triage,
      _id: triage._id.toString(),
      emailId: triage.emailId.toString(),
      accountId: triage.accountId.toString(),
      reviewRequired: triage.reviewRequired === true,
      attachmentTextUsed: triage.attachmentTextUsed === true,
      attachmentTextSources: Array.isArray(triage.attachmentTextSources)
        ? triage.attachmentTextSources
        : [],
      suggestedTasks: (triage.suggestedTasks ?? []).map((s) => ({
        ...s,
        _id: String(s._id),
        kanbanBoardId: s.kanbanBoardId ? s.kanbanBoardId.toString() : undefined,
        kanbanColumnId: s.kanbanColumnId
          ? s.kanbanColumnId.toString()
          : undefined,
        acceptedCardId: s.acceptedCardId
          ? s.acceptedCardId.toString()
          : undefined,
        acceptedAssignmentId: s.acceptedAssignmentId
          ? s.acceptedAssignmentId.toString()
          : undefined,
      })),
      suggestedEvents: (triage.suggestedEvents ?? []).map((s) => ({
        ...s,
        _id: String(s._id),
        acceptedEventId: s.acceptedEventId
          ? s.acceptedEventId.toString()
          : undefined,
      })),
    },
    email: {
      _id: email._id.toString(),
      accountId: String(email.accountId),
      subject: email.subject,
      from: email.from,
      date: email.date,
      threadId: email.threadId,
      body,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const payload = isRecord(body) ? body : {};

  const update: Record<string, unknown> = {};
  if (isTriageUserStatus(payload.userStatus)) {
    update.userStatus = payload.userStatus;
  }
  if (payload.userStatus === "reviewed") {
    update.reviewRequired = false;
  }

  if (isTriageCategory(payload.category)) {
    const current = await EmailTriageModel.findById(id)
      .select("category llmCategory")
      .lean();
    if (!current) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (payload.category !== current.category) {
      update.category = payload.category;
      // Snapshot the pre-correction label once, so dataset building can still
      // tell what triage originally answered. Re-corrections keep the first one.
      if (!current.llmCategory) {
        update.llmCategory = current.category;
      }
      // A category override is a human verdict whether or not the caller said so.
      update.userStatus = update.userStatus ?? "reviewed";
      update.reviewRequired = false;
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const clearsReviewReason =
    payload.userStatus === "reviewed" || update.reviewRequired === false;

  const triage = await EmailTriageModel.findByIdAndUpdate(
    id,
    {
      $set: update,
      ...(clearsReviewReason ? { $unset: { reviewReason: 1 } } : {}),
    },
    {
      returnDocument: "after",
    },
  ).lean();
  if (!triage) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await observeDomainRecordSafely("email-triage", triage);
  return NextResponse.json({ ok: true });
}
