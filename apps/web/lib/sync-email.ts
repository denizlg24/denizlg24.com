import { simpleParser } from "mailparser";
import type { Types } from "mongoose";
import { EmailAccountModel, type IEmailAccount } from "@/models/EmailAccount";
import { createImapClient, type FetchedEmailBody, saveEmail } from "./email";
import { saveEmailBodies } from "./email-body-store";
import { decryptPassword } from "./safe-email-password";

/**
 * `source` is fetched alongside the envelope so a message's body is stored the
 * moment it arrives. Without it every later open pays a fresh IMAP connect,
 * login, mailbox lock and fetch — thirty seconds to render one email — and the
 * bytes were already on the wire during this sync anyway.
 */
const FETCH_QUERY = {
  envelope: true,
  flags: true,
  source: true,
  uid: true,
} as const;

/**
 * How many parsed bodies are held before they are written.
 *
 * The incremental branch fetches `${lastUid + 1}:*`, which is unbounded — after
 * an outage that range is thousands of messages. Holding every `text` and
 * `html` until the loop ended grew memory with the mailbox and delayed the
 * `lastUid` update behind one enormous write.
 */
const BODY_FLUSH_THRESHOLD = 25;

async function parseBody(
  source: Buffer | undefined,
): Promise<FetchedEmailBody | null> {
  if (!source) return null;
  try {
    const parsed = await simpleParser(source);
    return {
      attachmentCount: parsed.attachments?.length ?? 0,
      attachmentText: [],
      date: parsed.date ?? new Date(),
      from: (parsed.from?.value ?? []).map((address) => ({
        address: address.address ?? "",
        name: address.name || undefined,
      })),
      html: typeof parsed.html === "string" ? parsed.html : "",
      subject: parsed.subject ?? "",
      text: parsed.text ?? "",
    };
  } catch (error) {
    console.error("Failed to parse email body during sync:", error);
    return null;
  }
}

export async function syncInbox(account: IEmailAccount) {
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

  const lastUid = account.lastUid ?? 0;
  let highestUid = lastUid;
  const emailIds: Types.ObjectId[] = [];
  const pendingBodies: {
    ref: { emailId: string; accountId: string; uid: number };
    body: FetchedEmailBody;
  }[] = [];

  // Best-effort by design: a body that fails to store costs a slow first open,
  // and failing the sync over it would stall `lastUid` and make the same
  // messages arrive again on the next run.
  const flushBodies = async (force: boolean) => {
    if (pendingBodies.length === 0) return;
    if (!force && pendingBodies.length < BODY_FLUSH_THRESHOLD) return;
    const batch = pendingBodies.splice(0, pendingBodies.length);
    await saveEmailBodies(batch).catch((error) => {
      console.error("Failed to store synced email bodies:", error);
    });
  };

  const lock = await client.getMailboxLock(account.inboxName || "INBOX");
  try {
    let messageCount = 0;

    if (lastUid === 0) {
      console.log("Initial sync: determining last 50 messages");

      const status = await client.status(account.inboxName || "INBOX", {
        messages: true,
      });

      const totalMessages = status.messages || 0;

      if (totalMessages === 0) {
        console.log("No messages in mailbox");
        return 0;
      }

      const startSeq = Math.max(1, totalMessages - 49);
      const endSeq = totalMessages;

      console.log(
        `Fetching last 50 messages: seq ${startSeq}:${endSeq} (total: ${totalMessages})`,
      );

      const messages = client.fetch(`${startSeq}:${endSeq}`, FETCH_QUERY, {
        uid: false,
      });

      for await (const msg of messages) {
        messageCount++;
        console.log(`Processing email UID: ${msg.uid}`);

        const seen = !!msg.flags?.has("\\Seen");
        if (!msg.envelope) {
          console.log(`Skipping message ${msg.uid}: no envelope`);
          continue;
        }

        try {
          const email = await saveEmail({
            accountId: account._id,
            messageId: msg.envelope.messageId || msg.uid.toString(),
            subject: msg.envelope.subject || "(No Subject)",
            from: msg.envelope.from || [],
            date: msg.envelope.date || new Date(),
            seen,
            uid: msg.uid,
            inReplyTo: msg.envelope.inReplyTo || undefined,
          });

          emailIds.push(email._id);
          const body = await parseBody(msg.source);
          if (body) {
            pendingBodies.push({
              body,
              ref: {
                accountId: account._id.toString(),
                emailId: email._id.toString(),
                uid: msg.uid,
              },
            });
          }

          if (msg.uid > highestUid) {
            highestUid = msg.uid;
          }
          await flushBodies(false);
        } catch (error) {
          console.error(`Error saving email UID ${msg.uid}:`, error);
        }
      }
    } else {
      console.log(
        `Incremental sync: fetching messages with UID ${lastUid + 1}:*`,
      );

      const messages = client.fetch(`${lastUid + 1}:*`, FETCH_QUERY, {
        uid: true,
      });

      for await (const msg of messages) {
        messageCount++;
        console.log(`Processing email UID: ${msg.uid}`);
        if (msg.uid <= lastUid) {
          console.log(`Skipping already synced message UID: ${msg.uid}`);
          continue;
        }
        const seen = !!msg.flags?.has("\\Seen");
        if (!msg.envelope) {
          console.log(`Skipping message ${msg.uid}: no envelope`);
          continue;
        }

        try {
          const email = await saveEmail({
            accountId: account._id,
            messageId: msg.envelope.messageId || msg.uid.toString(),
            subject: msg.envelope.subject || "(No Subject)",
            from: msg.envelope.from || [],
            date: msg.envelope.date || new Date(),
            seen,
            uid: msg.uid,
            inReplyTo: msg.envelope.inReplyTo || undefined,
          });

          emailIds.push(email._id);
          const body = await parseBody(msg.source);
          if (body) {
            pendingBodies.push({
              body,
              ref: {
                accountId: account._id.toString(),
                emailId: email._id.toString(),
                uid: msg.uid,
              },
            });
          }

          if (msg.uid > highestUid) {
            highestUid = msg.uid;
          }
          await flushBodies(false);
        } catch (error) {
          console.error(`Error saving email UID ${msg.uid}:`, error);
        }
      }
    }

    console.log(`Synced ${messageCount} messages. Highest UID: ${highestUid}`);

    await flushBodies(true);

    if (emailIds.length > 0) {
      await EmailAccountModel.findByIdAndUpdate(account._id, {
        $addToSet: { emails: { $each: emailIds } },
        lastUid: highestUid,
      });
      console.log(`Updated account with ${emailIds.length} email references`);
    }
  } finally {
    lock.release();
  }

  await client.logout();
  return highestUid;
}
