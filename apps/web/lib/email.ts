import { ImapFlow, type MessageAddressObject } from "imapflow";
import { simpleParser } from "mailparser";
import type { Types } from "mongoose";
import { EmailModel, type IEmail } from "@/models/Email";
import { EmailAccountModel } from "@/models/EmailAccount";
import { decryptPassword } from "./safe-email-password";

export async function createImapClient(account: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}) {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: {
      user: account.user,
      pass: account.pass,
    },
  });

  await client.connect();
  return client;
}

async function resolveThreadId(
  accountId: Types.ObjectId | string,
  messageId: string,
  inReplyTo: string | undefined,
): Promise<string> {
  if (!inReplyTo) return messageId;
  const parent = await EmailModel.findOne({ accountId, messageId: inReplyTo })
    .select("threadId messageId")
    .lean();
  if (parent) return parent.threadId ?? parent.messageId;
  return inReplyTo;
}

export async function saveEmail(emailData: {
  accountId: Types.ObjectId | string;
  messageId: string;
  subject: string;
  from: MessageAddressObject[];
  date: Date;
  createdAt?: Date;
  seen: boolean;
  uid: number;
  inReplyTo?: string;
  references?: string[];
}): Promise<IEmail> {
  const fromAddresses = emailData.from
    .filter(
      (addr): addr is MessageAddressObject & { address: string } =>
        typeof addr.address === "string" && addr.address.length > 0,
    )
    .map((addr) => ({
      name: addr.name,
      address: addr.address,
    }));

  const threadId = await resolveThreadId(
    emailData.accountId,
    emailData.messageId,
    emailData.inReplyTo,
  );

  const email = await EmailModel.findOneAndUpdate(
    {
      accountId: emailData.accountId,
      messageId: emailData.messageId,
    },
    {
      $set: {
        subject: emailData.subject,
        from: fromAddresses,
        date: emailData.date,
        seen: emailData.seen,
        uid: emailData.uid,
        ...(emailData.inReplyTo ? { inReplyTo: emailData.inReplyTo } : {}),
        ...(emailData.references?.length
          ? { references: emailData.references }
          : {}),
        threadId,
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      includeResultMetadata: false,
    },
  );

  if (!email) {
    throw new Error("Failed to save email");
  }

  return email;
}

export interface FetchedEmailBody {
  subject: string;
  from: { name?: string; address: string }[];
  date: Date;
  text: string;
  html: string;
}

export async function fetchEmailBody(
  accountId: string,
  uid: number,
): Promise<FetchedEmailBody | null> {
  const account = await EmailAccountModel.findById(accountId).lean();
  if (!account) return null;

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
      uid.toString(),
      { source: true, uid: true, envelope: true },
      { uid: true },
    );
    if (!msg || !msg.source) return null;

    const parsed = await simpleParser(msg.source);
    return {
      subject: parsed.subject ?? msg.envelope?.subject ?? "",
      from: (parsed.from?.value ?? []).map((a) => ({
        name: a.name || undefined,
        address: a.address ?? "",
      })),
      date: parsed.date ?? msg.envelope?.date ?? new Date(),
      text: parsed.text ?? "",
      html: typeof parsed.html === "string" ? parsed.html : "",
    };
  } finally {
    lock.release();
    await client.logout();
  }
}
