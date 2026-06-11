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

    const { searchParams } = new URL(request.url);
    const downloadIndex = searchParams.get("download");

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
        { source: true, uid: true },
        { uid: true },
      );

      if (!msg) {
        lock.release();
        await client.logout();
        return NextResponse.json(
          { error: "Email not found on server" },
          { status: 404 },
        );
      }

      if (!msg.source) {
        lock.release();
        await client.logout();
        return NextResponse.json(
          { error: "Email source not found" },
          { status: 404 },
        );
      }

      const parsed = await simpleParser(msg.source);
      lock.release();
      await client.logout();

      const attachments = (parsed.attachments || []).map((att, index) => ({
        index,
        filename: att.filename || `attachment-${index}`,
        contentType: att.contentType,
        size: att.size,
      }));

      if (downloadIndex !== null) {
        const idx = Number.parseInt(downloadIndex, 10);
        const attachment = parsed.attachments?.[idx];

        if (!attachment) {
          return NextResponse.json(
            { error: "Attachment not found" },
            { status: 404 },
          );
        }

        return new NextResponse(new Uint8Array(attachment.content), {
          headers: {
            "Content-Type":
              attachment.contentType || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.filename || `attachment-${idx}`)}"`,
            "Content-Length": String(attachment.size),
          },
        });
      }

      return NextResponse.json({ attachments }, { status: 200 });
    } catch (error) {
      lock.release();
      await client.logout();
      throw error;
    }
  } catch (error) {
    console.error("Error fetching attachments:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
