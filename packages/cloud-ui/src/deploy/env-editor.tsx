"use client";

import {
  DEPLOY_ENV_SCOPES,
  type DeployEnvScope,
  parseDotenv,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { OptionSelect } from "@repo/ui/option-select";
import { Textarea } from "@repo/ui/textarea";
import { useState } from "react";
import { toast } from "sonner";

export interface EnvDraftRow {
  key: string;
  value: string;
  scope: DeployEnvScope;
}

/** The scope enum as picker options. Exported so the target's env page agrees. */
export const ENV_SCOPES: readonly { value: DeployEnvScope; label: string }[] =
  DEPLOY_ENV_SCOPES.map((scope) => ({ value: scope, label: scope }));

export function emptyEnvRow(): EnvDraftRow {
  return { key: "", value: "", scope: "all" };
}

/**
 * Literals only. The bindings a project already has — Postgres, Mongo, Redis,
 * S3 — are seeded by the API when the target is created, so offering them here
 * would be a second way to write rows the server is about to write anyway.
 * A key typed here that collides with a seed replaces it.
 */
export function EnvEditor({
  rows,
  onChange,
}: {
  rows: EnvDraftRow[];
  onChange: (rows: EnvDraftRow[]) => void;
}) {
  const [paste, setPaste] = useState("");
  const [pasting, setPasting] = useState(false);

  function applyPaste() {
    const parsed = parseDotenv(paste);
    if (parsed.entries.length === 0) {
      toast.error("Nothing to import");
      return;
    }
    const merged = new Map(
      rows.filter((row) => row.key).map((r) => [r.key, r]),
    );
    for (const entry of parsed.entries) {
      merged.set(entry.key, {
        key: entry.key,
        value: entry.value,
        scope: "all",
      });
    }
    onChange([...merged.values()]);
    setPaste("");
    setPasting(false);

    const problems = [
      parsed.invalidKeys.length > 0 &&
        `${parsed.invalidKeys.length} invalid name(s)`,
      parsed.skippedLines.length > 0 &&
        `${parsed.skippedLines.length} unreadable line(s)`,
    ].filter((entry): entry is string => typeof entry === "string");

    if (problems.length > 0) {
      toast.warning(
        `Imported ${parsed.entries.length} — skipped ${problems.join(", ")}`,
      );
      return;
    }
    toast.success(`Imported ${parsed.entries.length}`);
  }

  function update(index: number, changes: Partial<EnvDraftRow>) {
    onChange(
      rows.map((row, at) => (at === index ? { ...row, ...changes } : row)),
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {rows.map((row, index) => (
            <div
              // Index-keyed on purpose: the key field is what the user is
              // editing, so keying on it remounts the input on every keystroke
              // and loses focus.
              key={index}
              className="flex items-center gap-1.5"
            >
              <Input
                value={row.key}
                placeholder="KEY"
                className="h-8 flex-1 font-mono text-xs"
                onChange={(event) => update(index, { key: event.target.value })}
              />
              <Input
                value={row.value}
                placeholder="value"
                className="h-8 flex-[2] font-mono text-xs"
                onChange={(event) =>
                  update(index, { value: event.target.value })
                }
              />
              <OptionSelect<DeployEnvScope>
                className="h-8 w-28"
                aria-label="Scope"
                value={row.scope}
                onValueChange={(scope) =>
                  update(index, { scope: scope ?? "all" })
                }
                options={ENV_SCOPES}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => onChange(rows.filter((_, at) => at !== index))}
              >
                ×
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...rows, emptyEnvRow()])}
        >
          Add
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setPasting((current) => !current)}
        >
          Paste .env
        </Button>
      </div>

      {pasting && (
        <div className="flex flex-col gap-2">
          <Textarea
            value={paste}
            rows={6}
            spellCheck={false}
            className="font-mono text-xs"
            onChange={(event) => setPaste(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={applyPaste} disabled={!paste.trim()}>
              Import
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setPaste("");
                setPasting(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
