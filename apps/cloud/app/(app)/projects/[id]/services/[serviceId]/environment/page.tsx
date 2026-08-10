"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import type {
  DeployEnvScope,
  DeployEnvVar,
  DeployEnvVarInput,
} from "@repo/schemas/cloud";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { NativeSelect } from "@repo/ui/native-select";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { TemplateInput } from "@/components/deploy/template-input";
import { api, errorMessage } from "@/lib/api";
import { useTarget } from "../_components/target-context";

type Draft = {
  key: string;
  source: "literal" | "binding" | "template";
  value: string;
  /** True until the value box is touched, so a stored secret is kept, not wiped. */
  keepStored: boolean;
  reference: string;
  template: string;
  scope: DeployEnvScope;
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
  };
}

function toInput(draft: Draft): DeployEnvVarInput {
  const base = { key: draft.key, scope: draft.scope };
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
};

/**
 * What a save has to do to reach the running containers.
 *
 * A `NEXT_PUBLIC_*` variable is read by the bundler, not by the process, so its
 * value is already inside the built JavaScript — recreating the container with a
 * new one changes nothing and the only fix is another build. Everything else is
 * read at runtime, so replacing the container is enough.
 *
 * Derived from the keys that actually moved rather than tracked as a flag on the
 * target: a stored dirty bit would still be set after the next deploy cleared it,
 * and would survive a page reload as a banner nobody can dismiss.
 */
type EnvEffect = "rebuild" | "restart" | "none";

function effectOf(before: DeployEnvVar[], after: Draft[]): EnvEffect {
  const previous = new Map(before.map((row) => [row.key, row]));
  const changed = new Set<string>();

  for (const draft of after) {
    if (draft.key.length === 0) continue;
    const existing = previous.get(draft.key);
    if (!existing) {
      changed.add(draft.key);
      continue;
    }
    // A literal whose box was never touched keeps its stored value, so it did
    // not change however much else on the row did.
    const valueMoved =
      draft.source !== existing.source ||
      draft.scope !== existing.scope ||
      (draft.source === "literal" && draft.value.length > 0) ||
      (draft.source === "binding" && draft.reference !== existing.reference) ||
      (draft.source === "template" && draft.template !== existing.template);
    if (valueMoved) changed.add(draft.key);
  }
  const keys = new Set(after.map((draft) => draft.key));
  for (const row of before) {
    if (!keys.has(row.key)) changed.add(row.key);
  }

  if (changed.size === 0) return "none";
  return [...changed].some((key) => key.startsWith("NEXT_PUBLIC_"))
    ? "rebuild"
    : "restart";
}

export default function EnvironmentPage() {
  const { target } = useTarget();
  const targetId = target.id;
  const fetchEnv = useCallback(() => api.deploy.env(targetId), [targetId]);
  const { data, error, loading, reload } = usePoll(fetchEnv, null);
  const fetchBindings = useCallback(
    () => api.deploy.bindings(targetId),
    [targetId],
  );
  const { data: bindings } = usePoll(fetchBindings, null);

  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<EnvEffect>("none");
  const [applying, setApplying] = useState(false);

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
    // Computed before the save, while `data` still holds what was stored.
    const effect = effectOf(data ?? [], drafts);
    try {
      await api.deploy.replaceEnv(targetId, { vars: drafts.map(toInput) });
      toast.success("Environment saved");
      await reload();
      setPending(effect);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function applyNow() {
    setApplying(true);
    try {
      const report = await api.deploy.applyEnv(targetId);
      const failed = report.results.filter((result) => !result.recreated);
      if (failed.length === 0) {
        toast.success(
          report.applied === 0
            ? "No running deployment to update"
            : `Restarted ${report.applied} deployment${report.applied === 1 ? "" : "s"}`,
        );
      } else {
        // Naming the deployment matters here: production may well have taken the
        // change while one preview did not.
        for (const result of failed) {
          toast.error(`${result.hostname}: ${result.error ?? "failed"}`);
        }
      }
      setPending("none");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setApplying(false);
    }
  }

  async function rebuildNow() {
    setApplying(true);
    try {
      await api.deploy.create(targetId, {
        ref: target.productionBranch,
        kind: "production",
      });
      toast.success("Deployment queued");
      setPending("none");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setApplying(false);
    }
  }

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!drafts && loading) return <Skeleton className="h-48 w-full" />;

  const rows = drafts ?? [];

  return (
    <Section
      title="Environment variables"
      count={rows.length}
      actions={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDrafts([...rows, { ...emptyDraft }])}
          >
            <Plus className="size-3" />
            Add
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col">
        <div className="hidden gap-3 border-b pb-2 text-xs text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.4fr)_7rem_2rem]">
          <span>Key</span>
          <span>Source</span>
          <span>Value</span>
          <span>Scope</span>
          <span />
        </div>
        {rows.map((draft, index) => (
          <div
            key={index}
            className="grid grid-cols-1 gap-2 border-b py-2 md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.4fr)_7rem_2rem] md:gap-3"
          >
            <Input
              value={draft.key}
              placeholder="KEY"
              className="h-8 font-mono text-xs"
              onChange={(event) => patch(index, { key: event.target.value })}
            />
            <NativeSelect
              size="sm"
              value={draft.source}
              className="text-xs"
              onChange={(event) =>
                patch(index, { source: event.target.value as Draft["source"] })
              }
            >
              <option value="literal">literal</option>
              <option value="binding">binding</option>
              <option value="template">template</option>
            </NativeSelect>
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
            ) : draft.source === "template" ? (
              <TemplateInput
                value={draft.template}
                bindings={bindings?.bindings ?? []}
                onChange={(template) => patch(index, { template })}
              />
            ) : (
              <Input
                value={draft.value}
                type="password"
                placeholder={draft.keepStored ? "stored" : ""}
                className="h-8 font-mono text-xs"
                onChange={(event) =>
                  patch(index, { value: event.target.value })
                }
              />
            )}
            <NativeSelect
              size="sm"
              value={draft.scope}
              className="text-xs"
              onChange={(event) =>
                patch(index, { scope: event.target.value as DeployEnvScope })
              }
            >
              <option value="all">all</option>
              <option value="production">production</option>
              <option value="preview">preview</option>
            </NativeSelect>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setDrafts(rows.filter((_, position) => position !== index))
              }
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="py-2 text-xs text-muted-foreground">—</p>
        )}
      </div>

      <AlertDialog
        open={pending !== "none"}
        onOpenChange={(open) => {
          if (!open) setPending("none");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === "rebuild" ? "Redeploy required" : "Restart required"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === "rebuild"
                ? "A NEXT_PUBLIC_ variable is compiled into the bundle, so this change needs a new build to take effect."
                : "Running containers keep the environment they were created with, so they need to be recreated to pick this up."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Later</AlertDialogCancel>
            <AlertDialogAction
              disabled={applying}
              onClick={(event) => {
                // The action closes the dialog by default, and this work has to
                // report back into it.
                event.preventDefault();
                void (pending === "rebuild" ? rebuildNow() : applyNow());
              }}
            >
              {applying
                ? "Working…"
                : pending === "rebuild"
                  ? "Redeploy"
                  : "Restart"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
