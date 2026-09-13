import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { EmailModel } from "@/models/Email";

const MAX_LIMIT = 100;

/** Newest stored mail across every account; the per-account list is under email-accounts. */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const search = request.nextUrl.searchParams;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(search.get("limit") ?? 20) || 20),
  );
  const unreadOnly = search.get("unreadOnly") === "true";

  try {
    await connectDB();
    const emails = await EmailModel.find(unreadOnly ? { seen: false } : {})
      .sort({ date: -1 })
      .limit(limit)
      .lean();
    return NextResponse.json({
      emails: emails.map((email) => ({
        _id: email._id.toString(),
        accountId: email.accountId.toString(),
        subject: email.subject,
        from: email.from,
        date: email.date,
        seen: email.seen,
      })),
    });
  } catch (error) {
    console.error("Error listing emails:", error);
    return NextResponse.json(
      { error: "Failed to list emails" },
      { status: 500 },
    );
  }
}
