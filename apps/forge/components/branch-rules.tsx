"use client";

import type {
  BranchRoutePreview,
  DeployBranchMatchType,
  DeployBranchRule,
  DeployEnvironmentListEntry,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { OptionSelect } from "@repo/ui/option-select";
import { Switch } from "@repo/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

const MATCH_TYPES: readonly { value: DeployBranchMatchType; label: string }[] =
  [
    { value: "exact", label: "exact" },
    { value: "glob", label: "glob" },
  ];

export interface BranchRulesProps {
  rules: readonly DeployBranchRule[];
  environments: readonly DeployEnvironmentListEntry[];
  /** Branch names off the remote, for the exact-match picker. */
  branches: readonly string[];
  busy: boolean;
  onCreate: (input: {
    environmentId: string;
    matchType: DeployBranchMatchType;
    pattern: string;
    priority: number;
  }) => void;
  onUpdate: (
    id: string,
    changes: Partial<{
      environmentId: string;
      matchType: DeployBranchMatchType;
      pattern: string;
      priority: number;
      enabled: boolean;
    }>,
  ) => void;
  onDelete: (id: string) => void;
}

const COLUMNS =
  "grid gap-2 md:grid-cols-[5rem_minmax(0,1.6fr)_minmax(0,1fr)_4.5rem_2.5rem_2rem]";

export function BranchRules({
  rules,
  environments,
  branches,
  busy,
  onCreate,
  onUpdate,
  onDelete,
}: BranchRulesProps) {
  const [matchType, setMatchType] = useState<DeployBranchMatchType>("exact");
  const [pattern, setPattern] = useState("");
  const [environmentId, setEnvironmentId] = useState<string | null>(null);

  const environmentOptions = environments.map((environment) => ({
    value: environment.id,
    label: environment.name,
  }));
  // The next rule sits below the current lowest-priority one, spaced so a rule
  // can later be slotted between two without renumbering the set.
  const nextPriority =
    rules.reduce((highest, rule) => Math.max(highest, rule.priority), 90) + 10;
  const target = environmentId ?? environments[0]?.id ?? null;
  const canAdd = pattern.trim().length > 0 && target !== null && !busy;

  function submit() {
    if (!canAdd || target === null) return;
    onCreate({
      environmentId: target,
      matchType,
      pattern: pattern.trim(),
      priority: nextPriority,
    });
    setPattern("");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="hidden gap-2 border-b pb-2 text-xs text-muted-foreground md:grid md:grid-cols-[5rem_minmax(0,1.6fr)_minmax(0,1fr)_4.5rem_2.5rem_2rem]">
        <span>match</span>
        <span>branch</span>
        <span>environment</span>
        <span>priority</span>
        <span>on</span>
        <span />
      </div>

      {rules.map((rule) => (
        <div key={rule.id} className={`${COLUMNS} items-center`}>
          <OptionSelect<DeployBranchMatchType>
            aria-label="Match type"
            className="h-8"
            value={rule.matchType}
            onValueChange={(value) =>
              onUpdate(rule.id, { matchType: value ?? "exact" })
            }
            options={MATCH_TYPES}
          />
          {rule.matchType === "exact" && branches.length > 0 ? (
            <OptionSelect<string>
              aria-label="Branch"
              className="h-8 font-mono text-xs"
              value={rule.pattern}
              onValueChange={(value) =>
                value && onUpdate(rule.id, { pattern: value })
              }
              options={branchOptions(branches, rule.pattern)}
            />
          ) : (
            <Input
              defaultValue={rule.pattern}
              className="h-8 font-mono text-xs"
              onBlur={(event) => {
                const next = event.target.value.trim();
                if (next.length > 0 && next !== rule.pattern) {
                  onUpdate(rule.id, { pattern: next });
                }
              }}
            />
          )}
          <OptionSelect<string>
            aria-label="Environment"
            className="h-8"
            value={rule.environmentId}
            onValueChange={(value) =>
              value && onUpdate(rule.id, { environmentId: value })
            }
            options={environmentOptions}
          />
          <Input
            type="number"
            defaultValue={rule.priority}
            className="h-8 tabular-nums text-xs"
            onBlur={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              if (Number.isFinite(next) && next !== rule.priority) {
                onUpdate(rule.id, { priority: next });
              }
            }}
          />
          <Switch
            aria-label="Enabled"
            checked={rule.enabled}
            onCheckedChange={(enabled) => onUpdate(rule.id, { enabled })}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onDelete(rule.id)}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      ))}

      {rules.length === 0 && (
        <p className="py-1 text-xs text-muted-foreground">—</p>
      )}

      <div className={`${COLUMNS} items-center border-t pt-3`}>
        <OptionSelect<DeployBranchMatchType>
          aria-label="New match type"
          className="h-8"
          value={matchType}
          onValueChange={(value) => setMatchType(value ?? "exact")}
          options={MATCH_TYPES}
        />
        {matchType === "exact" && branches.length > 0 ? (
          <OptionSelect<string>
            aria-label="New branch"
            className="h-8 font-mono text-xs"
            value={pattern.length > 0 ? pattern : null}
            emptyLabel="branch"
            onValueChange={(value) => setPattern(value ?? "")}
            options={branchOptions(branches, pattern)}
          />
        ) : (
          <Input
            value={pattern}
            placeholder={matchType === "glob" ? "release/*" : "staging"}
            className="h-8 font-mono text-xs"
            onChange={(event) => setPattern(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
        )}
        <OptionSelect<string>
          aria-label="New environment"
          className="h-8"
          value={target}
          onValueChange={(value) => setEnvironmentId(value)}
          options={environmentOptions}
        />
        <span className="text-xs tabular-nums text-muted-foreground">
          {nextPriority}
        </span>
        <span />
        <Button variant="ghost" size="sm" disabled={!canAdd} onClick={submit}>
          <Plus className="size-3" />
        </Button>
      </div>
    </div>
  );
}

/**
 * A rule can name a branch that no longer exists on the remote, and dropping it
 * from the options would silently rewrite the rule to whatever the select fell
 * back to. The stored value is always present, appended when it is missing.
 */
function branchOptions(
  branches: readonly string[],
  current: string,
): { value: string; label: string }[] {
  const options = branches.map((name) => ({ value: name, label: name }));
  if (current.length > 0 && !branches.includes(current)) {
    options.unshift({ value: current, label: `${current} (gone)` });
  }
  return options;
}

/**
 * What the rule set actually does, against the branches that exist. Two
 * patterns are indistinguishable in a list until you see which branches each
 * one caught — and one that catches nothing looks identical to one that works.
 */
export function BranchRoutes({
  routes,
}: {
  routes: readonly BranchRoutePreview[];
}) {
  if (routes.length === 0) {
    return <p className="py-1 text-xs text-muted-foreground">—</p>;
  }
  return (
    <div className="flex flex-col">
      {routes.map((route) => (
        <div
          key={route.branch}
          className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-b-0"
        >
          <span className="truncate font-mono text-xs">{route.branch}</span>
          <span
            className={
              route.kind === "production"
                ? "text-xs font-medium"
                : route.kind === null
                  ? "text-xs text-muted-foreground line-through"
                  : "text-xs text-muted-foreground"
            }
          >
            {route.environmentName ?? route.kind ?? "not deployed"}
          </span>
        </div>
      ))}
    </div>
  );
}
