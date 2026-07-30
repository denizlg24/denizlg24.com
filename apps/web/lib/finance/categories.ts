import type { FinanceCategoryInput } from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import {
  FinanceCategory,
  FinanceLedgerEntry,
  FinanceMerchant,
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
  const existing = await FinanceCategory.findOne({
    name: caseInsensitive(input.name),
  });
  if (existing) throw new FinanceCategoryConflictError(input.name);
  const highest = await FinanceCategory.findOne().sort({ sortOrder: -1 });
  return FinanceCategory.create({
    name: input.name,
    color: input.color,
    sortOrder: input.sortOrder ?? (highest?.sortOrder ?? 0) + 1,
  });
}

export async function updateFinanceCategory(
  id: string,
  input: Partial<FinanceCategoryInput>,
) {
  await connectDB();
  const category = await FinanceCategory.findById(id);
  if (!category) return null;

  const previousName = category.name;
  if (input.name !== undefined && input.name !== previousName) {
    const clash = await FinanceCategory.findOne({
      _id: { $ne: category._id },
      name: caseInsensitive(input.name),
    });
    if (clash) throw new FinanceCategoryConflictError(input.name);
    category.name = input.name;
  }
  if (input.color !== undefined) category.color = input.color;
  if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;
  await category.save();

  if (category.name !== previousName) {
    await Promise.all([
      FinanceLedgerEntry.updateMany(
        { category: previousName },
        { $set: { category: category.name } },
      ),
      FinanceMerchant.updateMany(
        { category: previousName },
        { $set: { category: category.name } },
      ),
    ]);
  }
  return category;
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
    const replacement = await FinanceCategory.findOne({
      _id: { $ne: category._id },
      name: caseInsensitive(options.reassignTo),
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
    const existing = await FinanceCategory.findOne({
      name: caseInsensitive(name),
    });
    if (existing) continue;
    await FinanceCategory.create({ name, sortOrder });
    sortOrder += 1;
  }
}

function caseInsensitive(value: string) {
  return new RegExp(`^${escapeRegExp(value.trim())}$`, "i");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
