import { simpleParser } from "mailparser";
import { type NextRequest, NextResponse } from "next/server";
import { createImapClient } from "@/lib/email";
import { connectDB } from "@/lib/mongodb";
import { getAdminSession } from "@/lib/require-admin";
import { decryptPassword } from "@/lib/safe-email-password";
import { EmailModel } from "@/models/Email";
import { EmailAccountModel } from "@/models/EmailAccount";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; emailId: string }> },
) {
  try {
    const session = await getAdminSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await connectDB();
    const { id, emailId } = await params;

    const email = await EmailModel.findById(emailId).lean();
    if (!email) {
      return NextResponse.json({ error: "Email not found" }, { status: 404 });
    }

    const account = await EmailAccountModel.findById(id).lean();
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const password = decryptPassword(
      account.imapPassword.ciphertext,
      account.imapPassword.iv,
      account.imapPassword.authTag,
    );

    const client = await createImapClient({
      host: account.host,
      port: account.port,
      secure: account.secure,
      user: account.user,
      pass: password,
    });

    const lock = await client.getMailboxLock(account.inboxName || "INBOX");

    try {
      const msg = await client.fetchOne(
        email.uid,
        {
          source: true,
          uid: true,
        },
        { uid: true },
      );

      if (!msg) {
        return NextResponse.json(
          { error: "Email not found on server" },
          { status: 404 },
        );
      }

      if (!email.seen) {
        await client.messageFlagsAdd(msg.uid, ["\\Seen"], { uid: true });
      }

      if (!msg.source) {
        return NextResponse.json(
          { error: "Email doesn't contain source" },
          { status: 404 },
        );
      }
      const parsed = await simpleParser(msg.source);

      const fullEmail = {
        ...email,
        textBody: parsed.text || "",
        htmlBody: parsed.html || "",
      };

      lock.release();
      await client.logout();

      if (!fullEmail) {
        return NextResponse.json(
          { error: "Email not found in mailbox" },
          { status: 404 },
        );
      }

      if (!email.seen) {
        await EmailModel.findByIdAndUpdate(emailId, { seen: true });
      }

      return NextResponse.json({ email: fullEmail }, { status: 200 });
    } catch (error) {
      lock.release();
      await client.logout();
      throw error;
    }
  } catch (error) {
    console.error("Error fetching email:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
