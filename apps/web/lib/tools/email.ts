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
import type { ToolDefinition } from "./types";

const MAX_RECIPIENTS = 50;
const QUERY_EMAIL_LIMIT = 20;
const QUERY_EMAIL_CANDIDATE_LIMIT = 500;

const queryEmailInputSchema = z
  .object({
    account: z.string().trim().min(1).max(320).optional(),
    query: z.string().trim().min(1).max(500).optional(),
    from: z.string().trim().min(1).max(320).optional(),
    to: z.string().trim().min(1).max(320).optional(),
    subject: z.string().trim().min(1).max(500).optional(),
    startDate: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid start date")
      .optional(),
    endDate: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid end date")
      .optional(),
    unreadOnly: z.boolean().optional().default(false),
    scope: z.enum(["all", "inbox"]).optional().default("all"),
    includeBody: z.boolean().optional().default(false),
    limit: z.number().int().min(1).max(QUERY_EMAIL_LIMIT).default(20),
    offset: z.number().int().min(0).max(QUERY_EMAIL_CANDIDATE_LIMIT).default(0),
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
      .describe("Optional sender account ID or email address")
      .optional(),
    to: z.array(z.email()).min(1).max(MAX_RECIPIENTS),
    cc: z.array(z.email()).max(MAX_RECIPIENTS).optional().default([]),
    bcc: z.array(z.email()).max(MAX_RECIPIENTS).optional().default([]),
    subject: z.string().trim().max(300).default(""),
    text: z.string().min(1).max(100_000),
    html: z.string().max(200_000).optional(),
    replyToMessageId: z.string().trim().max(500).optional(),
    previousDraftId: z.string().trim().optional(),
  })
  .refine((data) => data.to.length + data.cc.length + data.bcc.length <= 50, {
    message: "Too many recipients",
    path: ["to"],
  });

const sendEmailDraftInputSchema = z.object({
  draftId: z.string().trim().min(1),
});

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
        ? "Selected email account does not have SMTP sending configured"
        : "No SMTP-capable email account is configured",
    );
  }
  return account;
}

