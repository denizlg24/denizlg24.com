import {
  type FetchMessageObject,
  ImapFlow,
  type MessageAddressObject,
  type SearchObject,
} from "imapflow";
import { simpleParser } from "mailparser";
import type { Types } from "mongoose";
import { EmailModel, type IEmail } from "@/models/Email";
import {
  EmailAccountModel,
  type ILeanEmailAccount,
} from "@/models/EmailAccount";
import { decryptPassword } from "./safe-email-password";

const TRIAGE_ATTACHMENT_MAX_COUNT = 3;
const TRIAGE_ATTACHMENT_MAX_BYTES = 512 * 1024;
const TRIAGE_ATTACHMENT_MAX_CHARS = 2200;
const TRIAGE_ATTACHMENT_TOTAL_CHARS = 6000;
export const AGENT_EMAIL_BODY_MAX_CHARS = 16_000;
const AGENT_EMAIL_SOURCE_MAX_BYTES = 2 * 1024 * 1024;

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

export interface QueryEmailMailboxOptions {
  text?: string;
  from?: string;
  to?: string;
  subject?: string;
  since?: Date;
  before?: Date;
  seen?: boolean;
  scope?: "all" | "inbox";
  candidateLimit: number;
  includeBody?: boolean;
  includeAttachmentText?: boolean;
}

export interface QueriedMailboxEmail {
  uid: number;
  messageId?: string;
  subject: string;
  from: { name?: string; address: string }[];
  to: { name?: string; address: string }[];
  date: Date;
  seen: boolean;
  body?: string;
  bodyFormat?: "text" | "html";
  bodyTruncated?: boolean;
  sourceTruncated?: boolean;
  bodyError?: string;
  attachmentText?: FetchedEmailAttachmentText[];
}

export interface QueriedMailboxResult {
  emails: QueriedMailboxEmail[];
  total: number;
  mailbox: string;
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

function serializeAddresses(addresses: MessageAddressObject[] | undefined) {
  return (addresses ?? [])
    .filter(
      (address): address is MessageAddressObject & { address: string } =>
        typeof address.address === "string" && address.address.length > 0,
    )
    .map((address) => ({
      name: address.name || undefined,
      address: address.address,
    }));
}

async function serializeQueriedMessage(
  message: FetchMessageObject,
  options: QueryEmailMailboxOptions,
): Promise<QueriedMailboxEmail> {
  const parsed =
    options.includeBody && message.source
      ? await simpleParser(message.source)
      : undefined;
  const textBody = parsed?.text?.trim() ?? "";
  const htmlBody = typeof parsed?.html === "string" ? parsed.html.trim() : "";
  const completeBody = textBody || htmlBody;
  const body = completeBody.slice(0, AGENT_EMAIL_BODY_MAX_CHARS);
  const parsedTo = Array.isArray(parsed?.to)
    ? parsed.to.flatMap((address) => address.value)
    : parsed?.to?.value;

  return {
    uid: message.uid,
    messageId: parsed?.messageId ?? message.envelope?.messageId ?? undefined,
    subject: parsed?.subject ?? message.envelope?.subject ?? "(No Subject)",
    from: parsed
      ? serializeAddresses(parsed.from?.value)
      : serializeAddresses(message.envelope?.from),
    to: parsed
      ? serializeAddresses(parsedTo)
      : serializeAddresses(message.envelope?.to),
    date:
      parsed?.date ??
      message.envelope?.date ??
      (typeof message.internalDate === "string"
        ? new Date(message.internalDate)
        : message.internalDate) ??
      new Date(0),
    seen: message.flags?.has("\\Seen") ?? false,
    ...(options.includeBody
      ? {
          body,
          bodyFormat: textBody ? ("text" as const) : ("html" as const),
          bodyTruncated: completeBody.length > body.length,
          sourceTruncated:
            typeof message.size === "number" &&
            typeof message.source?.length === "number"
              ? message.source.length < message.size
              : false,
          attachmentText: options.includeAttachmentText
            ? extractAttachmentText(parsed?.attachments ?? [])
            : [],
        }
      : {}),
  };
}

/**
 * Search the live IMAP inbox rather than the locally synced Email collection.
 * Initial account sync intentionally stores only the latest 50 headers, so
 * historical agent queries must go to the mailbox server to be complete.
 */
export async function queryEmailMailbox(
  account: ILeanEmailAccount,
  options: QueryEmailMailboxOptions,
): Promise<QueriedMailboxResult> {
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

  let mailbox = account.inboxName || "INBOX";
  let lock: Awaited<ReturnType<(typeof client)["getMailboxLock"]>> | undefined;
  try {
    if (options.scope !== "inbox") {
      const folders = await client.list();
      mailbox =
        folders.find((folder) => folder.specialUse === "\\All")?.path ??
        mailbox;
    }
    lock = await client.getMailboxLock(mailbox);
    const search: SearchObject = {
      ...(options.text ? { text: options.text } : {}),
      ...(options.from ? { from: options.from } : {}),
      ...(options.to ? { to: options.to } : {}),
      ...(options.subject ? { subject: options.subject } : {}),
      ...(options.since ? { since: options.since } : {}),
      ...(options.before ? { before: options.before } : {}),
      ...(typeof options.seen === "boolean" ? { seen: options.seen } : {}),
    };
    if (Object.keys(search).length === 0) search.all = true;

    const matched = await client.search(search, { uid: true });
    const uids = matched === false ? [] : matched;
    const candidateLimit = Math.max(0, Math.floor(options.candidateLimit));
    const candidateUids =
      candidateLimit === 0
        ? []
        : [...uids].sort((left, right) => left - right).slice(-candidateLimit);
    if (candidateUids.length === 0) {
      return { emails: [], total: uids.length, mailbox };
    }

    const messages = await client.fetchAll(
      candidateUids,
      {
        envelope: true,
        flags: true,
        uid: true,
        source: options.includeBody
          ? { maxLength: AGENT_EMAIL_SOURCE_MAX_BYTES }
          : false,
        internalDate: true,
        size: true,
      },
      { uid: true },
    );
    const emails = await Promise.all(
      messages.map(async (message) => {
        try {
          return await serializeQueriedMessage(message, options);
        } catch (error) {
          const metadata = await serializeQueriedMessage(message, {
            ...options,
            includeBody: false,
          });
          return {
            ...metadata,
            body: "",
            bodyFormat: "text" as const,
            bodyTruncated: false,
            sourceTruncated:
              typeof message.size === "number" &&
              typeof message.source?.length === "number"
                ? message.source.length < message.size
                : false,
            bodyError:
              error instanceof Error
                ? error.message
                : "Failed to parse message body",
            attachmentText: [],
          };
        }
      }),
    );

    return {
      emails: emails.sort(
        (left, right) => right.date.getTime() - left.date.getTime(),
      ),
      total: uids.length,
      mailbox,
    };
  } finally {
    lock?.release();
    await client.logout();
  }
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
