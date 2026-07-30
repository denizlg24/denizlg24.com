"use client";

import { useCallback, useMemo, useState } from "react";
import type { z } from "zod";
import { Button } from "./button";
import { Textarea } from "./textarea";
import { cn } from "./utils";

export type JsonDraftResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function describeZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join(" · ");
}

function evaluate<T>(schema: z.ZodType<T>, text: string): JsonDraftResult<T> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid JSON",
    };
  }
  const parsed = schema.safeParse(value);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, error: describeZodError(parsed.error) };
}

export interface JsonDraft<T> {
  text: string;
  setText: (value: string) => void;
  result: JsonDraftResult<T>;
  reset: (next: unknown) => void;
  format: () => void;
}

export function useJsonDraft<T>(
  schema: z.ZodType<T>,
  initial: unknown,
): JsonDraft<T> {
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2));
  const result = useMemo(() => evaluate(schema, text), [schema, text]);

  const reset = useCallback((next: unknown) => {
    setText(JSON.stringify(next, null, 2));
  }, []);

  const format = useCallback(() => {
    setText((current) => {
      try {
        return JSON.stringify(JSON.parse(current), null, 2);
      } catch {
        return current;
      }
    });
  }, []);

  return { text, setText, result, reset, format };
}

// Structurally satisfied by any JsonDraft<T> — the editor never needs the
// parsed value, only whether it parsed.
interface JsonEditorDraft {
  text: string;
  setText: (value: string) => void;
  result: { ok: true } | { ok: false; error: string };
  format: () => void;
}

export interface JsonTemplate {
  label: string;
  value: unknown;
}

export function JsonEditor({
  id,
  draft,
  rows = 16,
  templates,
  className,
}: {
  id: string;
  draft: JsonEditorDraft;
  rows?: number;
  templates?: readonly JsonTemplate[];
  className?: string;
}) {
  return (
    // min-w-0 keeps this from widening a grid parent (DialogContent) past its
    // own max-width, which an auto track will happily do.
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span
          className={cn(
            "shrink-0 font-mono text-[11px]",
            draft.result.ok ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {draft.result.ok ? "valid" : "invalid"}
        </span>
        <div className="flex min-w-0 shrink items-center justify-end gap-1 overflow-x-auto">
          {templates?.map((template) => (
            <Button
              key={template.label}
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11px] text-muted-foreground"
              onClick={() =>
                draft.setText(JSON.stringify(template.value, null, 2))
              }
            >
              {template.label}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[11px]"
            onClick={draft.format}
          >
            format
          </Button>
        </div>
      </div>
      <Textarea
        id={id}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        rows={rows}
        className="w-full min-w-0 resize-y font-mono text-xs leading-relaxed"
        value={draft.text}
        onChange={(event) => draft.setText(event.target.value)}
      />
      {!draft.result.ok && (
        // break-all so a long unbroken token — schema errors quote raw regexes
        // — can never set a min-content width, and line-clamp to bound growth.
        <p
          className="line-clamp-3 min-w-0 break-all font-mono text-[11px] text-destructive"
          title={draft.result.error}
        >
          {draft.result.error}
        </p>
      )}
    </div>
  );
}
