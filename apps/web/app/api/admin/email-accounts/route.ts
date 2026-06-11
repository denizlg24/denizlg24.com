import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { createImapClient } from "@/lib/email";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { encryptPassword } from "@/lib/safe-email-password";
import { EmailAccountModel } from "@/models/EmailAccount";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    const accounts = await EmailAccountModel.find()
      .select("-imapPassword")
      .lean()
      .exec();

    return NextResponse.json(
      {
        accounts: accounts.map((account) => ({
          ...account,
          _id: account._id.toString(),
        })),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error fetching email accounts:", error);
    return NextResponse.json(
      { error: "Failed to fetch email accounts" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { host, port, secure, user, password, inboxName } = body;

    if (!host || !port || !user || !password) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    try {
      const client = await createImapClient({
        host,
        port: Number(port),
        secure: Boolean(secure),
        user,
        pass: password,
      });

      await client.mailboxOpen(inboxName || "INBOX");
      await client.logout();
    } catch (connectionError) {
      console.error("IMAP connection test failed:", connectionError);
      return NextResponse.json(
        {
          error:
            "Failed to connect to email server. Please check your credentials.",
        },
        { status: 400 },
      );
    }

    const encryptedPassword = encryptPassword(password);

    await connectDB();

    const existingAccount = await EmailAccountModel.findOne({ user, host });
    if (existingAccount) {
      return NextResponse.json(
        { error: "An account with this email and host already exists" },
        { status: 400 },
      );
    }

    const account = await EmailAccountModel.create({
      host,
      port: Number(port),
      secure: Boolean(secure),
      user,
      imapPassword: encryptedPassword,
      inboxName: inboxName || "INBOX",
      lastUid: 0,
    });

    revalidatePath("/admin/dashboard/inbox");

    return NextResponse.json(
      {
        message: "Email account added successfully",
        account: {
          _id: account._id.toString(),
          host: account.host,
          port: account.port,
          secure: account.secure,
          user: account.user,
          inboxName: account.inboxName,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating email account:", error);
    return NextResponse.json(
      { error: "Failed to create email account" },
      { status: 500 },
    );
  }
}
