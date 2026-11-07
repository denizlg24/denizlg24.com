"use client";

import type {
  LlmCatalogModel,
  RunConfig,
  RunConfigOverride,
  RunCredential,
  RunEffort,
  RunPermissionMode,
} from "@repo/schemas";
import {
  RUN_EFFORTS,
  RUN_TIMEOUT_MAX_MINUTES,
  RUN_TIMEOUT_MIN_MINUTES,
  runCredentialSchema,
  runPermissionModeSchema,
} from "@repo/schemas";
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { OptionSelect, type SelectOption } from "@repo/ui/option-select";
import { Properties, Property } from "@repo/ui/properties";
import { Textarea } from "@repo/ui/textarea";
import { type ReactNode, useId, useMemo } from "react";
import { useModelCatalog } from "../agent/use-model-catalog";

const CLAUDE_CODE_ALIASES = ["opus", "sonnet", "haiku"] as const;

/**
 * Claude Code names models by its own ids (`claude-opus-5-5`), not the
 * Gateway's (`anthropic/claude-opus-5.5`): the provider prefix goes and the
 * version's dots become dashes.
 */
export function claudeCodeModelId(gatewayId: string): string {
  return gatewayId.replace(/^anthropic\//, "").replaceAll(".", "-");
}

function isAnthropicModel(model: LlmCatalogModel): boolean {
  return (
    model.creator.toLowerCase() === "anthropic" ||
    model.id.startsWith("anthropic/")
  );
}

export function useClaudeCodeModels(): string[] {
  const { models } = useModelCatalog();
  return useMemo(() => {
    const ids = new Set<string>(CLAUDE_CODE_ALIASES);
    for (const model of models ?? []) {
      if (isAnthropicModel(model)) ids.add(claudeCodeModelId(model.id));
    }
    return [...ids];
  }, [models]);
}

const EFFORT_OPTIONS: SelectOption<RunEffort>[] = RUN_EFFORTS.map((effort) => ({
  value: effort,
  label: effort,
}));

const PERMISSION_LABEL: Record<RunPermissionMode, string> = {
  bypassPermissions: "Bypass",
  acceptEdits: "Accept edits",
  plan: "Plan",
};

const PERMISSION_OPTIONS: SelectOption<RunPermissionMode>[] =
  runPermissionModeSchema.options.map((mode) => ({
    value: mode,
    label: PERMISSION_LABEL[mode],
  }));

const CREDENTIAL_LABEL: Record<RunCredential, string> = {
  subscription: "Subscription",
  gateway: "Gateway",
};

const CREDENTIAL_OPTIONS: SelectOption<RunCredential>[] =
  runCredentialSchema.options.map((credential) => ({
    value: credential,
    label: CREDENTIAL_LABEL[credential],
  }));

/**
 * The run configuration editor, shared by a sprint's defaults and a slot's
 * override. With `inherited` every field may be left empty, which keeps the
 * sprint's value (shown as the placeholder); without it every field is set.
 */
export function RunConfigFields({
  value,
  inherited,
  onChange,
  disabled = false,
  layout = "form",
  inheritedFrom = "Sprint",
}: {
  value: RunConfigOverride;
  inherited?: RunConfig;
  onChange: (patch: RunConfigOverride) => void;
  disabled?: boolean;
  layout?: "form" | "properties";
  /** Names where an empty field's value comes from. */
  inheritedFrom?: string;
}) {
  const models = useClaudeCodeModels();
  const modelListId = useId();
  const override = inherited !== undefined;

  const select = <T extends string>({
    label,
    current,
    fallback,
    options,
    display,
    set,
  }: {
    label: string;
    current: T | undefined;
    fallback: T | undefined;
    options: SelectOption<T>[];
    display: (value: T) => string;
    set: (next: T | undefined) => void;
  }) => (
    <OptionSelect<T>
      size="default"
      className="w-full"
      aria-label={label}
      disabled={disabled}
      value={current ?? null}
      options={options}
      emptyLabel={
        fallback === undefined ? undefined : (
          <span className="text-muted-foreground">
            {inheritedFrom} · {display(fallback)}
          </span>
        )
      }
      onValueChange={(next) => set(next ?? undefined)}
    />
  );

  const fields: { label: string; wide?: boolean; control: ReactNode }[] = [
    {
      label: "Model",
      control: (
        <>
          <Input
            list={modelListId}
            value={value.model ?? ""}
            placeholder={inherited?.model}
            disabled={disabled}
            spellCheck={false}
            className="font-mono text-xs md:text-xs"
            onChange={(event) =>
              onChange({
                model:
                  override && !event.target.value
                    ? undefined
                    : event.target.value,
              })
            }
          />
          <datalist id={modelListId}>
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </>
      ),
    },
    {
      label: "Effort",
      control: select<RunEffort>({
        label: "Effort",
        current: value.effort,
        fallback: inherited?.effort,
        options: EFFORT_OPTIONS,
        display: (effort) => effort,
        set: (effort) => onChange({ effort }),
      }),
    },
    {
      label: "Permissions",
      control: select<RunPermissionMode>({
        label: "Permissions",
        current: value.permissionMode,
        fallback: inherited?.permissionMode,
        options: PERMISSION_OPTIONS,
        display: (mode) => PERMISSION_LABEL[mode],
        set: (permissionMode) => onChange({ permissionMode }),
      }),
    },
    {
      label: "Credential",
      control: select<RunCredential>({
        label: "Credential",
        current: value.credential,
        fallback: inherited?.credential,
        options: CREDENTIAL_OPTIONS,
        display: (credential) => CREDENTIAL_LABEL[credential],
        set: (credential) => onChange({ credential }),
      }),
    },
    {
      label: "Timeout (min)",
      control: (
        <Input
          type="number"
          inputMode="numeric"
          min={RUN_TIMEOUT_MIN_MINUTES}
          max={RUN_TIMEOUT_MAX_MINUTES}
          step={5}
          value={value.timeoutMinutes ?? ""}
          placeholder={inherited ? String(inherited.timeoutMinutes) : undefined}
          disabled={disabled}
          className="tabular-nums"
          onChange={(event) => {
            const raw = event.target.value;
            const minutes = Number(raw);
            onChange({
              timeoutMinutes:
                raw === "" || !Number.isFinite(minutes)
                  ? override
                    ? undefined
                    : RUN_TIMEOUT_MIN_MINUTES
                  : Math.round(minutes),
            });
          }}
        />
      ),
    },
    {
      label: "Instructions",
      wide: true,
      control: (
        <Textarea
          value={value.instructions ?? ""}
          placeholder={inherited?.instructions || undefined}
          disabled={disabled}
          rows={3}
          className="min-h-16 resize-y font-mono text-xs md:text-xs"
          onChange={(event) =>
            onChange({
              instructions:
                override && !event.target.value
                  ? undefined
                  : event.target.value,
            })
          }
        />
      ),
    },
  ];

  if (layout === "properties") {
    return (
      <Properties className="gap-1">
        {fields.map((field) => (
          <Property
            key={field.label}
            label={field.label}
            className={field.wide ? "items-start" : undefined}
          >
            {field.control}
          </Property>
        ))}
      </Properties>
    );
  }

  return (
    <FormGrid>
      {fields.map((field) => (
        <FormField
          key={field.label}
          label={field.label}
          className={field.wide ? "sm:col-span-2" : undefined}
        >
          {field.control}
        </FormField>
      ))}
    </FormGrid>
  );
}

/** A complete config's validity, before it is sent. */
export function isRunConfigComplete(config: RunConfigOverride): boolean {
  if (config.model !== undefined && !config.model.trim()) return false;
  if (
    config.timeoutMinutes !== undefined &&
    (config.timeoutMinutes < RUN_TIMEOUT_MIN_MINUTES ||
      config.timeoutMinutes > RUN_TIMEOUT_MAX_MINUTES)
  )
    return false;
  return true;
}
