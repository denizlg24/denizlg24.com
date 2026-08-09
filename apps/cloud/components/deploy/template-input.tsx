"use client";

import {
  type DeployBindingValue,
  extractTemplateReferences,
  isDeployBindingReference,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Braces } from "lucide-react";
import { useRef, useState } from "react";

/** The reference's namespace, matching how `parseBindingReference` splits it. */
function namespaceOf(reference: string): string {
  return reference.slice(0, reference.lastIndexOf("."));
}

function groupByNamespace(
  bindings: readonly DeployBindingValue[],
): [string, DeployBindingValue[]][] {
  const groups = new Map<string, DeployBindingValue[]>();
  for (const binding of bindings) {
    const namespace = namespaceOf(binding.reference);
    const existing = groups.get(namespace);
    if (existing) existing.push(binding);
    else groups.set(namespace, [binding]);
  }
  return [...groups];
}

/**
 * A template is a string with `${namespace.field}` holes in it, and the only
 * way to know which holes exist was to have read the schema. This is the same
 * list the `binding` source gets from its select, spendable one reference at a
 * time into a string that also holds literal text.
 *
 * The references already in the template are echoed under the box because the
 * vocabulary is closed: `database.postgres.urL` is accepted by the input, and
 * without this it is first reported three minutes into a build.
 */
export function TemplateInput({
  value,
  bindings,
  onChange,
}: {
  value: string;
  bindings: readonly DeployBindingValue[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const available = new Map(
    bindings.map((binding) => [binding.reference, binding]),
  );
  const used = extractTemplateReferences(value).map((reference) => ({
    reference,
    // Unknown to the vocabulary, or known but not provisioned on this project.
    // Both fail the pre-flight check; they read differently to a human.
    known: isDeployBindingReference(reference),
    available: available.get(reference)?.available ?? false,
  }));

  function insert(reference: string) {
    const element = input.current;
    const token = `\${${reference}}`;
    // Inserted at the caret rather than appended: a template is usually a
    // connection string being assembled around its holes, not a list.
    const at = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? at;
    onChange(`${value.slice(0, at)}${token}${value.slice(end)}`);
    setOpen(false);
    requestAnimationFrame(() => {
      element?.focus();
      const caret = at + token.length;
      element?.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          ref={input}
          value={value}
          placeholder="postgres://${database.postgres.user}@host"
          className="h-8 font-mono text-xs"
          onChange={(event) => onChange(event.target.value)}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 px-2"
              aria-label="Insert a binding reference"
            >
              <Braces className="size-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-0">
            <div className="flex max-h-72 flex-col overflow-y-auto p-1">
              {groupByNamespace(bindings).map(([namespace, group]) => (
                <div key={namespace} className="flex flex-col">
                  <span className="px-2 pt-2 pb-1 font-mono text-[10px] text-muted-foreground">
                    {namespace}
                  </span>
                  {group.map((binding) => (
                    <button
                      key={binding.reference}
                      type="button"
                      disabled={!binding.available}
                      onClick={() => insert(binding.reference)}
                      className="flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-left font-mono text-xs hover:bg-muted/60 disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <span className="truncate">
                        {binding.reference.slice(namespace.length + 1)}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {binding.available
                          ? binding.secret
                            ? "secret"
                            : ""
                          : "unavailable"}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {used.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {used.map((entry) => (
            <span
              key={entry.reference}
              className={`rounded-sm px-1 font-mono text-[10px] ${
                entry.known && entry.available
                  ? "text-muted-foreground"
                  : "text-destructive"
              }`}
            >
              {entry.reference}
              {entry.known
                ? entry.available
                  ? ""
                  : " unavailable"
                : " unknown"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
