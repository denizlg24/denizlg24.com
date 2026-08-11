"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import type { ForgeContainer } from "@repo/schemas/cloud";
import { NativeSelect, NativeSelectOption } from "@repo/ui/native-select";

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
    <NativeSelect
      className="h-7 w-auto max-w-72 text-xs"
      value={selected ?? ""}
      onChange={(event) => onSelect(event.target.value || null)}
      aria-label="Container"
    >
      {allLabel ? (
        <NativeSelectOption value="">{allLabel}</NativeSelectOption>
      ) : null}
      {containers.map((container) => (
        <NativeSelectOption key={container.id} value={container.id}>
          {containerLabel(container)}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}
