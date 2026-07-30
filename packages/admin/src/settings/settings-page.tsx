"use client";

import type { AppSettingsResponse } from "@repo/schemas";
import { PageHeader } from "@repo/ui/page-header";
import { Skeleton } from "@repo/ui/skeleton";
import { HeaderBarSkeleton } from "@repo/ui/skeleton-blocks";
import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ModelSelect, useModelCatalog } from "../llm/model-select";
import { useAdmin } from "../provider";

type Settings = AppSettingsResponse["settings"];

export function SettingsSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2">
      <HeaderBarSkeleton
        icon={<Settings2 className="size-4 text-muted-foreground" />}
      />
      <div className="max-w-2xl space-y-8 p-4">
        {[0, 1].map((row) => (
          <div key={row} className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-72" />
            <Skeleton className="h-8 w-full max-w-md" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const { client } = useAdmin();
  const { models, modelsLoading } = useModelCatalog();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await client.get<AppSettingsResponse>("settings");
        if (!cancelled) setSettings(data.settings);
      } catch {
        if (!cancelled) toast.error("Failed to load settings");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const update = useCallback(
    async (key: "semanticModel" | "unattendedModel", value: string | null) => {
      const previous = settings;
      setSaving(key);
      setSettings((current) =>
        current ? { ...current, [key]: value } : current,
      );
      try {
        const data = await client.patch<AppSettingsResponse>("settings", {
          [key]: value,
        });
        setSettings(data.settings);
      } catch {
        setSettings(previous);
        toast.error("Failed to save");
      } finally {
        setSaving(null);
      }
    },
    [client, settings],
  );

  if (!settings) return <SettingsSkeleton />;

  return (
    <div className="flex h-full flex-col gap-2">
      <PageHeader
        icon={<Settings2 className="size-4 text-muted-foreground" />}
        title="Settings"
      />
      <div className="max-w-2xl space-y-8 p-4">
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">Semantic model</h3>
            <p className="text-xs text-muted-foreground">
              JSON and classification work: note keywords, merchant
              classification, and the agent-memory fallback.
            </p>
          </div>
          <ModelSelect
            value={settings.semanticModel}
            models={models}
            disabled={saving === "semanticModel"}
            defaultLabel={`Default (${settings.effectiveSemanticModel})`}
            onChange={(value) => void update("semanticModel", value)}
          />
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">Unattended model</h3>
            <p className="text-xs text-muted-foreground">
              Background text jobs: note categorization, voice-note drafts and
              titles, agent training.
            </p>
          </div>
          <ModelSelect
            value={settings.unattendedModel}
            models={models}
            disabled={saving === "unattendedModel"}
            defaultLabel={`Default (${settings.effectiveUnattendedModel})`}
            onChange={(value) => void update("unattendedModel", value)}
          />
        </section>

        {modelsLoading && (
          <p className="text-xs text-muted-foreground">
            Loading model catalog…
          </p>
        )}

        <section className="space-y-1">
          <h3 className="text-sm font-medium">Timezone</h3>
          <p className="text-xs text-muted-foreground tabular-nums">
            {settings.effectiveTimeZone}
          </p>
        </section>
      </div>
    </div>
  );
}
