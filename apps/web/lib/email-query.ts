import { EMAIL_QUERY_CANDIDATE_LIMIT, type EmailQuery } from "@repo/schemas";
import mongoose from "mongoose";
import { queryEmailMailbox } from "@/lib/email";
import { connectDB } from "@/lib/mongodb";
import {
  EmailAccountModel,
  type ILeanEmailAccount,
} from "@/models/EmailAccount";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class EmailAccountNotFoundError extends Error {
  constructor(accountRef: string) {
    super(`No email account matches "${accountRef}"`);
    this.name = "EmailAccountNotFoundError";
  }
}

type QueriedAccount =
  | {
      account: ILeanEmailAccount;
      result: Awaited<ReturnType<typeof queryEmailMailbox>>;
    }
  | { account: ILeanEmailAccount; error: string };

/**
 * Fans the search out to every matching account and merges the pages newest
 * first. An account that cannot be reached is reported under `failures`
 * rather than failing the whole query.
 */
export async function queryEmailAccounts(input: EmailQuery) {
  await connectDB();
  const accountRef = input.account;
  const accountFilter = accountRef
    ? {
        $or: [
          ...(mongoose.Types.ObjectId.isValid(accountRef)
            ? [{ _id: accountRef }]
            : []),
          { user: new RegExp(`^${escapeRegex(accountRef)}$`, "i") },
          { displayName: new RegExp(`^${escapeRegex(accountRef)}$`, "i") },
        ],
      }
    : {};
  const accounts =
    await EmailAccountModel.find(accountFilter).lean<ILeanEmailAccount[]>();
  if (accountRef && accounts.length === 0) {
    throw new EmailAccountNotFoundError(accountRef);
  }

  const candidateLimit = Math.min(
    EMAIL_QUERY_CANDIDATE_LIMIT,
    input.offset + input.limit,
  );
  const settled: QueriedAccount[] = await Promise.all(
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
    (entry): entry is Extract<QueriedAccount, { result: unknown }> =>
      "result" in entry,
  );
  const total = Math.min(
    EMAIL_QUERY_CANDIDATE_LIMIT,
    successful.reduce((sum, entry) => sum + entry.result.total, 0),
  );
  const sliceEnd = Math.min(
    EMAIL_QUERY_CANDIDATE_LIMIT,
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
    nextOffset < EMAIL_QUERY_CANDIDATE_LIMIT;

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
}
