import mongoose from "mongoose";
import { z } from "zod";
import {
  AGENT_EMAIL_BODY_MAX_CHARS,
  fetchEmailBody,
  queryEmailMailbox,
} from "@/lib/email";
import { connectDB } from "@/lib/mongodb";
import { isSmtpConfigured, sendMailFromAccount } from "@/lib/smtp";
import { syncInbox } from "@/lib/sync-email";
import { EmailModel } from "@/models/Email";
import {
  EmailAccountModel,
  type ILeanEmailAccount,
} from "@/models/EmailAccount";
import { EmailDraftModel, type ILeanEmailDraft } from "@/models/EmailDraft";
import { defineTool } from "./define";
import type { ToolDefinition } from "./types";

const MAX_RECIPIENTS = 50;
const QUERY_EMAIL_LIMIT = 20;
const QUERY_EMAIL_CANDIDATE_LIMIT = 500;
const LIST_EMAIL_LIMIT = 100;

const emailId = z
  .string()
  .min(1)
  .describe(
    "Email _id exactly as list_emails, list_account_emails or get_email returned it",
  );

/** Every path out of a missing email, so none of them says only "not found". */
function missingEmail(id: string) {
  return `No locally synced email has id "${id}". Call list_emails or list_account_emails for ids that exist; query_emails searches the mail server for messages that were never synced.`;
}

