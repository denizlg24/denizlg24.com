import { connectDB } from "@/lib/mongodb";
import { syncInbox } from "@/lib/sync-email";
import { EmailAccountModel } from "@/models/EmailAccount";

export async function GET(request: Request) {
  try {
    if (
      request.headers.get("Authorization") !==
      `Bearer ${process.env.EMAIL_JOB_BEARER_TOKEN}`
    ) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    await connectDB();
    const accounts = await EmailAccountModel.find().lean();

    let syncedCount = 0;
    let failedCount = 0;

    for (const account of accounts) {
      try {
        const lastUid = await syncInbox(account);
        await EmailAccountModel.findByIdAndUpdate(account._id, {
          lastUid,
        });
        syncedCount++;
      } catch (error) {
        console.error(`Error syncing account ${account.user}:`, error);
        failedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        message: `Cron job completed: ${syncedCount} accounts synced, ${failedCount} failed`,
        syncedCount,
        failedCount,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.log("Error in email sync cron job:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
