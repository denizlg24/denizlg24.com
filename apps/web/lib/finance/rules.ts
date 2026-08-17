import type { FinanceRecurringRuleInput } from "@repo/schemas";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceLedgerEntry,
  FinanceRecurringRule,
  type IFinanceRecurringRule,
} from "@/models/Finance";
import { materializeRecurringFinanceEntries } from "./ledger";

/**
 * Recurring-rule CRUD.
 *
 * Every mutation re-materializes the projected ledger, because a rule only
 * matters through the `expected` rows it produces: changing the amount or the
 * cadence without re-projecting leaves a forecast built from the old rule and
 * no signal that it is stale.
 */

export async function listFinanceRecurringRules() {
  await connectDB();
  return FinanceRecurringRule.find().sort({ name: 1 });
}

export async function createFinanceRecurringRule(
  input: FinanceRecurringRuleInput,
) {
  await connectDB();
  const session = await mongoose.startSession();
  let rule: IFinanceRecurringRule | undefined;
  try {
    // The insert and the projection share a transaction so a failure part-way
    // cannot leave a rule with no expected rows behind it.
    await session.withTransaction(async () => {
      const [created] = await FinanceRecurringRule.create([input], { session });
      rule = created;
      await materializeRecurringFinanceEntries(new Date(), {
        session,
        skipSuggestions: true,
      });
    });
  } finally {
    await session.endSession();
  }
  return rule ?? null;
}

export async function updateFinanceRecurringRule(
  id: string,
  input: Partial<FinanceRecurringRuleInput>,
) {
  await connectDB();
  const rule = await FinanceRecurringRule.findByIdAndUpdate(
    id,
    { $set: input },
    { returnDocument: "after", runValidators: true },
  );
  if (!rule) return null;
  await materializeRecurringFinanceEntries();
  return rule;
}

/**
 * Deletes a rule and voids the rows it projected. The projected rows are not
 * hard-deleted: `void` keeps them out of the forecast while leaving anything a
 * real transaction already matched against intact.
 */
export async function deleteFinanceRecurringRule(id: string) {
  await connectDB();
  const rule = await FinanceRecurringRule.findByIdAndDelete(id);
  if (!rule) return null;
  await FinanceLedgerEntry.updateMany(
    { recurringRuleId: rule._id, state: { $in: ["expected", "missed"] } },
    { $set: { state: "void" } },
  );
  return rule;
}
