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
 * The plain Select has nowhere to show catalog trouble, so hosts without a
 * rich picker get this line under it instead of silently rendering a short or
 * empty model list as if it were the whole catalog.
 */
function CatalogStatus({
  error,
  stale,
  onRetry,
}: Pick<BasePickerProps, "error" | "stale" | "onRetry">) {
  if (!error && !stale) return null;

  return (
    <div className="flex items-center gap-1.5">
      <span className="min-w-0 flex-1 truncate text-xs text-status-warning">
        {error ?? "Stale catalog"}
      </span>
      {onRetry && (
        <Button
          variant="ghost"
          size="xs"
          className="shrink-0 text-muted-foreground"
          onClick={onRetry}
        >
          <RotateCcw />
          Retry
        </Button>
      )}
    </div>
  );
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
      <div className="flex w-full flex-col gap-1.5">
        <ModelSelect
          value={value}
          onChange={onChange}
          models={models}
          defaultLabel={defaultLabel}
          disabled={disabled}
          className="w-full"
        />
        <CatalogStatus error={error} stale={stale} onRetry={onRetry} />
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
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
      {value === null ? (
        <span className="truncate text-xs text-muted-foreground">
          {defaultLabel}
        </span>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          className="max-w-full self-start text-muted-foreground"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          <RotateCcw />
          <span className="truncate">{defaultLabel}</span>
        </Button>
      )}
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
      <div className="flex w-full flex-col gap-1.5">
        <RequiredModelSelect
          value={value}
          onChange={onChange}
          models={models}
          disabled={disabled}
          className="w-full"
        />
        <CatalogStatus error={error} stale={stale} onRetry={onRetry} />
      </div>
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
