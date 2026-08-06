import mongoose from "mongoose";
import { type FetchedEmailBody, fetchEmailBodies } from "@/lib/email";
import { BODY_MAX_CHARS, EmailBodyModel } from "@/models/EmailBody";

export interface StoredEmailBody {
  text: string;
  html: string;
  attachmentCount: number;
  truncated: boolean;
}

export interface EmailBodyRef {
  emailId: string;
  accountId: string;
  uid: number;
}

function clamp(value: string): { value: string; truncated: boolean } {
  return value.length > BODY_MAX_CHARS
    ? { truncated: true, value: value.slice(0, BODY_MAX_CHARS) }
    : { truncated: false, value };
}

/**
 * Persists bodies the caller already has in hand.
 *
 * Upsert rather than insert: a resync re-parses the same UID, and the newer
 * parse is the one worth keeping. Failures are swallowed by the caller's
 * choice, not here — a body that fails to store is a slow open later, never a
 * failed triage run.
 */
export async function saveEmailBodies(
  entries: { ref: EmailBodyRef; body: FetchedEmailBody }[],
): Promise<number> {
  if (entries.length === 0) return 0;
  const now = new Date();
  const operations = entries.map(({ body, ref }) => {
    const text = clamp(body.text);
    const html = clamp(body.html);
    return {
      updateOne: {
        filter: { emailId: new mongoose.Types.ObjectId(ref.emailId) },
        update: {
          $set: {
            accountId: new mongoose.Types.ObjectId(ref.accountId),
            attachmentCount: body.attachmentCount,
            fetchedAt: now,
            html: html.value,
            text: text.value,
            truncated: text.truncated || html.truncated,
            uid: ref.uid,
          },
        },
        upsert: true,
      },
    };
  });
  const result = await EmailBodyModel.bulkWrite(operations, {
    ordered: false,
  });
  return result.upsertedCount + result.modifiedCount;
}

export async function loadEmailBody(
  emailId: string | mongoose.Types.ObjectId,
): Promise<StoredEmailBody | null> {
  const stored = await EmailBodyModel.findOne({ emailId })
    .select("text html attachmentCount truncated")
    .lean();
  if (!stored) return null;
  return {
    attachmentCount: stored.attachmentCount,
    html: stored.html,
    text: stored.text,
    truncated: stored.truncated,
  };
}

export async function loadEmailBodies(
  emailIds: readonly (string | mongoose.Types.ObjectId)[],
): Promise<Set<string>> {
  if (emailIds.length === 0) return new Set();
  const stored = await EmailBodyModel.find({ emailId: { $in: emailIds } })
    .select("emailId")
    .lean();
  return new Set(stored.map((row) => String(row.emailId)));
}

/**
 * Reads a body from Mongo, falling back to IMAP once and storing what it gets.
 *
 * The fallback is what makes the backlog usable: bodies are only recorded from
 * the moment triage started saving them, and re-fetching every old email up
 * front would be a multi-hour IMAP session. Paying it lazily means one slow
 * open per old email instead of one per open, forever.
 */
export async function readEmailBody(
  ref: EmailBodyRef,
): Promise<StoredEmailBody | null> {
  const stored = await loadEmailBody(ref.emailId);
  if (stored) return stored;

  const { bodies } = await fetchEmailBodies(ref.accountId, [ref.uid]);
  const fetched = bodies.get(ref.uid);
  if (!fetched) return null;

  await saveEmailBodies([{ body: fetched, ref }]).catch((error) => {
    console.error("Failed to store email body", error);
  });
  return {
    attachmentCount: fetched.attachmentCount,
    html: clamp(fetched.html).value,
    text: clamp(fetched.text).value,
    truncated: false,
  };
}

/**
 * Fetches and stores every missing body for a set of emails on one IMAP
 * connection.
 *
 * `fetchEmailBodies` connects and logs out per call, so warming a page of
 * twelve one at a time is twelve logins. Grouped by account because a
 * connection is per account, and the list view mixes them.
 */
export async function warmEmailBodies(
  refs: readonly EmailBodyRef[],
): Promise<{ warmed: number; alreadyStored: number }> {
  if (refs.length === 0) return { alreadyStored: 0, warmed: 0 };
  const present = await loadEmailBodies(refs.map((ref) => ref.emailId));
  const missing = refs.filter((ref) => !present.has(ref.emailId));
  if (missing.length === 0) {
    return { alreadyStored: present.size, warmed: 0 };
  }

  const byAccount = new Map<string, EmailBodyRef[]>();
  for (const ref of missing) {
    const group = byAccount.get(ref.accountId);
    if (group) group.push(ref);
    else byAccount.set(ref.accountId, [ref]);
  }

  let warmed = 0;
  for (const [accountId, group] of byAccount) {
    try {
      const { bodies } = await fetchEmailBodies(
        accountId,
        group.map((ref) => ref.uid),
      );
      const entries = group.flatMap((ref) => {
        const body = bodies.get(ref.uid);
        return body ? [{ body, ref }] : [];
      });
      warmed += await saveEmailBodies(entries);
    } catch (error) {
      // One unreachable account must not stop the others, and a warm that
      // fails costs a slow open rather than a broken page.
      console.error(`Failed to warm bodies for account ${accountId}`, error);
    }
  }
  return { alreadyStored: present.size, warmed };
}
