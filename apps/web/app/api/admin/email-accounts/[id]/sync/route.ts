import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { getAdminSession } from "@/lib/require-admin";
import { syncInbox } from "@/lib/sync-email";
import { EmailAccountModel } from "@/models/EmailAccount";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getAdminSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    await connectDB();

    const account = await EmailAccountModel.findById(id).lean();
    if (!account) {
      return NextResponse.json(
        { error: "Email account not found" },
        { status: 404 },
      );
    }

    const lastUid = await syncInbox(account);

    await EmailAccountModel.findByIdAndUpdate(account._id, {
      lastUid,
    });

    return NextResponse.json(
      {
        message: `Synced ${account.user} successfully`,
        lastUid,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error syncing account:", error);
    return NextResponse.json(
      { error: "Failed to sync account" },
      { status: 500 },
    );
  }
}
