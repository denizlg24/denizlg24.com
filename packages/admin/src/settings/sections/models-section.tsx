"use client";

import type { AppSettingsResponse } from "@repo/schemas";
import { defaultVoiceForModel, TTS_MODELS, voicesForModel } from "@repo/tts";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useModelCatalog } from "../../llm/model-select";
import { useAdmin } from "../../provider";
import { SettingsModelPicker } from "../settings-model-picker";
import { SettingsGroup, SettingsRow } from "../settings-shell";

type Settings = AppSettingsResponse["settings"];
type ModelKey =
  | "semanticModel"
  | "unattendedModel"
  | "ttsModel"
  | "ttsVoice"
  | "ttsInstructions";

export function ModelsSection() {
  const { client } = useAdmin();
  const { models, modelsLoading, modelsError, stale, retry } =
    useModelCatalog();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState<ModelKey | null>(null);
  const [voiceInstructions, setVoiceInstructions] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await client.get<AppSettingsResponse>("settings");
        if (!cancelled) {
          setSettings(data.settings);
          setVoiceInstructions(data.settings.ttsInstructions ?? "");
        }
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
    <div className="space-y-6">
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
          <SettingsRow label="Semantic">
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

          <SettingsRow label="Unattended">
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
      <SettingsGroup label="Text to speech">
        <div className="space-y-6">
          <SettingsRow label="Model" htmlFor="tts-model">
            {settings ? (
              <select
                id="tts-model"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={settings.effectiveTtsModel}
                disabled={saving !== null}
                onChange={(event) =>
                  void update("ttsModel", event.target.value)
                }
              >
                {TTS_MODELS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            ) : (
              <Skeleton className="h-9 w-full" />
            )}
          </SettingsRow>
          <SettingsRow label="Voice" htmlFor="tts-voice">
            {settings ? (
              <select
                id="tts-voice"
                className="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={
                  voicesForModel(settings.effectiveTtsModel).includes(
                    settings.effectiveTtsVoice,
                  )
                    ? settings.effectiveTtsVoice
                    : defaultVoiceForModel(settings.effectiveTtsModel)
                }
                disabled={saving !== null}
                onChange={(event) =>
                  void update("ttsVoice", event.target.value)
                }
              >
                {voicesForModel(settings.effectiveTtsModel).map((voice) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
            ) : (
              <Skeleton className="h-9 w-full" />
            )}
          </SettingsRow>
          <SettingsRow label="Voice instructions" htmlFor="tts-instructions">
            {settings ? (
              <div className="space-y-2">
                <textarea
                  id="tts-instructions"
                  className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={voiceInstructions}
                  maxLength={1_000}
                  disabled={saving !== null}
                  placeholder="For example: Warm, relaxed, and speaking slowly"
                  onChange={(event) => setVoiceInstructions(event.target.value)}
                  onBlur={() => {
                    if (
                      voiceInstructions.trim() !==
                      (settings.ttsInstructions ?? "")
                    ) {
                      void update(
                        "ttsInstructions",
                        voiceInstructions.trim() || null,
                      );
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Delivery instructions apply to Gemini voices.
                </p>
              </div>
            ) : (
              <Skeleton className="h-20 w-full" />
            )}
          </SettingsRow>
        </div>
      </SettingsGroup>
    </div>
  );
}
