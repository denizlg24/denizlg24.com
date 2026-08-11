"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import type { ForgeContainer } from "@repo/schemas/cloud";
import { OptionSelect } from "@repo/ui/option-select";

/**
 * A short label for a container in a picker: the branch it is serving, or the
 * kind when the container carries no ref. Two previews of the same project are
 * otherwise indistinguishable, which is the whole reason the picker exists.
 */
export function containerLabel(container: ForgeContainer): string {
  const kind = container.kind ?? "container";
  return `${kind} · ${container.name} · ${formatRelative(container.createdAt)}`;
}

export function ContainerSelect({
  containers,
  selected,
  onSelect,
  allLabel,
}: {
  containers: readonly ForgeContainer[];
  /** `null` is the aggregate across every container behind the project. */
  selected: string | null;
  onSelect: (containerId: string | null) => void;
  allLabel?: string;
}) {
  if (containers.length === 0) return null;

  return (
    <OptionSelect
      className="h-7 max-w-72"
      aria-label="Container"
      value={selected}
      onValueChange={onSelect}
      {...(allLabel ? { emptyLabel: allLabel } : {})}
      options={containers.map((container) => ({
        value: container.id,
        label: containerLabel(container),
      }))}
    />
  );
}
