import { type NextRequest, NextResponse } from "next/server";
import { fetchEmailBody } from "@/lib/email";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { EmailModel } from "@/models/Email";
import { EmailTriageModel } from "@/models/EmailTriage";

const TRIAGE_USER_STATUSES = ["pending", "reviewed", "archived"] as const;

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
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const triage = await EmailTriageModel.findByIdAndUpdate(id, update, {
    new: true,
  }).lean();
  if (!triage) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
