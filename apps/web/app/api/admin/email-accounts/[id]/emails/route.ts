import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { EmailModel } from "@/models/Email";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(
      100,
      Math.max(1, Number(searchParams.get("limit") ?? 50)),
    );
    const search = searchParams.get("search")?.trim() ?? "";

    await connectDB();

    const filter: Record<string, unknown> = { accountId: id };

    if (search) {
      const regex = { $regex: search, $options: "i" };
      filter.$or = [
        { subject: regex },
        { "from.address": regex },
        { "from.name": regex },
      ];
    }

    const [emails, total] = await Promise.all([
      EmailModel.find(filter)
        .sort({ date: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      EmailModel.countDocuments(filter),
    ]);

    return NextResponse.json(
      {
        emails: emails.map((email) => ({
          ...email,
          _id: email._id.toString(),
          accountId: String(email.accountId),
        })),
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching emails:", error);
    return NextResponse.json(
      { error: "Failed to fetch emails" },
      { status: 500 },
    );
  }
}
