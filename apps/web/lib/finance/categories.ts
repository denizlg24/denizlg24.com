import type { FinanceCategoryInput } from "@repo/schemas";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import {
  FINANCE_CATEGORY_COLLATION,
  FinanceCategory,
  FinanceLedgerEntry,
  FinanceMerchant,
  type IFinanceCategory,
} from "@/models/Finance";

/**
 * The category catalog.
 *
 * Ledger rows and merchants store the category *name*, not a reference, so a
 * rename has to cascade. That is deliberate: it keeps the LLM classifier
 * contract (it emits names) and needs no migration of rows written before the
 * catalog existed.
 */

export class FinanceCategoryConflictError extends Error {
  constructor(name: string) {
    super(`A category named "${name}" already exists`);
    this.name = "FinanceCategoryConflictError";
  }
}

export async function listFinanceCategories() {
  await connectDB();
  return FinanceCategory.find().sort({ sortOrder: 1, name: 1 });
}

export async function createFinanceCategory(input: FinanceCategoryInput) {
  await connectDB();
  const existing = await findCategoryByName(input.name);
  if (existing) throw new FinanceCategoryConflictError(input.name);
  const highest = await FinanceCategory.findOne().sort({ sortOrder: -1 });
  try {
    return await FinanceCategory.create({
      name: input.name,
      color: input.color,
      sortOrder: input.sortOrder ?? (highest?.sortOrder ?? 0) + 1,
    });
  } catch (error) {
    // The check above cannot be atomic with the insert, so a concurrent create
    // (a manual one racing the classifier's ensure) lands here instead.
    if (isDuplicateKeyError(error)) {
      throw new FinanceCategoryConflictError(input.name);
    }
    throw error;
  }
}

export async function updateFinanceCategory(
  id: string,
  input: Partial<FinanceCategoryInput>,
) {
  await connectDB();
  const session = await mongoose.startSession();
  let updated: IFinanceCategory | null = null;
  try {
    await session.withTransaction(async () => {
      const category = await FinanceCategory.findById(id).session(session);
      if (!category) {
        updated = null;
        return;
      }

      const previousName = category.name;
      if (input.name !== undefined && input.name !== previousName) {
        const clash = await findCategoryByName(input.name, {
          excludeId: category._id,
          session,
        });
        if (clash) throw new FinanceCategoryConflictError(input.name);
        category.name = input.name;
      }
      if (input.color !== undefined) category.color = input.color;
      if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;
      await category.save({ session });

      // The cascade commits with the rename. Splitting them would let a failure
      // in between leave rows pointing at a name the catalog no longer holds —
      // exactly the orphaning this module promises cannot happen.
      if (category.name !== previousName) {
        await Promise.all([
          FinanceLedgerEntry.updateMany(
            { category: previousName },
            { $set: { category: category.name } },
            { session },
          ),
          FinanceMerchant.updateMany(
            { category: previousName },
            { $set: { category: category.name } },
            { session },
          ),
        ]);
      }
      updated = category;
    });
  } finally {
    await session.endSession();
  }
  return updated;
}

/**
 * Deletes a category. Rows carrying it are either moved to `reassignTo` or left
 * uncategorized — never orphaned onto a name with no catalog entry.
 */
export async function deleteFinanceCategory(
  id: string,
  options: { reassignTo?: string } = {},
) {
  await connectDB();
  const category = await FinanceCategory.findById(id);
  if (!category) return null;

  let target: string | undefined;
  if (options.reassignTo) {
    const replacement = await findCategoryByName(options.reassignTo, {
      excludeId: category._id,
    });
    if (!replacement) throw new Error("Replacement category not found");
    target = replacement.name;
  }

  const update = target
    ? { $set: { category: target } }
    : { $unset: { category: "" } };
  await Promise.all([
    FinanceLedgerEntry.updateMany({ category: category.name }, update),
    FinanceMerchant.updateMany({ category: category.name }, update),
  ]);
  await category.deleteOne();
  return { name: category.name, reassignedTo: target };
}

/**
 * Records a category name the classifier produced so it joins the catalog the
 * UI offers. Without this, LLM-assigned categories would be invisible to
 * category management and could never be renamed or merged.
 */
export async function ensureFinanceCategories(names: string[]) {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (unique.length === 0) return;
  await connectDB();
  const highest = await FinanceCategory.findOne().sort({ sortOrder: -1 });
  let sortOrder = (highest?.sortOrder ?? 0) + 1;
  for (const name of unique) {
    const existing = await findCategoryByName(name);
    if (existing) continue;
    try {
      await FinanceCategory.create({ name, sortOrder });
    } catch (error) {
      // Another sync run or a manual create got there first; that is the
      // outcome this wanted anyway.
      if (!isDuplicateKeyError(error)) throw error;
      continue;
    }
    sortOrder += 1;
  }
}

/**
 * Case-insensitive name lookup through the collated unique index. An anchored
 * `RegExp` would be equivalent but not index-eligible, making every create and
 * every `ensureFinanceCategories` name a collection scan.
 */
function findCategoryByName(
  name: string,
  options: {
    excludeId?: mongoose.Types.ObjectId;
    session?: mongoose.ClientSession;
  } = {},
) {
  return FinanceCategory.findOne({
    name: name.trim(),
    ...(options.excludeId ? { _id: { $ne: options.excludeId } } : {}),
  })
    .collation(FINANCE_CATEGORY_COLLATION)
    .session(options.session ?? null);
}

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
