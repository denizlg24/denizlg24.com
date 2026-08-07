"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import type {
  DeployEnvScope,
  DeployEnvVar,
  DeployEnvVarInput,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Input } from "@repo/ui/input";
import { NativeSelect } from "@repo/ui/native-select";
import { Skeleton } from "@repo/ui/skeleton";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

type Draft = {
  key: string;
  source: "literal" | "binding" | "template";
  value: string;
  /** True until the value box is touched, so a stored secret is kept, not wiped. */
  keepStored: boolean;
  reference: string;
  template: string;
  scope: DeployEnvScope;
  buildTime: boolean;
  runTime: boolean;
};

function toDraft(row: DeployEnvVar): Draft {
  return {
    key: row.key,
    source: row.source,
    value: "",
    keepStored: row.hasValue,
    reference: row.reference ?? "",
    template: row.template ?? "",
    scope: row.scope,
    buildTime: row.buildTime,
    runTime: row.runTime,
  };
}

function toInput(draft: Draft): DeployEnvVarInput {
  const base = {
    key: draft.key,
    scope: draft.scope,
    buildTime: draft.buildTime,
    runTime: draft.runTime,
  };
  if (draft.source === "binding") {
    return { ...base, source: "binding", reference: draft.reference };
  }
  if (draft.source === "template") {
    return { ...base, source: "template", template: draft.template };
  }
  // Omitting `value` is what tells the API to keep the stored secret; sending
  // an empty string would overwrite it with one.
  return {
    ...base,
    source: "literal",
    ...(draft.keepStored && draft.value.length === 0
      ? {}
      : { value: draft.value }),
  };
}

const emptyDraft: Draft = {
  key: "",
  source: "literal",
  value: "",
  keepStored: false,
  reference: "",
  template: "",
  scope: "all",
  buildTime: false,
  runTime: true,
};

export function EnvPanel({ targetId }: { targetId: string }) {
  const fetchEnv = useCallback(() => api.deploy.env(targetId), [targetId]);
  const { data, error, loading, reload } = usePoll(fetchEnv, null);
  const fetchBindings = useCallback(
    () => api.deploy.bindings(targetId),
    [targetId],
  );
  const { data: bindings } = usePoll(fetchBindings, null);

  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setDrafts(data.map(toDraft));
  }, [data]);

  function patch(index: number, changes: Partial<Draft>) {
    setDrafts((current) =>
      (current ?? []).map((draft, i) =>
        i === index ? { ...draft, ...changes } : draft,
      ),
    );
  }

  async function save() {
    if (!drafts) return;
    setBusy(true);
    try {
      await api.deploy.replaceEnv(targetId, { vars: drafts.map(toInput) });
      toast.success("Environment saved");
      await reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!drafts && loading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-3xl text-xs">
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Key</th>
              <th className="py-2 text-left font-medium">Source</th>
              <th className="py-2 text-left font-medium">Value</th>
              <th className="py-2 text-left font-medium">Scope</th>
              <th className="py-2 text-left font-medium">Build</th>
              <th className="py-2 text-left font-medium">Run</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(drafts ?? []).map((draft, index) => (
              <tr
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorderable
                key={index}
                className="border-b last:border-0"
              >
                <td className="py-1.5 pr-2">
                  <Input
                    value={draft.key}
                    className="h-8 font-mono text-xs"
                    onChange={(event) =>
                      patch(index, { key: event.target.value })
                    }
                  />
                  {/* The one piece of explanatory copy this system gets: a
                      NEXT_PUBLIC_* var is baked into the bundle at build time,
                      so changing it does nothing until the next build. */}
                  {draft.key.startsWith("NEXT_PUBLIC_") && (
                    <span className="text-[10px] text-muted-foreground">
                      requires rebuild
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  <NativeSelect
                    size="sm"
                    value={draft.source}
                    className="text-xs"
                    onChange={(event) =>
                      patch(index, {
                        source: event.target.value as Draft["source"],
                      })
                    }
                  >
                    <option value="literal">literal</option>
                    <option value="binding">binding</option>
                    <option value="template">template</option>
                  </NativeSelect>
                </td>
                <td className="py-1.5 pr-2">
                  {draft.source === "binding" ? (
                    <NativeSelect
                      size="sm"
                      value={draft.reference}
                      className="w-full text-xs"
                      onChange={(event) =>
                        patch(index, { reference: event.target.value })
                      }
                    >
                      <option value="">—</option>
                      {(bindings?.bindings ?? []).map((binding) => (
                        <option
                          key={binding.reference}
                          value={binding.reference}
                          disabled={!binding.available}
                        >
                          {binding.reference}
                          {binding.available ? "" : " (unavailable)"}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Input
                      value={
                        draft.source === "template"
                          ? draft.template
                          : draft.value
                      }
                      type={draft.source === "literal" ? "password" : "text"}
                      placeholder={
                        draft.source === "literal" && draft.keepStored
                          ? "stored"
                          : ""
                      }
                      className="h-8 font-mono text-xs"
                      onChange={(event) =>
                        patch(
                          index,
                          draft.source === "template"
                            ? { template: event.target.value }
                            : { value: event.target.value },
                        )
                      }
                    />
                  )}
                </td>
                <td className="py-1.5 pr-2">
                  <NativeSelect
                    size="sm"
                    value={draft.scope}
                    className="text-xs"
                    onChange={(event) =>
                      patch(index, {
                        scope: event.target.value as DeployEnvScope,
                      })
                    }
                  >
                    <option value="all">all</option>
                    <option value="production">production</option>
                    <option value="preview">preview</option>
                  </NativeSelect>
                </td>
                <td className="py-1.5 pr-2">
                  <Checkbox
                    checked={draft.buildTime}
                    onCheckedChange={(checked) =>
                      patch(index, { buildTime: checked === true })
                    }
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <Checkbox
                    checked={draft.runTime}
                    onCheckedChange={(checked) =>
                      patch(index, { runTime: checked === true })
                    }
                  />
                </td>
                <td className="py-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setDrafts((current) =>
                        (current ?? []).filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setDrafts((current) => [...(current ?? []), { ...emptyDraft }])
          }
        >
          <Plus className="size-3" />
          Add
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}
