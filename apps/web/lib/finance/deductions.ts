import type { FinanceDeductionProfileInput } from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceDeductionProfile,
  FinanceRecurringRule,
} from "@/models/Finance";
import { materializeRecurringFinanceEntries } from "./ledger";

/**
 * Reusable deduction profiles. A profile only matters through the payouts
 * that use it, so an edit re-projects them the same way a rule edit does.
 */

export class FinanceDeductionProfileInUseError extends Error {
  constructor(readonly ruleNames: string[]) {
    super(`Used by ${ruleNames.join(", ")}`);
    this.name = "FinanceDeductionProfileInUseError";
  }
}

async function reprojectIfUsed(profileId: string) {
  const used = await FinanceRecurringRule.exists({
    "payout.deductionProfileId": profileId,
  });
  if (used) await materializeRecurringFinanceEntries();
}

export async function listFinanceDeductionProfiles() {
  await connectDB();
  return FinanceDeductionProfile.find().sort({ name: 1 });
}

export async function createFinanceDeductionProfile(
  input: FinanceDeductionProfileInput,
) {
  await connectDB();
  return FinanceDeductionProfile.create(input);
}

export async function updateFinanceDeductionProfile(
  id: string,
  input: Partial<FinanceDeductionProfileInput>,
) {
  await connectDB();
  const profile = await FinanceDeductionProfile.findByIdAndUpdate(
    id,
    { $set: input },
    { returnDocument: "after", runValidators: true },
  );
  if (!profile) return null;
  await reprojectIfUsed(id);
  return profile;
}

/** Refuses while a payout still names the profile: silently dropping it
 *  would turn that payout's net into its gross. */
export async function deleteFinanceDeductionProfile(id: string) {
  await connectDB();
  const users = await FinanceRecurringRule.find({
    "payout.deductionProfileId": id,
  }).select("name");
  if (users.length > 0) {
    throw new FinanceDeductionProfileInUseError(users.map((rule) => rule.name));
  }
  return FinanceDeductionProfile.findByIdAndDelete(id);
}
