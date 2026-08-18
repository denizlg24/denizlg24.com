"use client";

import type {
  ITriageCategoryRouting,
  ITriageSettings,
  TriageCategory,
  TriageSettingsResponse,
} from "@repo/schemas";
import { Input } from "@repo/ui/input";
import { Skeleton } from "@repo/ui/skeleton";
import { Slider } from "@repo/ui/slider";
import { Switch } from "@repo/ui/switch";
import { cn } from "@repo/ui/utils";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useModelCatalog } from "../../llm/model-select";
import { useAdmin } from "../../provider";
import {
  CATEGORY_LABELS,
  CATEGORY_SPINE,
  TRIAGE_CATEGORIES,
} from "../../triage/category-meta";
import { RequiredSettingsModelPicker } from "../settings-model-picker";
import { SettingsGroup, SettingsRow } from "../settings-shell";

const DEFAULT_ROUTING: ITriageCategoryRouting = {
  autoAccept: false,
  autoAcceptThreshold: 0.85,
};

type TriagePatch = Partial<
  Pick<
    ITriageSettings,
    | "enabled"
    | "runIntervalMinutes"
    | "fullModel"
    | "classificationConfidenceThreshold"
    | "categoryRouting"
    | "courseSenderDomains"
  >
>;

function RoutingRow({
  category,
  routing,
  onPreview,
  onCommit,
}: {
  category: TriageCategory;
  routing: ITriageCategoryRouting;
  onPreview: (next: Partial<ITriageCategoryRouting>) => void;
  onCommit: (next: Partial<ITriageCategoryRouting>) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span
        aria-hidden
        className={cn(
          "h-6 w-0.5 shrink-0 rounded-full",
          CATEGORY_SPINE[category],
        )}
      />
      <span className="w-28 shrink-0 truncate text-xs">
        {CATEGORY_LABELS[category]}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Slider
          min={0.5}
          max={1}
          step={0.05}
          disabled={!routing.autoAccept}
          value={[routing.autoAcceptThreshold]}
          aria-label={`${CATEGORY_LABELS[category]} auto-accept threshold`}
          onValueChange={([value]) =>
            value !== undefined && onPreview({ autoAcceptThreshold: value })
          }
          onValueCommit={([value]) =>
            value !== undefined && onCommit({ autoAcceptThreshold: value })
          }
        />
        <span
          className={cn(
            "w-9 shrink-0 text-right text-[11px] tabular-nums",
            routing.autoAccept ? "text-foreground" : "text-muted-foreground/50",
          )}
        >
          {(routing.autoAcceptThreshold * 100).toFixed(0)}%
        </span>
      </div>

      <Switch
        checked={routing.autoAccept}
        aria-label={`Auto-accept ${CATEGORY_LABELS[category]}`}
        onCheckedChange={(value) => onCommit({ autoAccept: value })}
      />
    </div>
  );
}

/**
 * The sender allowlist that decides which mail may match a course at all. A
 * subdomain of a listed domain counts, so `dtu.dk` also admits
 * `student.dtu.dk`. Empty means every sender is eligible.
 */
