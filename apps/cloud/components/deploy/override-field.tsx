"use client";

import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Switch } from "@repo/ui/switch";
import { useId } from "react";

/**
 * One build setting: what the preset resolved, and a switch to replace it.
 *
 * Off is not "empty" — it is "whatever the preset says", and the preset's answer
 * is shown in the box so that is legible without turning the switch on to find
 * out. Turning it on seeds the box with that same value, because the common
 * edit is a tweak to the detected command rather than a command from nothing.
 *
 * `null` from the preset means the field genuinely has no default (a Hono app
 * declaring no build script), which is a different thing from a default of ""
 * and is shown as such.
 */
export function OverrideField({
  label,
  preset,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  /** What the preset resolved for this field; null when it has no answer. */
  preset: string | null;
  /** The override, or null when the preset's value is in use. */
  value: string | null;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}) {
  const id = useId();
  const overridden = value !== null;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={overridden ? value : (preset ?? "")}
          placeholder={placeholder ?? (preset === null ? "N/A" : undefined)}
          disabled={disabled || !overridden}
          className="font-mono text-xs disabled:opacity-60"
          onChange={(event) => onChange(event.target.value)}
        />
        <Switch
          checked={overridden}
          disabled={disabled}
          aria-label={`Override ${label}`}
          onCheckedChange={(next) => onChange(next ? (preset ?? "") : null)}
        />
      </div>
    </div>
  );
}

/**
 * The same contract for a fixed set of choices. `null` is the preset's answer
 * rather than a valid option, so it is not an item in the list — the switch is
 * what distinguishes "the preset picked this" from "I picked this".
 */
export function OverrideSelect<T extends string>({
  label,
  preset,
  presetLabel,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  preset: T | null;
  /** Shown while the switch is off, when the raw value is not what to display. */
  presetLabel?: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T | null) => void;
}) {
  const id = useId();
  const overridden = value !== null;

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <select
          id={id}
          value={overridden ? value : ""}
          disabled={disabled || !overridden}
          className="h-9 w-full rounded-md border bg-transparent px-2 font-mono text-xs disabled:opacity-60"
          onChange={(event) => onChange(event.target.value as T)}
        >
          {!overridden && (
            <option value="">{presetLabel ?? preset ?? "N/A"}</option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Switch
          checked={overridden}
          disabled={disabled}
          aria-label={`Override ${label}`}
          onCheckedChange={(next) =>
            onChange(next ? (preset ?? options[0]?.value ?? null) : null)
          }
        />
      </div>
    </div>
  );
}
