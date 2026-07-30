"use client";

import type { AgentMemorySettings } from "@repo/schemas";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useModelCatalog } from "../../llm/model-select";
import { useAdmin } from "../../provider";
import { SettingsModelPicker } from "../settings-model-picker";
import { SettingsGroup, SettingsRow } from "../settings-shell";

const RETRIEVAL_MAX_ITEM_OPTIONS = [4, 8, 12, 20, 30, 50];
const RETRIEVAL_MAX_TOKEN_OPTIONS = [
  1_000, 1_500, 2_500, 4_000, 6_000, 8_000, 10_000,
];
const EXPLORE_MIN_SIMILARITY_OPTIONS = [
  0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7,
];

function formatDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Select over a fixed numeric option list that keeps an off-list value selectable. */
function NumericSelect({
  value,
  options,
  render,
  onChange,
  className,
}: {
  value: number;
  options: number[];
  render: (value: number) => string;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <Select
      value={String(value)}
      onValueChange={(next) => onChange(Number(next))}
    >
      <SelectTrigger className={className ?? "h-8 w-full text-xs"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {!options.includes(value) && (
          <SelectItem value={String(value)} className="text-xs">
            {render(value)} (current)
          </SelectItem>
        )}
        {options.map((option) => (
          <SelectItem key={option} value={String(option)} className="text-xs">
            {render(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AgentMemorySection() {
  const { client } = useAdmin();
  const { models, modelsLoading, modelsError, stale, retry } =
    useModelCatalog("tool-use");
  const [settings, setSettings] = useState<AgentMemorySettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await client.get<{ settings: AgentMemorySettings }>(
          "agent-memory/settings",
        );
        if (!cancelled) setSettings(data.settings);
      } catch {
        if (!cancelled) toast.error("Failed to load agent-memory settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const update = useCallback(
    async (patch: Record<string, unknown>, reason: string) => {
      try {
        const raw = await client.patch<{ settings?: AgentMemorySettings }>(
          "agent-memory/settings",
          { settings: patch, reason },
        );
        if (raw.settings) setSettings(raw.settings);
      } catch {
        toast.error("Settings update failed");
      }
    },
    [client],
  );

  if (loading || !settings) {
    return (
      <div className="space-y-8">
        {[0, 1, 2].map((row) => (
          <div key={row} className="space-y-3">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-8 w-full max-w-sm" />
          </div>
        ))}
      </div>
    );
  }

  const { retrieval, promotion, consolidation } = settings;

  return (
    <>
      <SettingsGroup
        label="Models"
        actions={
          modelsLoading ? (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              Loading catalog…
            </span>
          ) : undefined
        }
      >
        <div className="space-y-6">
          <SettingsRow
            label="Formation"
            hint="Extracts memory candidates from evidence."
          >
            <SettingsModelPicker
              value={settings.formationModel}
              models={models}
              loading={modelsLoading}
              error={modelsError}
              stale={stale}
              onRetry={retry}
              requiredCapabilities={["tool-use"]}
              defaultLabel="Server default (semantic)"
              onChange={(value) =>
                void update(
                  { formationModel: value },
                  `Set formation model to ${value ?? "server default"}`,
                )
              }
            />
          </SettingsRow>

          <SettingsRow
            label="Retrieval summary"
            hint="Rolling per-conversation topic summary so short follow-ups still retrieve. Disabled means latest message only."
          >
            <SettingsModelPicker
              value={retrieval.querySummaryModel}
              models={models}
              loading={modelsLoading}
              error={modelsError}
              stale={stale}
              onRetry={retry}
              defaultLabel="Disabled"
              onChange={(value) =>
                void update(
                  {
                    retrieval: { ...retrieval, querySummaryModel: value },
                  },
                  `Set retrieval summary model to ${value ?? "disabled"}`,
                )
              }
            />
          </SettingsRow>
        </div>
      </SettingsGroup>

      <SettingsGroup
        label="Retrieval budget"
        description="Caps memory context injected into a chat request. The recall floor applies to manual probes instead, which are uncapped by count."
      >
        <div className="space-y-6">
          <SettingsRow label="Injected memories">
            <NumericSelect
              value={retrieval.maxRetrievedItems}
              options={RETRIEVAL_MAX_ITEM_OPTIONS}
              render={(value) => `Up to ${value} memories`}
              onChange={(value) =>
                void update(
                  { retrieval: { ...retrieval, maxRetrievedItems: value } },
                  `Max injected memories set to ${value}`,
                )
              }
            />
          </SettingsRow>
          <SettingsRow label="Token budget">
            <NumericSelect
              value={retrieval.maxTokens}
              options={RETRIEVAL_MAX_TOKEN_OPTIONS}
              render={(value) => `${value.toLocaleString()} tokens`}
              onChange={(value) =>
                void update(
                  { retrieval: { ...retrieval, maxTokens: value } },
                  `Retrieval token budget set to ${value}`,
                )
              }
            />
          </SettingsRow>
          <SettingsRow label="Manual recall floor">
            <NumericSelect
              value={retrieval.exploreMinSimilarity}
              options={EXPLORE_MIN_SIMILARITY_OPTIONS}
              render={(value) => `≥ ${value} cosine`}
              onChange={(value) =>
                void update(
                  { retrieval: { ...retrieval, exploreMinSimilarity: value } },
                  `Manual recall floor set to ${value}`,
                )
              }
            />
          </SettingsRow>
        </div>
      </SettingsGroup>

      <SettingsGroup
        label="Review policy"
        description="Single-user auto-accepts safe candidates and queues only low-confidence email-only proposals. Conservative restores the strict multi-flag pipeline. Hard safety rules always apply."
      >
        <div className="space-y-6">
          <SettingsRow label="Mode">
            <Select
              value={promotion.mode}
              onValueChange={(value) =>
                void update(
                  { promotion: { ...promotion, mode: value } },
                  `Set promotion mode to ${value}`,
                )
              }
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single-user" className="text-xs">
                  Single-user
                </SelectItem>
                <SelectItem value="conservative" className="text-xs">
                  Conservative
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>

          {promotion.mode === "single-user" && (
            <SettingsRow label="Email review">
              <NumericSelect
                value={promotion.emailReviewMaxConfidence}
                options={[0.5, 0.7, 0.85, 1]}
                render={(value) =>
                  value >= 1
                    ? "Review all email memories"
                    : `Review email below ${Math.round(value * 100)}%`
                }
                onChange={(value) =>
                  void update(
                    {
                      promotion: {
                        ...promotion,
                        emailReviewMaxConfidence: value,
                      },
                    },
                    `Email review threshold set to ${value}`,
                  )
                }
              />
            </SettingsRow>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        label="Consolidation"
        description="A recurring sweep clusters near-duplicates, supersedes outdated facts, and rewrites statements to refer to the owner as “Admin”. Proposals at or above the threshold are applied by policy (revisioned and rollbackable)."
      >
        <div className="space-y-6">
          <SettingsRow label="Sweep">
            <Select
              value={consolidation.enabled ? "enabled" : "disabled"}
              onValueChange={(value) =>
                void update(
                  {
                    consolidation: {
                      ...consolidation,
                      enabled: value === "enabled",
                    },
                  },
                  `Consolidation ${value}`,
                )
              }
            >
              <SelectTrigger className="h-8 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="enabled" className="text-xs">
                  Enabled
                </SelectItem>
                <SelectItem value="disabled" className="text-xs">
                  Disabled
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>

          {consolidation.enabled && (
            <>
              <SettingsRow label="Auto-apply threshold">
                <NumericSelect
                  value={consolidation.autoApplyThreshold}
                  options={[0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1]}
                  render={(value) =>
                    value >= 1
                      ? "Only at 100%"
                      : `At ${Math.round(value * 100)}% confidence`
                  }
                  onChange={(value) =>
                    void update(
                      {
                        consolidation: {
                          ...consolidation,
                          autoApplyThreshold: value,
                        },
                      },
                      `Consolidation auto-apply threshold set to ${value}`,
                    )
                  }
                />
              </SettingsRow>
              <SettingsRow label="Batch size">
                <NumericSelect
                  value={consolidation.batchSize}
                  options={[20, 40, 80]}
                  render={(value) => `${value} memories/run`}
                  onChange={(value) =>
                    void update(
                      {
                        consolidation: { ...consolidation, batchSize: value },
                      },
                      `Consolidation batch size set to ${value}`,
                    )
                  }
                />
              </SettingsRow>
            </>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup label="State">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Reflection
            </dt>
            <dd className="mt-1 truncate font-mono">
              {settings.reflectionSchedule ?? "manual"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Insights/day
            </dt>
            <dd className="mt-1 tabular-nums">
              {settings.proactivity.maxInsightsPerDay}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Autonomy
            </dt>
            <dd className="mt-1 truncate font-mono">
              {settings.maximumActionAutonomy}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Revision
            </dt>
            <dd className="mt-1 tabular-nums">
              {settings.revision}
              <span className="ml-1.5 text-muted-foreground">
                {formatDate(settings.updatedAt)}
              </span>
            </dd>
          </div>
        </dl>
      </SettingsGroup>
    </>
  );
}