export const emailTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_emails",
      description:
        "List recent emails. Returns subject, sender, date, and read status.",
      input_schema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max number of emails to return (default 20)",
          },
          unreadOnly: {
            type: "boolean",
            description: "Only show unread emails (default false)",
          },
        },
      },
    },
    isWrite: false,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const limit = (input.limit as number) || 20;
      const filter: Record<string, unknown> = {};
      if (input.unreadOnly) filter.seen = false;
      const emails = await EmailModel.find(filter)
        .sort({ date: -1 })
        .limit(limit)
        .lean();
      return emails.map((e) => ({
        _id: e._id.toString(),
        subject: e.subject,
        from: e.from,
        date: e.date,
        seen: e.seen,
      }));
    },
  },
  {
    schema: {
      name: "query_emails",
      description:
        "Search live IMAP mailboxes, including historical emails that are not in the local sync. Supports server-side full-text, sender, recipient, subject, unread, and date-range filters across all accounts, plus merged pagination. By default it uses the server's All Mail folder when available and falls back to the configured inbox. Use includeBody when the email contents are needed. startDate is inclusive and endDate is exclusive.",
      input_schema: {
        type: "object",
        properties: {
          account: {
            type: "string",
            description:
              "Optional account ID, email address, or display name. Omit to query every configured account.",
          },
          query: {
            type: "string",
            description:
              "Full-text search across message headers and body (optional).",
          },
          from: {
            type: "string",
            description: "Sender name or address to match (optional).",
          },
          to: {
            type: "string",
            description: "Recipient name or address to match (optional).",
          },
          subject: {
            type: "string",
            description: "Subject text to match (optional).",
          },
          startDate: {
            type: "string",
            description:
              "Inclusive received date in ISO format, such as 2026-07-01.",
          },
          endDate: {
            type: "string",
            description:
              "Exclusive received date in ISO format, such as 2026-08-01.",
          },
          unreadOnly: {
            type: "boolean",
            description: "Only return unread messages (default false).",
          },
          scope: {
            type: "string",
            description:
              "Search all mail when the server exposes an All Mail folder, or only the configured inbox (default all).",
            enum: ["all", "inbox"],
          },
          includeBody: {
            type: "boolean",
            description:
              "Include message bodies and small text-like attachments (default false).",
          },
          limit: {
            type: "number",
            description: `Results per page (default 20, maximum ${QUERY_EMAIL_LIMIT}).`,
          },
          offset: {
            type: "number",
            description: `Number of matching messages to skip (maximum ${QUERY_EMAIL_CANDIDATE_LIMIT}). Use nextOffset to continue.`,
            maximum: QUERY_EMAIL_CANDIDATE_LIMIT,
          },
        },
      },
    },
    isWrite: false,
    category: "email",
    execute: async (input) => {
      const parsed = queryEmailInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message ?? "Invalid email query",
        );
      }

      await connectDB();
      const accountRef = parsed.data.account;
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
        throw new Error("Email account not found");
      }

      const candidateLimit = Math.min(
        QUERY_EMAIL_CANDIDATE_LIMIT,
        parsed.data.offset + parsed.data.limit,
      );
      const settled = await Promise.all(
        accounts.map(async (account) => {
          try {
            const result = await queryEmailMailbox(account, {
              text: parsed.data.query,
              from: parsed.data.from,
              to: parsed.data.to,
              subject: parsed.data.subject,
              since: parsed.data.startDate
                ? new Date(parsed.data.startDate)
                : undefined,
              before: parsed.data.endDate
                ? new Date(parsed.data.endDate)
                : undefined,
              seen: parsed.data.unreadOnly ? false : undefined,
              scope: parsed.data.scope,
              candidateLimit,
              includeBody: parsed.data.includeBody,
              includeAttachmentText: parsed.data.includeBody,
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
        parsed.data.offset + parsed.data.limit,
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
        .slice(parsed.data.offset, sliceEnd);
      const nextOffset = parsed.data.offset + emails.length;
      const hasMore =
        emails.length === parsed.data.limit &&
        nextOffset < total &&
        nextOffset < QUERY_EMAIL_CANDIDATE_LIMIT;

      return {
        emails,
        total,
        offset: parsed.data.offset,
        limit: parsed.data.limit,
        hasMore,
        nextOffset: hasMore ? nextOffset : null,
        partial: failures.length > 0,
        failures,
      };
    },
  },
  {
    schema: {
      name: "get_email",
      description:
        "Get a locally synced email by ID, including its body and small text-like attachments. This does not mark the email as read.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Email ID" },
        },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const email = await EmailModel.findById(input.id as string).lean();
      if (!email) return { success: false, error: "Email not found" };
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
  },
  {
    schema: {
      name: "mark_email_as_read",
      description: "Mark a specific email as read by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Email ID" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const result = await EmailModel.findByIdAndUpdate(
        input.id as string,
        { seen: true },
        { returnDocument: "after" },
      ).lean();
      if (!result) throw new Error("Email not found");
      return {
        _id: result._id.toString(),
        subject: result.subject,
        from: result.from,
        date: result.date,
        seen: result.seen,
      };
    },
  },
  {
    schema: {
      name: "delete_email",
      description: "Delete a specific email by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Email ID" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const result = await EmailModel.findByIdAndDelete(
        input.id as string,
      ).lean();
      if (!result) return { success: false, error: "Email not found" };
      return { success: true };
    },
  },
  {
    schema: {
      name: "list_email_accounts",
      description:
        "List configured email accounts and whether each can send through SMTP. Does not return passwords or secrets.",
      input_schema: {
        type: "object",
        properties: {
          sendingOnly: {
            type: "boolean",
            description:
              "Only return accounts with SMTP sending configured (default false)",
          },
        },
      },
    },
    isWrite: false,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const accounts =
        await EmailAccountModel.find().lean<ILeanEmailAccount[]>();
      const serialized = accounts.map(serializeEmailAccount);
      return input.sendingOnly
        ? serialized.filter((account) => account.smtpConfigured)
        : serialized;
    },
  },
  {
    schema: {
      name: "list_account_emails",
      description: "List a specific account's emails.",
      input_schema: {
        type: "object",
        properties: {
          account: {
            type: "string",
            description: "Account name (e.g. 'example@co.com')",
          },
          limit: {
            type: "number",
            description: "Max number of emails to return (default 20)",
          },
        },
        required: ["account"],
      },
    },
    isWrite: false,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const limit = (input.limit as number) || 20;
      const account = await EmailAccountModel.findOne({
        user: input.account as string,
      }).lean();
      if (!account) return { success: false, error: "Email account not found" };
      const accountId = account._id;
      const emails = await EmailModel.find({ accountId })
        .sort({ date: -1 })
        .limit(limit)
        .lean();
      return emails.map((e) => ({
        _id: e._id.toString(),
        subject: e.subject,
        from: e.from,
        date: e.date,
        seen: e.seen,
      }));
    },
  },
  {
    schema: {
      name: "generate_email_draft",
      description:
        "Generate and store an email draft for review. This does not send email. Always use this before request_send_email.",
      input_schema: {
        type: "object",
        properties: {
          account: {
            type: "string",
            description:
              "Optional sender account ID, email address, or display name. If omitted, the first SMTP-capable account is used.",
          },
          to: {
            type: "array",
            description: "Recipient email addresses",
            items: { type: "string" },
          },
          cc: {
            type: "array",
            description: "CC email addresses (optional)",
            items: { type: "string" },
          },
          bcc: {
            type: "array",
            description: "BCC email addresses (optional)",
            items: { type: "string" },
          },
          subject: { type: "string", description: "Email subject" },
          text: { type: "string", description: "Plain text email body" },
          html: { type: "string", description: "HTML email body (optional)" },
          replyToMessageId: {
            type: "string",
            description: "Message-ID to reply to (optional)",
          },
          previousDraftId: {
            type: "string",
            description:
              "Previous draft ID when revising a denied or corrected draft (optional)",
          },
        },
        required: ["to", "text"],
      },
    },
    isWrite: false,
    category: "email",
    execute: async (input) => {
      const parsed = emailDraftInputSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid email draft input");

      await connectDB();
      const account = await resolveSendingAccount(parsed.data.account);
      const previousDraftId =
        parsed.data.previousDraftId &&
        mongoose.Types.ObjectId.isValid(parsed.data.previousDraftId)
          ? new mongoose.Types.ObjectId(parsed.data.previousDraftId)
          : undefined;

      const draft = await EmailDraftModel.create({
        accountId: account._id,
        to: parsed.data.to,
        cc: parsed.data.cc,
        bcc: parsed.data.bcc,
        subject: parsed.data.subject,
        text: parsed.data.text,
        html: parsed.data.html,
        replyToMessageId: parsed.data.replyToMessageId,
        previousDraftId,
        status: "draft",
      });

      return {
        success: true,
        ...serializeEmailDraft(draft.toObject() as ILeanEmailDraft, account),
      };
    },
  },
  {
    schema: {
      name: "request_send_email",
      description:
        "Request approval to send a stored email draft. Only call this with a draftId returned by generate_email_draft. If the user denies approval, ask what should be corrected and generate a revised draft before requesting send again.",
      input_schema: {
        type: "object",
        properties: {
          draftId: {
            type: "string",
            description: "Draft ID returned by generate_email_draft",
          },
        },
        required: ["draftId"],
      },
    },
    isWrite: true,
    category: "email",
    execute: async (input) => {
      const parsed = sendEmailDraftInputSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid email send request");

      await connectDB();
      const draft = await EmailDraftModel.findOneAndUpdate(
        { _id: parsed.data.draftId, status: "draft" },
        { status: "sending" },
        { returnDocument: "after" },
      ).lean<ILeanEmailDraft | null>();
      if (!draft) {
        const currentDraft = await EmailDraftModel.findById(
          parsed.data.draftId,
        ).lean<ILeanEmailDraft | null>();
        if (!currentDraft) throw new Error("Email draft not found");
        if (currentDraft.status === "sent")
          throw new Error("Email draft was already sent");
        if (currentDraft.status === "sending")
          throw new Error("Email draft is already being sent");
        throw new Error("Email draft is not sendable");
      }

      try {
        const account = await EmailAccountModel.findById(
          draft.accountId,
        ).lean<ILeanEmailAccount | null>();
        if (!account) throw new Error("Email account not found");

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
  },
  {
    schema: {
      name: "sync_email_accounts",
      description:
        "Fetch new mail over IMAP. Syncs one account when accountId is given, otherwise every account. Reaches the mail server, so it takes seconds per account — call it when mail looks stale, not before every read.",
      input_schema: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description: "Sync only this account. Omit to sync all of them.",
          },
        },
      },
    },
    isWrite: true,
    category: "email",
    execute: async (input) => {
      await connectDB();
      const accountId = input.accountId as string | undefined;
      if (accountId && !mongoose.Types.ObjectId.isValid(accountId)) {
        throw new Error("Invalid account ID");
      }
      // Hydrated, not lean: syncInbox takes a document.
      const accounts = accountId
        ? await EmailAccountModel.find({ _id: accountId })
        : await EmailAccountModel.find();
      if (accounts.length === 0) {
        throw new Error(
          accountId ? "Email account not found" : "No email accounts",
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
  },
];
