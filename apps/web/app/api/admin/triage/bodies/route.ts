import { type NextRequest, NextResponse } from "next/server";
import { warmEmailBodies } from "@/lib/email-body-store";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { EmailModel } from "@/models/Email";
import { EmailTriageModel } from "@/models/EmailTriage";

/** One page of the triage list, plus headroom. Bounds the IMAP fetch. */
const MAX_WARM = 60;

/**
 * Pre-stores the bodies for a set of triage rows.
 *
 * The list view calls this for the page it just rendered, so opening any row on
 * that page is a Mongo read. Rows whose body is already stored cost one indexed
 * query and no IMAP traffic, which is the steady state once triage has been
 * saving bodies for a while.
 */
export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();
  const payload = await request.json().catch(() => null);
  const ids: unknown = (payload as { triageIds?: unknown } | null)?.triageIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json(
      { error: "triageIds is required" },
      { status: 400 },
    );
  }
  const triageIds = ids
    .filter((id): id is string => typeof id === "string")
    .slice(0, MAX_WARM);
  if (triageIds.length === 0) {
    return NextResponse.json(
      { error: "triageIds is required" },
      { status: 400 },
    );
  }

  const triages = await EmailTriageModel.find({ _id: { $in: triageIds } })
    .select("emailId")
    .lean();
  const emails = await EmailModel.find({
    _id: { $in: triages.map((triage) => triage.emailId) },
  })
    .select("accountId uid")
    .lean();

  const result = await warmEmailBodies(
    emails.map((email) => ({
      accountId: String(email.accountId),
      emailId: String(email._id),
      uid: email.uid,
    })),
  );
  return NextResponse.json({ ok: true, ...result });
}