const queryEmailInputSchema = z
  .object({
    account: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .optional()
      .describe(
        "Account _id, email address, or display name exactly as list_email_accounts returned it. Omit to query every configured account.",
      ),
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe("Full-text search across message headers and body (optional)."),
    from: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .optional()
      .describe("Sender name or address to match (optional)."),
    to: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .optional()
      .describe("Recipient name or address to match (optional)."),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe("Subject text to match (optional)."),
    startDate: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid start date")
      .optional()
      .describe(
        "Inclusive received date, ISO 8601, e.g. 2026-07-01 or 2026-07-01T00:00:00Z.",
      ),
    endDate: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid end date")
      .optional()
      .describe(
        "Exclusive received date, ISO 8601, e.g. 2026-08-01. Must be after startDate.",
      ),
    unreadOnly: z
      .boolean()
      .default(false)
      .describe("Only return unread messages."),
    scope: z
      .enum(["all", "inbox"])
      .default("all")
      .describe(
        "'all' searches the server's All Mail folder when it exposes one, 'inbox' only the configured inbox.",
      ),
    includeBody: z
      .boolean()
      .default(false)
      .describe("Include message bodies and small text-like attachments."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(QUERY_EMAIL_LIMIT)
      .default(20)
      .describe(`Results per page (maximum ${QUERY_EMAIL_LIMIT}).`),
    offset: z
      .number()
      .int()
      .min(0)
      .max(QUERY_EMAIL_CANDIDATE_LIMIT)
      .default(0)
      .describe(
        `Number of matching messages to skip (maximum ${QUERY_EMAIL_CANDIDATE_LIMIT}). Use nextOffset to continue.`,
      ),
  })
  .refine(
    (value) =>
      !value.startDate ||
      !value.endDate ||
      Date.parse(value.startDate) < Date.parse(value.endDate),
    {
      message: "endDate must be after startDate",
      path: ["endDate"],
    },
  );

const emailDraftInputSchema = z
  .object({
    account: z
      .string()
      .trim()
      .optional()
      .describe(
        "Sender account _id, email address, or display name exactly as list_email_accounts returned it. Omit to use the first SMTP-capable account.",
      ),
    to: z
      .array(z.email())
      .min(1)
      .max(MAX_RECIPIENTS)
      .describe("Recipient email addresses, e.g. ['someone@example.com']"),
    cc: z
      .array(z.email())
      .max(MAX_RECIPIENTS)
      .default([])
      .describe("CC email addresses (optional)"),
    bcc: z
      .array(z.email())
      .max(MAX_RECIPIENTS)
      .default([])
      .describe("BCC email addresses (optional)"),
    subject: z.string().trim().max(300).default("").describe("Email subject"),
    text: z.string().min(1).max(100_000).describe("Plain text email body"),
    html: z.string().max(200_000).optional().describe("HTML email body"),
    replyToMessageId: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe(
        "Message-ID to reply to, exactly as get_email returned it in messageId, e.g. <abc@example.com>",
      ),
    previousDraftId: z
      .string()
      .trim()
      .optional()
      .describe(
        "Draft _id returned by an earlier generate_email_draft, when revising a denied or corrected draft",
      ),
  })
  .refine(
    (data) =>
      data.to.length + data.cc.length + data.bcc.length <= MAX_RECIPIENTS,
    {
      message: `A draft can address at most ${MAX_RECIPIENTS} recipients across to, cc and bcc`,
      path: ["to"],
    },
  );

function serializeEmailAccount(account: ILeanEmailAccount) {
  return {
    _id: account._id.toString(),
    user: account.user,
    displayName: account.displayName,
    provider: account.provider ?? "custom",
    smtpConfigured: isSmtpConfigured(account),
    smtpFromName: account.smtpFromName,
    smtpFromAddress: account.smtpFromAddress,
  };
}

function serializeEmailDraft(
  draft: ILeanEmailDraft,
  account: ILeanEmailAccount,
) {
  return {
    draftId: draft._id.toString(),
    from: account.smtpFromAddress || account.user,
    fromName: account.smtpFromName,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
    replyToMessageId: draft.replyToMessageId,
    previousDraftId: draft.previousDraftId?.toString(),
    status: draft.status,
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serializeFetchedBody(
  fetched: Awaited<ReturnType<typeof fetchEmailBody>>,
) {
  if (!fetched) {
    return {
      bodyAvailable: false,
      body: "",
      bodyFormat: "text" as const,
      bodyTruncated: false,
      attachmentText: [],
    };
  }

  const textBody = fetched.text.trim();
  const htmlBody = fetched.html.trim();
  const completeBody = textBody || htmlBody;
  const body = completeBody.slice(0, AGENT_EMAIL_BODY_MAX_CHARS);
  return {
    bodyAvailable: true,
    body,
    bodyFormat: textBody ? ("text" as const) : ("html" as const),
    bodyTruncated: completeBody.length > body.length,
    attachmentText: fetched.attachmentText,
  };
}

async function resolveSendingAccount(accountRef: string | undefined) {
  const query = accountRef
    ? {
        $or: [
          ...(mongoose.Types.ObjectId.isValid(accountRef)
            ? [{ _id: accountRef }]
            : []),
          { user: accountRef },
          { displayName: accountRef },
        ],
      }
    : {};

  const accounts =
    await EmailAccountModel.find(query).lean<ILeanEmailAccount[]>();
  const account = accounts.find((item) => isSmtpConfigured(item));
  if (!account) {
    throw new Error(
      accountRef
        ? `No email account matching "${accountRef}" has SMTP sending configured. Call list_email_accounts with sendingOnly true for the accounts that can send, and pass one of their _id, user or displayName values.`
        : "No email account has SMTP sending configured. Call list_email_accounts to see what exists; sending needs SMTP host, port and credentials on the account.",
    );
  }
  return account;
}

export const emailTools: ToolDefinition[] = [
  defineTool({
    name: "list_emails",
    description:
      "List recent emails. Returns subject, sender, date, and read status.",
    isWrite: false,
    category: "email",
    input: z.object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(LIST_EMAIL_LIMIT)
        .default(20)
        .describe("Max number of emails to return"),
      unreadOnly: z
        .boolean()
        .default(false)
        .describe("Only show unread emails"),
    }),
    execute: async (input) => {
      await connectDB();
      const filter: Record<string, unknown> = {};
      if (input.unreadOnly) filter.seen = false;
      const emails = await EmailModel.find(filter)
        .sort({ date: -1 })
        .limit(input.limit)
        .lean();
      return emails.map((e) => ({
        _id: e._id.toString(),
        subject: e.subject,
        from: e.from,
        date: e.date,
        seen: e.seen,
      }));
    },
  }),
  defineTool({
    name: "query_emails",
    description:
      "Search live IMAP mailboxes, including historical emails that are not in the local sync. Supports server-side full-text, sender, recipient, subject, unread, and date-range filters across all accounts, plus merged pagination. By default it uses the server's All Mail folder when available and falls back to the configured inbox. Use includeBody when the email contents are needed. startDate is inclusive and endDate is exclusive.",
    isWrite: false,
    category: "email",
    input: queryEmailInputSchema,
    execute: async (input) => {
      await connectDB();
      const accountRef = input.account;
      const accountFilter = accountRef
        ? {
            $or: [
              ...(mongoose.Types.ObjectId.isValid(accountRef)
                ? [{ _id: accountRef }]
                : []),
              { user: new RegExp(`^${escapeRegex(accountRef)}$`, "i") },
              {
                displayName: new RegExp(`^${escapeRegex(accountRef)}$`, "i"),
              },
            ],
          }
        : {};
      const accounts =
        await EmailAccountModel.find(accountFilter).lean<ILeanEmailAccount[]>();
      if (accountRef && accounts.length === 0) {
        throw new Error(
          `No email account matches "${accountRef}". Call list_email_accounts and pass one of the _id, user or displayName values it returns, or omit account to query every one.`,
        );
      }

      const candidateLimit = Math.min(
        QUERY_EMAIL_CANDIDATE_LIMIT,
        input.offset + input.limit,
      );
      const settled = await Promise.all(
        accounts.map(async (account) => {
          try {
            const result = await queryEmailMailbox(account, {
              text: input.query,
              from: input.from,
              to: input.to,
              subject: input.subject,
              since: input.startDate ? new Date(input.startDate) : undefined,
              before: input.endDate ? new Date(input.endDate) : undefined,
              seen: input.unreadOnly ? false : undefined,
              scope: input.scope,
              candidateLimit,
              includeBody: input.includeBody,
              includeAttachmentText: input.includeBody,
            });
            return { account, result };
          } catch (error) {
            return {
              account,
              error:
                error instanceof Error ? error.message : "Mailbox query failed",
            };
          }
        }),
      );

      const failures = settled.flatMap((entry) =>
        "error" in entry
          ? [
              {
                accountId: entry.account._id.toString(),
                account: entry.account.user,
                error: entry.error,
              },
            ]
          : [],
      );
      const successful = settled.filter(
        (
          entry,
        ): entry is (typeof settled)[number] & {
          result: Awaited<ReturnType<typeof queryEmailMailbox>>;
        } => "result" in entry,
      );
      const total = Math.min(
        QUERY_EMAIL_CANDIDATE_LIMIT,
        successful.reduce((sum, entry) => sum + entry.result.total, 0),
      );
      const sliceEnd = Math.min(
        QUERY_EMAIL_CANDIDATE_LIMIT,
        input.offset + input.limit,
      );
      const emails = successful
        .flatMap((entry) =>
          entry.result.emails.map((email) => ({
            ...email,
            accountId: entry.account._id.toString(),
            account: entry.account.user,
            accountName: entry.account.displayName,
            mailbox: entry.result.mailbox,
          })),
        )
        .sort(
          (left, right) =>
            new Date(right.date).getTime() - new Date(left.date).getTime(),
        )
        .slice(input.offset, sliceEnd);
      const nextOffset = input.offset + emails.length;
      const hasMore =
        emails.length === input.limit &&
        nextOffset < total &&
        nextOffset < QUERY_EMAIL_CANDIDATE_LIMIT;

      return {
        emails,
        total,
        offset: input.offset,
        limit: input.limit,
        hasMore,
        nextOffset: hasMore ? nextOffset : null,
        partial: failures.length > 0,
        failures,
      };
    },
  }),
  defineTool({
    name: "get_email",
    description:
      "Get a locally synced email by ID, including its body and small text-like attachments. This does not mark the email as read.",
    isWrite: false,
    category: "email",
    input: z.object({ id: emailId }),
    execute: async (input) => {
      await connectDB();
      const email = await EmailModel.findById(input.id).lean();
      if (!email) return { success: false, error: missingEmail(input.id) };
      let fetched: Awaited<ReturnType<typeof fetchEmailBody>> = null;
      let bodyError: string | undefined;
      try {
        fetched = await fetchEmailBody(email.accountId.toString(), email.uid, {
          includeAttachmentText: true,
        });
      } catch (error) {
        bodyError =
          error instanceof Error ? error.message : "Failed to fetch email body";
      }
      return {
        _id: email._id.toString(),
        accountId: email.accountId.toString(),
        messageId: email.messageId,
        subject: email.subject,
        from: email.from,
        date: email.date,
        seen: email.seen,
        uid: email.uid,
        ...serializeFetchedBody(fetched),
        ...(bodyError ? { bodyError } : {}),
      };
    },
  }),
  defineTool({
    name: "mark_email_as_read",
    description: "Mark a specific email as read by its ID.",
    isWrite: true,
    category: "email",
    input: z.object({ id: emailId }),
    execute: async (input) => {
      await connectDB();
      const result = await EmailModel.findByIdAndUpdate(
        input.id,
        { seen: true },
        { returnDocument: "after" },
      ).lean();
      if (!result) throw new Error(missingEmail(input.id));
      return {
        _id: result._id.toString(),
        subject: result.subject,
        from: result.from,
        date: result.date,
        seen: result.seen,
      };
    },
  }),
  defineTool({
    name: "delete_email",
    description: "Delete a specific email by its ID.",
    isWrite: true,
    category: "email",
    input: z.object({ id: emailId }),
    execute: async (input) => {
      await connectDB();
      const result = await EmailModel.findByIdAndDelete(input.id).lean();
      if (!result) return { success: false, error: missingEmail(input.id) };
      return { success: true };
    },
  }),
  defineTool({
    name: "list_email_accounts",
    description:
      "List configured email accounts and whether each can send through SMTP. Does not return passwords or secrets.",
    isWrite: false,
    category: "email",
    input: z.object({
      sendingOnly: z
        .boolean()
        .default(false)
        .describe("Only return accounts with SMTP sending configured"),
    }),
    execute: async (input) => {
      await connectDB();
      const accounts =
        await EmailAccountModel.find().lean<ILeanEmailAccount[]>();
      const serialized = accounts.map(serializeEmailAccount);
      return input.sendingOnly
        ? serialized.filter((account) => account.smtpConfigured)
        : serialized;
    },
  }),
  defineTool({
    name: "list_account_emails",
    description: "List a specific account's emails.",
    isWrite: false,
    category: "email",
    input: z.object({
      account: z
        .string()
        .min(1)
        .describe(
          "Account address exactly as list_email_accounts returned it in user, e.g. example@co.com",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(LIST_EMAIL_LIMIT)
        .default(20)
        .describe("Max number of emails to return"),
    }),
    execute: async (input) => {
      await connectDB();
      const account = await EmailAccountModel.findOne({
        user: input.account,
      }).lean();
      if (!account) {
        return {
          success: false,
          error: `No email account has the address "${input.account}". Call list_email_accounts and pass one of the user values it returns.`,
        };
      }
      const accountId = account._id;
      const emails = await EmailModel.find({ accountId })
        .sort({ date: -1 })
        .limit(input.limit)
        .lean();
      return emails.map((e) => ({
        _id: e._id.toString(),
        subject: e.subject,
        from: e.from,
        date: e.date,
        seen: e.seen,
      }));
    },
  }),
  defineTool({
    name: "generate_email_draft",
    description:
      "Generate and store an email draft for review. This does not send email. Always use this before request_send_email.",
    isWrite: false,
    category: "email",
    input: emailDraftInputSchema,
    execute: async (input) => {
      await connectDB();
      const account = await resolveSendingAccount(input.account);
      const previousDraftId =
        input.previousDraftId &&
        mongoose.Types.ObjectId.isValid(input.previousDraftId)
          ? new mongoose.Types.ObjectId(input.previousDraftId)
          : undefined;

      const draft = await EmailDraftModel.create({
        accountId: account._id,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: input.text,
        html: input.html,
        replyToMessageId: input.replyToMessageId,
        previousDraftId,
        status: "draft",
      });

      return {
        success: true,
        ...serializeEmailDraft(draft.toObject() as ILeanEmailDraft, account),
      };
    },
  }),
  defineTool({
    name: "request_send_email",
    description:
      "Request approval to send a stored email draft. Only call this with a draftId returned by generate_email_draft. If the user denies approval, ask what should be corrected and generate a revised draft before requesting send again.",
    isWrite: true,
    category: "email",
    input: z.object({
      draftId: z
        .string()
        .trim()
        .min(1)
        .describe("Draft _id exactly as generate_email_draft returned it"),
    }),
    execute: async (input) => {
      await connectDB();
      const draft = await EmailDraftModel.findOneAndUpdate(
        { _id: input.draftId, status: "draft" },
        { status: "sending" },
        { returnDocument: "after" },
      ).lean<ILeanEmailDraft | null>();
      if (!draft) {
        const currentDraft = await EmailDraftModel.findById(
          input.draftId,
        ).lean<ILeanEmailDraft | null>();
        if (!currentDraft) {
          throw new Error(
            `Email draft not found: no draft has id "${input.draftId}". Call generate_email_draft and send the draftId it returns.`,
          );
        }
        if (currentDraft.status === "sent") {
          throw new Error(
            "Email draft was already sent. Call generate_email_draft again if the message needs sending a second time.",
          );
        }
        if (currentDraft.status === "sending") {
          throw new Error(
            "Email draft is already being sent. Wait for that send to finish instead of retrying.",
          );
        }
        throw new Error(
          `Email draft is not sendable: its status is "${currentDraft.status}". Call generate_email_draft to produce a fresh draft.`,
        );
      }

      try {
        const account = await EmailAccountModel.findById(
          draft.accountId,
        ).lean<ILeanEmailAccount | null>();
        if (!account) {
          throw new Error(
            `The email account this draft was written for (${draft.accountId.toString()}) no longer exists. Call list_email_accounts, then generate_email_draft against an account that does.`,
          );
        }

        await sendMailFromAccount(account, {
          to: draft.to,
          cc: draft.cc,
          bcc: draft.bcc,
          subject: draft.subject,
          text: draft.text,
          html: draft.html,
          replyToMessageId: draft.replyToMessageId,
        });
      } catch (error) {
        await EmailDraftModel.findOneAndUpdate(
          { _id: draft._id, status: "sending" },
          { status: "draft" },
        );
        throw error;
      }

      const sentAt = new Date();
      await EmailDraftModel.findByIdAndUpdate(draft._id, {
        status: "sent",
        sentAt,
      });

      return {
        success: true,
        draftId: draft._id.toString(),
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        subject: draft.subject,
        sentAt: sentAt.toISOString(),
      };
    },
  }),
  defineTool({
    name: "sync_email_accounts",
    description:
      "Fetch new mail over IMAP. Syncs one account when accountId is given, otherwise every account. Reaches the mail server, so it takes seconds per account — call it when mail looks stale, not before every read.",
    isWrite: true,
    category: "email",
    input: z.object({
      accountId: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Account _id exactly as list_email_accounts returned it. Omit to sync all of them.",
        ),
    }),
    execute: async (input) => {
      await connectDB();
      const accountId = input.accountId;
      if (accountId && !mongoose.Types.ObjectId.isValid(accountId)) {
        throw new Error(
          `"${accountId}" is not a valid account id. Account ids are the _id values from list_email_accounts; omit accountId to sync every account.`,
        );
      }
      // Hydrated, not lean: syncInbox takes a document.
      const accounts = accountId
        ? await EmailAccountModel.find({ _id: accountId })
        : await EmailAccountModel.find();
      if (accounts.length === 0) {
        throw new Error(
          accountId
            ? `No email account has id "${accountId}". Call list_email_accounts for the ids that exist.`
            : "No email accounts are configured, so there is nothing to sync.",
        );
      }

      const results: {
        account: string;
        synced: boolean;
        lastUid?: number;
        error?: string;
      }[] = [];
      for (const account of accounts) {
        try {
          const lastUid = await syncInbox(account);
          await EmailAccountModel.findByIdAndUpdate(account._id, { lastUid });
          results.push({ account: account.user, synced: true, lastUid });
        } catch (error) {
          // One unreachable mailbox must not abort the rest: a partial sync is
          // the useful outcome, and the failure is reported per account.
          results.push({
            account: account.user,
            synced: false,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
      return {
        synced: results.filter((result) => result.synced).length,
        failed: results.filter((result) => !result.synced).length,
        results,
      };
    },
  }),
];
