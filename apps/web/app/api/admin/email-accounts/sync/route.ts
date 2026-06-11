import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { getAdminSession } from "@/lib/require-admin";
import { syncInbox } from "@/lib/sync-email";
import { EmailAccountModel } from "@/models/EmailAccount";

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();

    const accounts = await EmailAccountModel.find().lean();

    if (accounts.length === 0) {
      return NextResponse.json(
        { message: "No email accounts to sync", syncedCount: 0 },
        { status: 200 },
      );
    }

    let syncedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const account of accounts) {
      try {
        console.log(`Syncing account: ${account.user}`);
        const lastUid = await syncInbox(account);

        await EmailAccountModel.findByIdAndUpdate(account._id, {
          lastUid,
        });

        syncedCount++;
        console.log(`Successfully synced ${account.user}, lastUid: ${lastUid}`);
      } catch (error) {
        failedCount++;
        const errorMsg = `Failed to sync ${account.user}: ${error instanceof Error ? error.message : "Unknown error"}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    return NextResponse.json(
      {
        message: `Sync completed: ${syncedCount} succeeded, ${failedCount} failed`,
        syncedCount,
        failedCount,
        errors: errors.length > 0 ? errors : undefined,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error in email sync:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
