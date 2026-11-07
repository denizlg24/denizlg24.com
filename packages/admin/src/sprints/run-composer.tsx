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
import {
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuLabel,
  PromptInputActionMenuRadioGroup,
  PromptInputActionMenuRadioItem,
  PromptInputActionMenuSeparator,
  PromptInputButton,
} from "@repo/ui/ai-elements/prompt-input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@repo/ui/command";
import { DropdownMenuTrigger } from "@repo/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { cn } from "@repo/ui/utils";
import {
  Brain,
  Check,
  ChevronDown,
  ClipboardList,
  Cpu,
  FilePen,
  KeyRound,
  ScrollText,
  ShieldOff,
  Timer,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
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

interface ClaudeCodeModel {
  id: string;
  name: string;
}

export function useClaudeCodeModels(): ClaudeCodeModel[] {
  const { models } = useModelCatalog();
  return useMemo(() => {
    const byId = new Map<string, ClaudeCodeModel>(
      CLAUDE_CODE_ALIASES.map((alias) => [alias, { id: alias, name: alias }]),
    );
    for (const model of models ?? []) {
      if (!isAnthropicModel(model)) continue;
      const id = claudeCodeModelId(model.id);
      byId.set(id, { id, name: model.name });
    }
    return [...byId.values()];
  }, [models]);
}

const PERMISSION: Record<
  RunPermissionMode,
  { label: string; icon: typeof ShieldOff }
> = {
  bypassPermissions: { label: "Bypass", icon: ShieldOff },
  acceptEdits: { label: "Accept edits", icon: FilePen },
  plan: { label: "Plan", icon: ClipboardList },
};

const CREDENTIAL_LABEL: Record<RunCredential, string> = {
  subscription: "Subscription",
  gateway: "Gateway",
};

const TIMEOUT_PRESETS = [15, 30, 45, 60, 90, 120, 180, 240, 360].filter(
  (minutes) =>
    minutes >= RUN_TIMEOUT_MIN_MINUTES && minutes <= RUN_TIMEOUT_MAX_MINUTES,
);

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** Radio value standing for "no override". */
const INHERIT = "__inherit";

/** The pill every composer control shares; `set` is solid, inherited is faint. */
export function ComposerPill({
  icon,
  label,
  set,
  ...props
}: {
  icon: ReactNode;
  label: ReactNode;
  set: boolean;
} & Omit<Parameters<typeof PromptInputButton>[0], "children">) {
  return (
    <PromptInputButton
      active={set}
      {...props}
      className={cn(
        "max-w-48",
        !set &&
          "border-transparent bg-surface/70 text-muted-foreground hover:bg-surface",
        props.className,
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      <ChevronDown className="size-3 shrink-0 opacity-50" />
    </PromptInputButton>
  );
}

function RadioPill<T extends string>({
  label,
  icon,
  value,
  inherited,
  inheritedFrom,
  options,
  display,
  onChange,
  disabled,
}: {
  label: string;
  icon: ReactNode;
  value: T | undefined;
  inherited: T | undefined;
  inheritedFrom: string;
  options: readonly { value: T; label: string; icon?: ReactNode }[];
  display: (value: T) => string;
  onChange: (value: T | undefined) => void;
  disabled: boolean;
}) {
  const shown = value ?? inherited;
  return (
    <PromptInputActionMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <ComposerPill
          aria-label={label}
          title={label}
          icon={icon}
          label={shown ? display(shown) : label}
          set={value !== undefined}
          disabled={disabled}
        />
      </DropdownMenuTrigger>
      <PromptInputActionMenuContent side="bottom" className="w-52">
        <PromptInputActionMenuLabel>{label}</PromptInputActionMenuLabel>
        <PromptInputActionMenuRadioGroup
          value={value ?? INHERIT}
          onValueChange={(next) => {
            const option = options.find((entry) => entry.value === next);
            onChange(option?.value);
          }}
        >
          {inherited !== undefined ? (
            <>
              <PromptInputActionMenuRadioItem value={INHERIT}>
                <span className="flex-1">{inheritedFrom}</span>
                <span className="text-muted-foreground">
                  {display(inherited)}
                </span>
              </PromptInputActionMenuRadioItem>
              <PromptInputActionMenuSeparator />
            </>
          ) : null}
          {options.map((option) => (
            <PromptInputActionMenuRadioItem
              key={option.value}
              value={option.value}
            >
              {option.icon}
              {option.label}
            </PromptInputActionMenuRadioItem>
          ))}
        </PromptInputActionMenuRadioGroup>
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}

function ModelPill({
  value,
  inherited,
  inheritedFrom,
  onChange,
  disabled,
}: {
  value: string | undefined;
  inherited: string | undefined;
  inheritedFrom: string;
  onChange: (value: string | undefined) => void;
  disabled: boolean;
}) {
  const models = useClaudeCodeModels();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = value ?? inherited;
  const name = (id: string) =>
    models.find((model) => model.id === id)?.name ?? id;
  const custom = query.trim();
  const choose = (next: string | undefined) => {
    onChange(next);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <ComposerPill
          aria-label="Model"
          title={shown}
          icon={<Cpu />}
          label={shown ? name(shown) : "Model"}
          set={value !== undefined}
          disabled={disabled}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Model or Claude Code id"
          />
          <CommandList>
            <CommandEmpty className="py-0">
              {custom ? (
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left font-mono text-xs hover:bg-accent"
                  onClick={() => choose(custom)}
                >
                  {custom}
                </button>
              ) : (
                "—"
              )}
            </CommandEmpty>
            {inherited !== undefined ? (
              <CommandGroup>
                <CommandItem
                  value={`${INHERIT} ${inherited}`}
                  onSelect={() => choose(undefined)}
                  className="text-xs"
                >
                  <span className="flex-1">{inheritedFrom}</span>
                  <span className="text-muted-foreground">
                    {name(inherited)}
                  </span>
                  <Check
                    className={cn(
                      "size-3.5",
                      value === undefined ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              </CommandGroup>
            ) : null}
            {[
              {
                heading: "Latest",
                entries: models.filter((model) => model.name === model.id),
              },
              {
                heading: "Pinned",
                entries: models.filter((model) => model.name !== model.id),
              },
            ].map((group) =>
              group.entries.length === 0 ? null : (
                <CommandGroup key={group.heading} heading={group.heading}>
                  {group.entries.map((model) => (
                    <CommandItem
                      key={model.id}
                      value={`${model.name} ${model.id}`}
                      onSelect={() => choose(model.id)}
                      className="text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {model.name}
                      </span>
                      {model.name !== model.id ? (
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {model.id}
                        </span>
                      ) : null}
                      <Check
                        className={cn(
                          "size-3.5",
                          value === model.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ),
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function InstructionsPill({
  value,
  inherited,
  onChange,
  disabled,
}: {
  value: string | undefined;
  inherited: string | undefined;
  onChange: (value: string | undefined) => void;
  disabled: boolean;
}) {
  const set = value !== undefined;
  const has = (value ?? inherited ?? "").trim().length > 0;
  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <ComposerPill
          aria-label="Instructions"
          icon={<ScrollText />}
          label={
            set ? "Instructions" : has ? "Sprint instructions" : "Instructions"
          }
          set={set}
          disabled={disabled}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-96 flex-col gap-2 p-2">
        <textarea
          value={value ?? ""}
          placeholder={inherited || "Appended to every prompt"}
          rows={8}
          className="min-h-32 w-full resize-y rounded-md bg-surface/60 p-2 font-mono text-xs outline-none placeholder:text-muted-foreground/60"
          onChange={(event) =>
            onChange(event.target.value ? event.target.value : undefined)
          }
        />
        {set ? (
          <button
            type="button"
            className="self-start text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onChange(undefined)}
          >
            Use the sprint's
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** The run settings as pills. With `inherited`, an unset field keeps that value. */
export function RunConfigPills({
  value,
  inherited,
  inheritedFrom = "Sprint",
  onChange,
  disabled = false,
  instructions = false,
}: {
  value: RunConfigOverride;
  inherited?: RunConfig;
  inheritedFrom?: string;
  onChange: (patch: RunConfigOverride) => void;
  disabled?: boolean;
  /** An instructions pill, for when the text box holds something else. */
  instructions?: boolean;
}) {
  const PermissionIcon =
    PERMISSION[
      value.permissionMode ?? inherited?.permissionMode ?? "bypassPermissions"
    ].icon;
  return (
    <>
      <ModelPill
        value={value.model}
        inherited={inherited?.model}
        inheritedFrom={inheritedFrom}
        disabled={disabled}
        onChange={(model) => onChange({ model })}
      />
      <RadioPill<RunEffort>
        label="Effort"
        icon={<Brain />}
        value={value.effort}
        inherited={inherited?.effort}
        inheritedFrom={inheritedFrom}
        options={RUN_EFFORTS.map((effort) => ({
          value: effort,
          label: effort,
        }))}
        display={(effort) => effort}
        disabled={disabled}
        onChange={(effort) => onChange({ effort })}
      />
      <RadioPill<RunPermissionMode>
        label="Permissions"
        icon={<PermissionIcon />}
        value={value.permissionMode}
        inherited={inherited?.permissionMode}
        inheritedFrom={inheritedFrom}
        options={runPermissionModeSchema.options.map((mode) => {
          const Icon = PERMISSION[mode].icon;
          return { value: mode, label: PERMISSION[mode].label, icon: <Icon /> };
        })}
        display={(mode) => PERMISSION[mode].label}
        disabled={disabled}
        onChange={(permissionMode) => onChange({ permissionMode })}
      />
      <RadioPill<RunCredential>
        label="Credential"
        icon={<KeyRound />}
        value={value.credential}
        inherited={inherited?.credential}
        inheritedFrom={inheritedFrom}
        options={runCredentialSchema.options.map((credential) => ({
          value: credential,
          label: CREDENTIAL_LABEL[credential],
        }))}
        display={(credential) => CREDENTIAL_LABEL[credential]}
        disabled={disabled}
        onChange={(credential) => onChange({ credential })}
      />
      <RadioPill<string>
        label="Timeout"
        icon={<Timer />}
        value={
          value.timeoutMinutes === undefined
            ? undefined
            : String(value.timeoutMinutes)
        }
        inherited={
          inherited === undefined ? undefined : String(inherited.timeoutMinutes)
        }
        inheritedFrom={inheritedFrom}
        options={[
          ...new Set([
            ...TIMEOUT_PRESETS,
            ...(value.timeoutMinutes ? [value.timeoutMinutes] : []),
          ]),
        ]
          .sort((left, right) => left - right)
          .map((minutes) => ({
            value: String(minutes),
            label: formatMinutes(minutes),
          }))}
        display={(minutes) => formatMinutes(Number(minutes))}
        disabled={disabled}
        onChange={(minutes) =>
          onChange({
            timeoutMinutes: minutes === undefined ? undefined : Number(minutes),
          })
        }
      />
      {instructions ? (
        <InstructionsPill
          value={value.instructions}
          inherited={inherited?.instructions}
          disabled={disabled}
          onChange={(text) => onChange({ instructions: text })}
        />
      ) : null}
    </>
  );
}

const STATIC_PILL =
  "inline-flex h-7 max-w-64 shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0";

/** A pill that only shows a value; a link when given `href`. */
export function StaticPill({
  icon,
  children,
  href,
  className,
  title,
}: {
  icon?: ReactNode;
  children: ReactNode;
  href?: string;
  className?: string;
  title?: string;
}) {
  const body = (
    <>
      {icon}
      <span className="truncate">{children}</span>
    </>
  );
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      className={cn(
        STATIC_PILL,
        "transition-colors hover:bg-surface hover:text-foreground",
        className,
      )}
    >
      {body}
    </a>
  ) : (
    <span title={title} className={cn(STATIC_PILL, className)}>
      {body}
    </span>
  );
}

/** A run's settings as it actually ran: read-only pills. */
export function RunConfigSummary({ config }: { config: RunConfig }) {
  const Permission = PERMISSION[config.permissionMode].icon;
  return (
    <>
      <StaticPill icon={<Cpu />} title="Model">
        <span className="font-mono">{config.model}</span>
      </StaticPill>
      <StaticPill icon={<Brain />} title="Effort">
        {config.effort}
      </StaticPill>
      <StaticPill icon={<Permission />} title="Permissions">
        {PERMISSION[config.permissionMode].label}
      </StaticPill>
      <StaticPill icon={<KeyRound />} title="Credential">
        {CREDENTIAL_LABEL[config.credential]}
      </StaticPill>
      <StaticPill icon={<Timer />} title="Timeout">
        {formatMinutes(config.timeoutMinutes)}
      </StaticPill>
    </>
  );
}

/**
 * A prompt box: the text a run starts from, with whatever shapes it as pills
 * underneath. Not a form — it sits inside dialogs that are one.
 */
export function Composer({
  value,
  onChange,
  placeholder,
  disabled = false,
  rows = 6,
  label,
  pills,
  footerEnd,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  label: string;
  pills?: ReactNode;
  footerEnd?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] transition-[border-color] focus-within:border-ring/40",
        disabled && "opacity-70",
        className,
      )}
    >
      <textarea
        aria-label={label}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        rows={rows}
        className="field-sizing-content max-h-[50vh] min-h-24 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
        onChange={(event) => onChange(event.target.value)}
      />
      {pills || footerEnd ? (
        <div className="flex min-w-0 items-end justify-between gap-2 px-2 pb-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {pills}
          </div>
          {footerEnd ? (
            <div className="flex shrink-0 items-center gap-1.5">
              {footerEnd}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
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
