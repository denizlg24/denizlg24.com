"use client";

import type { FinanceCategory } from "@repo/schemas";
import { SearchSelect } from "@repo/ui/search-select";
import { useMemo } from "react";

const NONE = "__none__";

/**
 * Picks a category name. The vocabulary is managed in the Settings tab, so this
 * only ever chooses from the catalog — plus whatever the classifier assigned to
 * the current row, which is folded in so an LLM-set value is never silently
 * dropped by editing something else.
 */
export function CategoryField({
  value,
  onValueChange,
  categories,
  extra,
  disabled,
  id,
}: {
  value: string | undefined;
  onValueChange: (value: string | undefined) => void;
  categories: FinanceCategory[];
  extra?: string;
  disabled?: boolean;
  id?: string;
}) {
  const options = useMemo(() => {
    const names = new Set(categories.map((category) => category.name));
    if (extra) names.add(extra);
    if (value) names.add(value);
    return [
      { value: NONE, label: "Uncategorized" },
      ...[...names]
        .sort((left, right) => left.localeCompare(right))
        .map((name) => ({ value: name, label: name })),
    ];
  }, [categories, extra, value]);

  return (
    <SearchSelect
      id={id}
      aria-label="Category"
      value={value ?? NONE}
      onValueChange={(next) => onValueChange(next === NONE ? undefined : next)}
      options={options}
      placeholder="Uncategorized"
      searchPlaceholder="Search categories"
      emptyLabel="No category"
      disabled={disabled}
    />
  );
}
