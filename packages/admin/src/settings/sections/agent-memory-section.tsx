"use client";

import type {
  AgentMemorySettings,
  AgentMemorySettingsResponse,
} from "@repo/schemas";
import { Properties, Property } from "@repo/ui/properties";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { Switch } from "@repo/ui/switch";
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
      <SelectTrigger className={className ?? "w-full"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {!options.includes(value) && (
          <SelectItem value={String(value)}>
            {render(value)} (current)
          </SelectItem>
        )}
        {options.map((option) => (
          <SelectItem key={option} value={String(option)}>
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
        const data = await client.get<AgentMemorySettingsResponse>(
          "agent-memory/settings",
        );
        if (!cancelled && data.settings) setSettings(data.settings);
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
        const raw = await client.patch<AgentMemorySettingsResponse>(
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
      <>
        {[0, 1, 2].map((group) => (
          <div key={group} className="flex flex-col gap-3">
            <Skeleton className="h-3 w-24" />
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-56" />
            </div>
          </div>
        ))}
      </>
    );
  }

  const { retrieval, promotion, consolidation } = settings;

  return (
    <>
      <SettingsGroup
        label="Models"
        actions={
          modelsLoading ? (
            <Spinner className="size-3 text-muted-foreground" />
          ) : undefined
        }
      >
        <SettingsRow label="Formation">
          <SettingsModelPicker
            value={settings.formationModel}
            models={models}
            loading={modelsLoading}
            error={modelsError}
            stale={stale}
            onRetry={retry}
            requiredCapabilities={["tool-use"]}
            defaultLabel="Default (semantic)"
            onChange={(value) =>
              void update(
                { formationModel: value },
                `Set formation model to ${value ?? "server default"}`,
              )
            }
          />
        </SettingsRow>

        <SettingsRow label="Retrieval summary">
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
      </SettingsGroup>

      <SettingsGroup label="Retrieval budget">
        <SettingsRow label="Max memories">
          <NumericSelect
            value={retrieval.maxRetrievedItems}
            options={RETRIEVAL_MAX_ITEM_OPTIONS}
            render={(value) => `${value}`}
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
        <SettingsRow label="Recall floor">
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
      </SettingsGroup>

      <SettingsGroup label="Review policy">
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
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="single-user">Single-user</SelectItem>
              <SelectItem value="conservative">Conservative</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        {promotion.mode === "single-user" && (
          <SettingsRow label="Email review">
            <NumericSelect
              value={promotion.emailReviewMaxConfidence}
              options={[0.5, 0.7, 0.85, 1]}
              render={(value) =>
                value >= 1 ? "All" : `Below ${Math.round(value * 100)}%`
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
      </SettingsGroup>

      <SettingsGroup label="Consolidation">
        <SettingsRow label="Sweep">
          <Switch
            checked={consolidation.enabled}
            aria-label="Consolidation sweep"
            onCheckedChange={(enabled) =>
              void update(
                { consolidation: { ...consolidation, enabled } },
                `Consolidation ${enabled ? "enabled" : "disabled"}`,
              )
            }
          />
        </SettingsRow>

        {consolidation.enabled && (
          <>
            <SettingsRow label="Auto-apply at">
              <NumericSelect
                value={consolidation.autoApplyThreshold}
                options={[0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1]}
                render={(value) =>
                  value >= 1 ? "100%" : `${Math.round(value * 100)}%`
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
                render={(value) => `${value}`}
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
      </SettingsGroup>

      <SettingsGroup label="State">
        <Properties>
          <Property label="Reflection">
            <span className="font-mono text-xs">
              {settings.reflectionSchedule ?? "manual"}
            </span>
          </Property>
          <Property label="Insights/day">
            <span className="tabular-nums">
              {settings.proactivity.maxInsightsPerDay}
            </span>
          </Property>
          <Property label="Autonomy">
            <span className="font-mono text-xs">
              {settings.maximumActionAutonomy}
            </span>
          </Property>
          <Property label="Revision">
            <span className="tabular-nums">
              {settings.revision}
              <span className="ml-2 text-muted-foreground">
                {formatDate(settings.updatedAt)}
              </span>
            </span>
          </Property>
        </Properties>
      </SettingsGroup>
    </>
  );
}
