import type {
  FinancePayoutOverride,
  FinancePayoutOverrideInput,
  FinanceRecurringRuleInput,
} from "@repo/schemas";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceDeductionProfile,
  FinanceLedgerEntry,
  FinanceRecurringRule,
  type IFinanceRecurringRule,
} from "@/models/Finance";
import { WorkJob } from "@/models/WorkHours";
import { materializeRecurringFinanceEntries } from "./ledger";

/**
 * Recurring-rule CRUD.
 *
 * Every mutation re-materializes the projected ledger, because a rule only
 * matters through the `expected` rows it produces: changing the amount or the
 * cadence without re-projecting leaves a forecast built from the old rule and
 * no signal that it is stale.
 */

export class FinancePayoutRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancePayoutRuleError";
  }
}

/**
 * Normalizes a payout rule's input before it is stored: a payout is always
 * variable income, and an hours-backed one is in the job's currency — the
 * rate is, so a gross in any other unit would be a different number.
 */
async function preparePayoutInput<T extends Partial<FinanceRecurringRuleInput>>(
  input: T,
): Promise<T> {
  const payout = input.payout;
  if (!payout) return input;
  const next = { ...input, direction: "income", amountKind: "variable" } as T;
  if (payout.source.kind === "hours") {
    if (!mongoose.isValidObjectId(payout.source.jobId)) {
      throw new FinancePayoutRuleError("Unknown job");
    }
    const job = await WorkJob.findById(payout.source.jobId);
    if (!job) throw new FinancePayoutRuleError("Unknown job");
    next.currency = job.currency;
  }
  if (payout.deductionProfileId) {
    const exists =
      mongoose.isValidObjectId(payout.deductionProfileId) &&
      (await FinanceDeductionProfile.exists({
        _id: payout.deductionProfileId,
      }));
    if (!exists) throw new FinancePayoutRuleError("Unknown deduction profile");
  }
  return next;
}

export async function listFinanceRecurringRules() {
  await connectDB();
  return FinanceRecurringRule.find().sort({ name: 1 });
}

export async function createFinanceRecurringRule(
  rawInput: FinanceRecurringRuleInput,
) {
  await connectDB();
  const input = await preparePayoutInput(rawInput);
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
  rawInput: Partial<FinanceRecurringRuleInput>,
) {
  await connectDB();
  const input = await preparePayoutInput(rawInput);
  if (input.payout) {
    // Overrides are edited one payout at a time through their own route; a
    // rule save carries none and must not wipe the ones already recorded.
    const existing = await FinanceRecurringRule.findById(id).select("payout");
    input.payout = {
      ...input.payout,
      overrides: existing?.payout?.overrides ?? [],
    };
  }
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

/**
 * Sets or clears the hand correction on one payout. Fields sent as null are
 * cleared; an override left with nothing in it is removed outright, so the
 * payout goes back to being purely derived.
 */
export async function setFinancePayoutOverride(
  ruleId: string,
  payoutDate: string,
  input: FinancePayoutOverrideInput | null,
) {
  await connectDB();
  const rule = await FinanceRecurringRule.findById(ruleId);
  if (!rule?.payout) return null;
  const overrides = [...(rule.payout.overrides ?? [])];
  const index = overrides.findIndex((row) => row.payoutDate === payoutDate);
  const current: FinancePayoutOverride = overrides[index] ?? { payoutDate };
  const next: FinancePayoutOverride = { payoutDate };
  if (input) {
    for (const key of [
      "workedMinutes",
      "grossMinor",
      "netMinor",
      "note",
    ] as const) {
      const value = key in input ? input[key] : current[key];
      if (value !== null && value !== undefined && value !== "") {
        (next as Record<string, unknown>)[key] = value;
      }
    }
  }
  const empty = Object.keys(next).length === 1;
  if (index >= 0) {
    if (empty) overrides.splice(index, 1);
    else overrides[index] = next;
  } else if (!empty) {
    overrides.push(next);
  }
  overrides.sort((a, b) => a.payoutDate.localeCompare(b.payoutDate));
  await FinanceRecurringRule.updateOne(
    { _id: rule._id },
    { $set: { "payout.overrides": overrides } },
  );
  await materializeRecurringFinanceEntries();
  return FinanceRecurringRule.findById(rule._id);
}

/**
 * Re-projects every payout backed by a job after its hours or rate changed.
 * Best-effort by design: the hours were saved either way, and the next
 * projection run — any rule edit, sync or cron — recomputes the same figures.
 */
export async function refreshPayoutProjections(jobId: string) {
  try {
    await connectDB();
    const linked = await FinanceRecurringRule.exists({
      "payout.source.kind": "hours",
      "payout.source.jobId": jobId,
    });
    if (!linked) return;
    await materializeRecurringFinanceEntries();
  } catch (error) {
    console.warn("[finance] Payout projection refresh failed", error);
  }
}
