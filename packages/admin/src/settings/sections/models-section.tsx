"use client";

import type { AppSettingsResponse } from "@repo/schemas";
import { defaultVoiceForModel, TTS_MODELS, voicesForModel } from "@repo/tts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { Textarea } from "@repo/ui/textarea";
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

  const voices = settings ? voicesForModel(settings.effectiveTtsModel) : [];
  const voice =
    settings && voices.includes(settings.effectiveTtsVoice)
      ? settings.effectiveTtsVoice
      : settings
        ? defaultVoiceForModel(settings.effectiveTtsModel)
        : "";

  const modelPicker = (
    key: "semanticModel" | "unattendedModel",
    effective: string,
  ) =>
    settings ? (
      <SettingsModelPicker
        value={settings[key]}
        models={models}
        loading={modelsLoading}
        error={modelsError}
        stale={stale}
        onRetry={retry}
        disabled={saving === key}
        defaultLabel={`Default (${effective})`}
        onChange={(value) => void update(key, value)}
      />
    ) : (
      <Skeleton className="h-8 w-full" />
    );

  return (
    <>
      <SettingsGroup
        label="Job models"
        actions={
          modelsLoading ? (
            <Spinner className="size-3 text-muted-foreground" />
          ) : (
            <span className="text-xs tabular-nums text-muted-foreground">
              {models.length}
            </span>
          )
        }
      >
        <SettingsRow label="Semantic">
          {modelPicker("semanticModel", settings?.effectiveSemanticModel ?? "")}
        </SettingsRow>
        <SettingsRow label="Unattended">
          {modelPicker(
            "unattendedModel",
            settings?.effectiveUnattendedModel ?? "",
          )}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Text to speech">
        <SettingsRow label="Model">
          {settings ? (
            <Select
              value={settings.effectiveTtsModel}
              disabled={saving !== null}
              onValueChange={(value) => void update("ttsModel", value)}
            >
              <SelectTrigger className="w-full" aria-label="TTS model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTS_MODELS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Skeleton className="h-8 w-full" />
          )}
        </SettingsRow>
        <SettingsRow label="Voice">
          {settings ? (
            <Select
              value={voice}
              disabled={saving !== null}
              onValueChange={(value) => void update("ttsVoice", value)}
            >
              <SelectTrigger className="w-full" aria-label="TTS voice">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {voices.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Skeleton className="h-8 w-full" />
          )}
        </SettingsRow>
        <SettingsRow
          label="Delivery"
          hint="Gemini voices"
          htmlFor="tts-instructions"
          stacked
        >
          {settings ? (
            <Textarea
              id="tts-instructions"
              className="min-h-20 w-full"
              value={voiceInstructions}
              maxLength={1_000}
              disabled={saving !== null}
              placeholder="Warm, relaxed, slow"
              onChange={(event) => setVoiceInstructions(event.target.value)}
              onBlur={() => {
                if (
                  voiceInstructions.trim() !== (settings.ttsInstructions ?? "")
                ) {
                  void update(
                    "ttsInstructions",
                    voiceInstructions.trim() || null,
                  );
                }
              }}
            />
          ) : (
            <Skeleton className="h-20 w-full" />
          )}
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