function CourseSenderDomains({
  domains,
  onChange,
}: {
  domains: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const domain = draft
      .trim()
      .toLowerCase()
      .replace(/^[@.]+/, "");
    setDraft("");
    if (!domain.includes(".") || domains.includes(domain)) return;
    onChange([...domains, domain]);
  };

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {domains.map((domain) => (
          <span
            key={domain}
            className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px]"
          >
            {domain}
            <button
              type="button"
              aria-label={`Remove ${domain}`}
              className="text-muted-foreground transition-colors hover:text-foreground"
              onClick={() =>
                onChange(domains.filter((entry) => entry !== domain))
              }
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {domains.length === 0 && (
          <span className="text-[11px] text-muted-foreground">any sender</span>
        )}
      </div>
      <Input
        value={draft}
        placeholder="dtu.dk"
        aria-label="Add course sender domain"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={add}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        className="h-8 max-w-xs text-xs"
      />
    </div>
  );
}

export function TriageSection() {
  const { client } = useAdmin();
  const { models, modelsLoading, modelsError, stale, retry } =
    useModelCatalog();
  const [data, setData] = useState<ITriageSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [interval, setIntervalValue] = useState("");
  const latest = useRef<ITriageSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await client.get<TriageSettingsResponse>("triage/settings");
        if (cancelled) return;
        setData(res.settings);
        latest.current = res.settings;
        setIntervalValue(String(res.settings.runIntervalMinutes));
      } catch {
        if (!cancelled) toast.error("Failed to load triage settings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  /** Optimistic local edit with no write — used while a slider is dragging. */
  const preview = useCallback((next: TriagePatch) => {
    setData((current) => (current ? { ...current, ...next } : current));
  }, []);

  const commit = useCallback(
    async (next: TriagePatch) => {
      const previous = latest.current;
      if (!previous) return;
      const optimistic = { ...previous, ...next };
      latest.current = optimistic;
      setData(optimistic);
      try {
        const res = await client.patch<TriageSettingsResponse>(
          "triage/settings",
          next,
        );
        latest.current = res.settings;
        setData(res.settings);
      } catch {
        latest.current = previous;
        setData(previous);
        setIntervalValue(String(previous.runIntervalMinutes));
        toast.error("Failed to save");
      }
    },
    [client],
  );

  const commitRouting = (
    category: TriageCategory,
    next: Partial<ITriageCategoryRouting>,
  ) => {
    const current = latest.current;
    if (!current) return;
    void commit({
      categoryRouting: {
        ...current.categoryRouting,
        [category]: {
          ...(current.categoryRouting[category] ?? DEFAULT_ROUTING),
          ...next,
        },
      },
    });
  };

  const previewRouting = (
    category: TriageCategory,
    next: Partial<ITriageCategoryRouting>,
  ) => {
    setData((current) =>
      current
        ? {
            ...current,
            categoryRouting: {
              ...current.categoryRouting,
              [category]: {
                ...(current.categoryRouting[category] ?? DEFAULT_ROUTING),
                ...next,
              },
            },
          }
        : current,
    );
  };

  const commitInterval = () => {
    const parsed = Number(interval);
    if (!Number.isFinite(parsed) || parsed < 15) {
      setIntervalValue(String(data?.runIntervalMinutes ?? 15));
      return;
    }
    if (parsed === data?.runIntervalMinutes) return;
    void commit({ runIntervalMinutes: parsed });
  };

  if (loading || !data) {
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

  return (
    <>
      <SettingsGroup
        label="Runner"
        actions={
          data.lastRunAt && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              last run {new Date(data.lastRunAt).toLocaleString()}
            </span>
          )
        }
      >
        <div className="space-y-6">
          <SettingsRow label="Enabled">
            <div className="flex sm:justify-end">
              <Switch
                checked={data.enabled}
                onCheckedChange={(value) => void commit({ enabled: value })}
              />
            </div>
          </SettingsRow>

          <SettingsRow label="Interval">
            <Input
              type="number"
              min={15}
              value={interval}
              onChange={(event) => setIntervalValue(event.target.value)}
              onBlur={commitInterval}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="h-8 w-full text-xs tabular-nums"
            />
          </SettingsRow>

          <SettingsRow label="Extraction model">
            <RequiredSettingsModelPicker
              value={data.fullModel}
              models={models}
              loading={modelsLoading}
              error={modelsError}
              stale={stale}
              onRetry={retry}
              onChange={(value) => void commit({ fullModel: value })}
            />
          </SettingsRow>
        </div>
      </SettingsGroup>

      <SettingsGroup
        label="Review threshold"
        actions={
          <span className="shrink-0 text-sm font-medium tabular-nums">
            {(data.classificationConfidenceThreshold * 100).toFixed(0)}%
          </span>
        }
      >
        <Slider
          min={0.5}
          max={1}
          step={0.01}
          aria-label="Manual review threshold"
          value={[data.classificationConfidenceThreshold]}
          onValueChange={([value]) =>
            value !== undefined &&
            preview({ classificationConfidenceThreshold: value })
          }
          onValueCommit={([value]) =>
            value !== undefined &&
            void commit({ classificationConfidenceThreshold: value })
          }
        />
      </SettingsGroup>

      <SettingsGroup label="Course senders">
        <CourseSenderDomains
          domains={data.courseSenderDomains}
          onChange={(next) => void commit({ courseSenderDomains: next })}
        />
      </SettingsGroup>

      <SettingsGroup label="Category automation">
        <div className="divide-y">
          {TRIAGE_CATEGORIES.map((category) => (
            <RoutingRow
              key={category}
              category={category}
              routing={data.categoryRouting[category] ?? DEFAULT_ROUTING}
              onPreview={(next) => previewRouting(category, next)}
              onCommit={(next) => commitRouting(category, next)}
            />
          ))}
        </div>
      </SettingsGroup>
    </>
  );
}
