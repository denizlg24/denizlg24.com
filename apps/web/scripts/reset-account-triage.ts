/**
 * Drops the triage rows for one account so a later run re-triages its mail.
 *
 * `runTriage` picks candidates by anti-joining against `emailtriages`, so an
 * email that has been triaged once is never looked at again — a change to the
 * classification gates or the course matcher does not reach anything already
 * processed. Deleting the rows is what makes those emails candidates again.
 *
 * Rows carrying an accepted suggestion are left alone. Accepting one created a
 * kanban card, a calendar event or a course deadline, and the row is the only
 * record tying that artifact to the email it came from; deleting it would strand
 * the artifact and let the re-run propose the same thing a second time.
 *
 * The delete alone changes nothing. Candidates are also windowed by
 * `createdAt >= since`, which defaults to the last run, so the follow-up run
 * needs an explicit `--since` reaching back past the oldest email freed here —
 * the command is printed at the end.
 *
 *   bun --env-file=../../.env scripts/reset-account-triage.ts --account=<email|id>
 */
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { EmailModel } from "@/models/Email";
import { EmailAccountModel } from "@/models/EmailAccount";
import { EmailTriageModel } from "@/models/EmailTriage";

const accountArg = process.argv
  .find((arg) => arg.startsWith("--account="))
  ?.split("=")[1];
if (!accountArg) {
  throw new Error(
    "--account=<email|id> is required; there is no all-accounts mode",
  );
}

await connectDB();

const account = mongoose.Types.ObjectId.isValid(accountArg)
  ? await EmailAccountModel.findById(accountArg).select("user").lean()
  : await EmailAccountModel.findOne({ user: accountArg }).select("user").lean();
if (!account) throw new Error(`No email account matches ${accountArg}`);

const rows = await EmailTriageModel.find({ accountId: account._id })
  .select("_id emailId suggestedTasks suggestedEvents")
  .lean();

const accepted = rows.filter((row) =>
  [...(row.suggestedTasks ?? []), ...(row.suggestedEvents ?? [])].some(
    (suggestion) => suggestion.status === "accepted",
  ),
);
const removable = rows.filter((row) => !accepted.includes(row));

const deleted = removable.length
  ? await EmailTriageModel.deleteMany({
      _id: { $in: removable.map((row) => row._id) },
    })
  : { deletedCount: 0 };

const [oldest] = await EmailModel.find({
  _id: { $in: removable.map((row) => row.emailId) },
})
  .select("date createdAt")
  .sort({ date: 1 })
  .limit(1)
  .lean();

console.log(
  JSON.stringify({
    account: account.user,
    triageRows: rows.length,
    deleted: deleted.deletedCount,
    keptAccepted: accepted.length,
  }),
);
if (oldest) {
  const since = new Date(oldest.date ?? oldest.createdAt);
  since.setUTCDate(since.getUTCDate() - 1);
  console.log(
    `Re-run with: bun run triage:backfill --since ${since.toISOString().slice(0, 10)}`,
  );
}

await mongoose.disconnect();
