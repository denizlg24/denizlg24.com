import mongoose from "mongoose";
import { sanitizeMessagesForStorage } from "@/lib/agent/evidence-units";
import { isLegacyConversation } from "@/lib/agent/legacy";
import { storedMessagesToUI } from "@/lib/conversations";
import { connectDB } from "@/lib/mongodb";
import { Conversation } from "@/models/Conversation";

/**
 * Rewrites threads stored by the Anthropic-SDK loop as AI SDK UI messages.
 * Reads already convert on the fly and the next save rewrites a thread, so
 * this only settles the rest at once. Evidence is not re-observed: the
 * converted ids are derived from the stored event ids, and the conversation
 * store treats every part that was already there as seen.
 */

interface Options {
  apply: boolean;
  limit: number;
}

function parseOptions(args: string[]): Options {
  const options: Options = { apply: false, limit: Number.POSITIVE_INFINITY };
  for (const argument of args) {
    if (argument === "--apply") options.apply = true;
    else if (argument.startsWith("--limit=")) {
      options.limit = Number(argument.slice("--limit=".length));
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Conversation format migration

Usage:
  bun --env-file=../../.env scripts/migrate-conversations-to-ui.ts
  bun --env-file=../../.env scripts/migrate-conversations-to-ui.ts --apply [--limit=N]

Options:
  --apply    Perform writes (default is dry-run)
  --limit=N  Convert at most N threads`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (Number.isNaN(options.limit) || options.limit < 1) {
    throw new Error("--limit must be a positive number");
  }
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  await connectDB();
  const totals = {
    scanned: 0,
    converted: 0,
    messagesBefore: 0,
    messagesAfter: 0,
  };
  const cursor = Conversation.find({ format: { $ne: "ui" } })
    .select("format messages")
    .sort({ _id: 1 })
    .lean()
    .cursor();

  for await (const conversation of cursor) {
    if (totals.converted >= options.limit) break;
    totals.scanned += 1;
    if (!isLegacyConversation(conversation.format)) continue;
    const messages = sanitizeMessagesForStorage(
      storedMessagesToUI(conversation),
    );
    totals.converted += 1;
    totals.messagesBefore += conversation.messages.length;
    totals.messagesAfter += messages.length;
    if (!options.apply) continue;
    await Conversation.updateOne(
      { _id: conversation._id, format: { $ne: "ui" } },
      { $set: { messages, format: "ui" } },
      { timestamps: false },
    );
  }

  console.log(
    JSON.stringify({ mode: options.apply ? "apply" : "dry-run", ...totals }),
  );
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect();
  process.exit(1);
});
