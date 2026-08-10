"use client";

import { TableCell, TableRow } from "@repo/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import type { ProjectGroup } from "./project-groups";
import { ProjectPicker } from "./project-picker";

/**
 * The project filter and the collapsible group header, shared by every grouped
 * list. Extracted because the containers and images pages had identical copies
 * down to the class strings, and a filter that drifts between two views of the
 * same data is the kind of difference nobody notices until it misleads.
 */
function pill(active: boolean): string {
  return active
    ? "rounded-full bg-foreground px-2 py-0.5 text-[11px] text-background transition-colors"
    : "rounded-full px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground";
}

/**
 * Resolves the filter against what is actually on screen.
 *
 * A slug held in state outlives the data it came from: a project whose last
 * container stops disappears from the poll, and a filter still pointing at it
 * leaves an empty list — with the pills hidden too, once only one project is
 * left, so there is nothing left to click to escape. Falling back to unfiltered
 * makes that self-correcting.
 */
export function activeProject<T>(
  groups: readonly ProjectGroup<T>[],
  selected: string | null,
): string | null {
  if (selected === null) return null;
  return groups.some((group) => group.projectSlug === selected)
    ? selected
    : null;
}

/**
 * Above this many projects the pills stop being a filter and start being a
 * wall: they wrap into several rows that push the data off the fold, and
 * finding one slug means reading every slug. Below it, pills are strictly
 * better than a picker — one click, everything visible, nothing to open.
 */
export const MAX_PILLS = 6;

export function ProjectFilter<T>({
  groups,
  selected,
  onSelect,
}: {
  groups: readonly ProjectGroup<T>[];
  selected: string | null;
  onSelect: (slug: string | null) => void;
}) {
  if (groups.length < 2) return null;
  const active = activeProject(groups, selected);

  if (groups.length > MAX_PILLS) {
    return (
      <div className="flex items-center gap-2">
        <ProjectPicker
          options={groups.map((group) => ({
            slug: group.projectSlug,
            detail: String(group.all.length),
          }))}
          selected={active}
          onSelect={onSelect}
          allLabel={`all projects · ${groups.length}`}
        />
        {active === null ? null : (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          >
            clear
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <button
        type="button"
        aria-pressed={active === null}
        onClick={() => onSelect(null)}
        className={pill(active === null)}
      >
        all
      </button>
      {groups.map((group) => (
        <button
          key={group.projectSlug}
          type="button"
          aria-pressed={active === group.projectSlug}
          onClick={() => onSelect(group.projectSlug)}
          className={pill(active === group.projectSlug)}
        >
          {group.projectSlug}
        </button>
      ))}
    </div>
  );
}

export function ProjectGroupRow({
  slug,
  detail,
  columns,
  collapsed,
  onToggle,
}: {
  slug: string;
  detail: ReactNode;
  columns: number;
  /** Omitted for a list whose groups do not collapse. */
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const label = (
    <>
      {slug}
      <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
        {detail}
      </span>
    </>
  );
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={columns} className="py-1.5">
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            className="flex items-center gap-1.5 text-xs font-medium"
          >
            {collapsed ? (
              <ChevronRight className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            )}
            {label}
          </button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium">
            {label}
          </span>
        )}
      </TableCell>
    </TableRow>
  );
}
