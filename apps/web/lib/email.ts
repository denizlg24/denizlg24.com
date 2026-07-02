import { ImapFlow, type MessageAddressObject } from "imapflow";
import { simpleParser } from "mailparser";
import type { Types } from "mongoose";
import { EmailModel, type IEmail } from "@/models/Email";
import { EmailAccountModel } from "@/models/EmailAccount";
import { decryptPassword } from "./safe-email-password";

const TRIAGE_ATTACHMENT_MAX_COUNT = 3;
const TRIAGE_ATTACHMENT_MAX_BYTES = 512 * 1024;
const TRIAGE_ATTACHMENT_MAX_CHARS = 2200;
const TRIAGE_ATTACHMENT_TOTAL_CHARS = 6000;

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
      returnDocument: "after",
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
  attachmentText: FetchedEmailAttachmentText[];
}

export interface FetchedEmailAttachmentText {
  filename: string;
  contentType: string;
  size: number;
  text: string;
  truncated: boolean;
}

interface FetchEmailBodyOptions {
  includeAttachmentText?: boolean;
}

function isTextLikeAttachment(filename: string, contentType: string) {
  const normalizedType = contentType.toLowerCase();
  const normalizedName = filename.toLowerCase();
  return (
    normalizedType.startsWith("text/") ||
    [
      "application/json",
      "application/ld+json",
      "application/xml",
      "application/xhtml+xml",
      "application/csv",
      "application/ics",
      "text/calendar",
      "text/csv",
    ].includes(normalizedType) ||
    /\.(txt|md|markdown|csv|tsv|ics|json|xml|yaml|yml)$/i.test(normalizedName)
  );
}

function normalizeAttachmentText(value: string) {
  return value
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractAttachmentText(
  attachments: Awaited<ReturnType<typeof simpleParser>>["attachments"],
): FetchedEmailAttachmentText[] {
  const extracted: FetchedEmailAttachmentText[] = [];
  let totalChars = 0;

  for (const [index, attachment] of attachments.entries()) {
    if (extracted.length >= TRIAGE_ATTACHMENT_MAX_COUNT) break;

    const filename = attachment.filename || `attachment-${index}`;
    const contentType = attachment.contentType || "application/octet-stream";
    const size = attachment.size ?? attachment.content.length;
    if (size > TRIAGE_ATTACHMENT_MAX_BYTES) continue;
    if (!isTextLikeAttachment(filename, contentType)) continue;

    const normalized = normalizeAttachmentText(
      attachment.content.toString("utf8"),
    );
    if (!normalized) continue;

    const remaining = TRIAGE_ATTACHMENT_TOTAL_CHARS - totalChars;
    if (remaining <= 0) break;

    const limit = Math.min(TRIAGE_ATTACHMENT_MAX_CHARS, remaining);
    const text = normalized.slice(0, limit).trim();
    if (!text) continue;

    totalChars += text.length;
    extracted.push({
      filename,
      contentType,
      size,
      text,
      truncated: normalized.length > text.length,
    });
  }

  return extracted;
}

export async function fetchEmailBody(
  accountId: string,
  uid: number,
  options?: FetchEmailBodyOptions,
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
    if (msg === false || !msg.source) return null;

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
      attachmentText: options?.includeAttachmentText
        ? extractAttachmentText(parsed.attachments ?? [])
        : [],
    };
  } finally {
    lock.release();
    await client.logout();
  }
}
