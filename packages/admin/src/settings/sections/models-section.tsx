"use client";

import type { AppSettingsResponse } from "@repo/schemas";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useModelCatalog } from "../../llm/model-select";
import { useAdmin } from "../../provider";
import { SettingsModelPicker } from "../settings-model-picker";
import { SettingsGroup, SettingsRow } from "../settings-shell";

type Settings = AppSettingsResponse["settings"];
type ModelKey = "semanticModel" | "unattendedModel";

export function ModelsSection() {
  const { client } = useAdmin();
  const { models, modelsLoading, modelsError, stale, retry } =
    useModelCatalog();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState<ModelKey | null>(null);

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
    async (key: ModelKey, value: string | null) => {
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

  return (
    <SettingsGroup
      label="Job models"
      actions={
        modelsLoading ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            Loading catalog…
          </span>
        ) : (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {models.length} models
          </span>
        )
      }
    >
      <div className="space-y-6">
        <SettingsRow
          label="Semantic"
          hint="Note keywords, merchant classification, agent-memory fallback."
        >
          {settings ? (
            <SettingsModelPicker
              value={settings.semanticModel}
              models={models}
              loading={modelsLoading}
              error={modelsError}
              stale={stale}
              onRetry={retry}
              disabled={saving === "semanticModel"}
              defaultLabel={`Default (${settings.effectiveSemanticModel})`}
              onChange={(value) => void update("semanticModel", value)}
            />
          ) : (
            <Skeleton className="h-8 w-full" />
          )}
        </SettingsRow>

        <SettingsRow
          label="Unattended"
          hint="Note categorization, voice-note drafts and titles, agent training."
        >
          {settings ? (
            <SettingsModelPicker
              value={settings.unattendedModel}
              models={models}
              loading={modelsLoading}
              error={modelsError}
              stale={stale}
              onRetry={retry}
              disabled={saving === "unattendedModel"}
              defaultLabel={`Default (${settings.effectiveUnattendedModel})`}
              onChange={(value) => void update("unattendedModel", value)}
            />
          ) : (
            <Skeleton className="h-8 w-full" />
          )}
        </SettingsRow>
      </div>
    </SettingsGroup>
  );
}
