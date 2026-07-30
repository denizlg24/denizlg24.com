"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/utils";
import { RotateCcw } from "lucide-react";
import {
  type CatalogModel,
  ModelSelect,
  RequiredModelSelect,
} from "../llm/model-select";
import { useAdmin } from "../provider";

interface BasePickerProps {
  models: CatalogModel[];
  loading?: boolean;
  error?: string | null;
  stale?: boolean;
  onRetry?: () => void;
  requiredCapabilities?: string[];
}

/**
 * Model picker for settings rows. Hosts that expose a rich catalog picker
 * (desktop's `ModelSelector`, with search, creator/capability filters and
 * pricing) get it; the plain Select is the fallback for hosts that don't.
 *
 * The rich picker has no concept of "unset", so nullable settings pair it with
 * an explicit reset back to the server default.
 */
export function SettingsModelPicker({
  value,
  onChange,
  defaultLabel,
  models,
  loading,
  error,
  stale,
  onRetry,
  requiredCapabilities,
  disabled,
}: BasePickerProps & {
  value: string | null;
  onChange: (value: string | null) => void;
  defaultLabel: string;
  disabled?: boolean;
}) {
  const { platform } = useAdmin();
  const Hosted = platform.HostedModelSelector;

  if (!Hosted) {
    return (
      <ModelSelect
        value={value}
        onChange={onChange}
        models={models}
        defaultLabel={defaultLabel}
        disabled={disabled}
        className="h-8 w-full text-xs"
      />
    );
  }

  return (
    <div className="space-y-1.5">
      <Hosted
        model={value}
        onModelChange={(next) => onChange(next)}
        models={models.length > 0 ? models : null}
        loading={loading}
        error={error}
        stale={stale}
        onRetry={onRetry}
        requiredCapabilities={requiredCapabilities}
        className={cn("w-full", disabled && "pointer-events-none opacity-50")}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-muted-foreground">
          {value === null ? defaultLabel : ""}
        </span>
        {value !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 gap-1 px-1.5 text-[11px]"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            <RotateCcw className="size-3" />
            {defaultLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Same picker for settings whose model id is required (no unset state). */
export function RequiredSettingsModelPicker({
  value,
  onChange,
  models,
  loading,
  error,
  stale,
  onRetry,
  requiredCapabilities,
  disabled,
}: BasePickerProps & {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const { platform } = useAdmin();
  const Hosted = platform.HostedModelSelector;

  if (!Hosted) {
    return (
      <RequiredModelSelect
        value={value}
        onChange={onChange}
        models={models}
        disabled={disabled}
        className="h-8 w-full text-xs"
      />
    );
  }

  return (
    <Hosted
      model={value || null}
      onModelChange={onChange}
      models={models.length > 0 ? models : null}
      loading={loading}
      error={error}
      stale={stale}
      onRetry={onRetry}
      requiredCapabilities={requiredCapabilities}
      className={cn("w-full", disabled && "pointer-events-none opacity-50")}
    />
  );
}
