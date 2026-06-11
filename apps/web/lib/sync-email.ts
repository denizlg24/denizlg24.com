import { EmailAccountModel, type IEmailAccount } from "@/models/EmailAccount";
import { createImapClient, saveEmail } from "./email";
import { decryptPassword } from "./safe-email-password";

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
  const emailIds: string[] = [];

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

      const messages = client.fetch(
        `${startSeq}:${endSeq}`,
        {
          envelope: true,
          flags: true,
          uid: true,
        },
        { uid: false },
      );

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

          emailIds.push(email._id.toString());

          if (msg.uid > highestUid) {
            highestUid = msg.uid;
          }
        } catch (error) {
          console.error(`Error saving email UID ${msg.uid}:`, error);
        }
      }
    } else {
      console.log(
        `Incremental sync: fetching messages with UID ${lastUid + 1}:*`,
      );

      const messages = client.fetch(
        `${lastUid + 1}:*`,
        {
          envelope: true,
          flags: true,
          uid: true,
        },
        { uid: true },
      );

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

          emailIds.push(email._id.toString());

          if (msg.uid > highestUid) {
            highestUid = msg.uid;
          }
        } catch (error) {
          console.error(`Error saving email UID ${msg.uid}:`, error);
        }
      }
    }

    console.log(`Synced ${messageCount} messages. Highest UID: ${highestUid}`);

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
