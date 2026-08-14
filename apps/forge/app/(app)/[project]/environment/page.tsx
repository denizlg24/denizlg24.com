"use client";

import {
  envScopeOptions,
  envScopeValue,
  parseEnvScopeValue,
} from "@repo/cloud-ui/deploy/env-editor";
import { TemplateInput } from "@repo/cloud-ui/deploy/template-input";
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
import { OptionSelect } from "@repo/ui/option-select";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTarget } from "@/components/target-context";
import { api, errorMessage } from "@/lib/api";

/**
 * `id` is what every edit addresses, rather than a position in the array. The
 * filters below render a subset, so an index would patch whichever row happened
 * to sit at that position in the full list — silently editing the wrong
 * variable whenever a search is active.
 */
type Draft = {
  id: string;
  key: string;
  source: "literal" | "binding" | "template";
  value: string;
  /** True until the value box is touched, so a stored secret is kept, not wiped. */
  keepStored: boolean;
  reference: string;
  template: string;
  scope: DeployEnvScope;
  /** Set exactly when `scope` is `environment`; the two move together. */
  environmentId: string | null;
};

const ENV_SOURCES: readonly { value: Draft["source"]; label: string }[] = [
  { value: "literal", label: "literal" },
  { value: "binding", label: "binding" },
  { value: "template", label: "template" },
];

function toDraft(row: DeployEnvVar): Draft {
  return {
    id: row.id,
    key: row.key,
    source: row.source,
    value: "",
    keepStored: row.hasValue,
    reference: row.reference ?? "",
    template: row.template ?? "",
    scope: row.scope,
    environmentId: row.environmentId,
  };
}

function toInput(draft: Draft): DeployEnvVarInput {
  const base = {
    key: draft.key,
    scope: draft.scope,
    environmentId: draft.environmentId,
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

function emptyDraft(): Draft {
  return {
    id: crypto.randomUUID(),
    key: "",
    source: "literal",
    value: "",
    keepStored: false,
    reference: "",
    template: "",
    scope: "all",
    environmentId: null,
  };
}

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
type EnvEffect = "rebuild-production" | "rebuild-preview" | "restart" | "none";

function effectOf(before: DeployEnvVar[], after: Draft[]): EnvEffect {
  const previous = new Map(before.map((row) => [row.key, row]));
  const changed = new Map<string, DeployEnvScope>();

  for (const draft of after) {
    if (draft.key.length === 0) continue;
    const existing = previous.get(draft.key);
    if (!existing) {
      changed.set(draft.key, draft.scope);
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
    if (valueMoved) changed.set(draft.key, draft.scope);
  }
  const keys = new Set(after.map((draft) => draft.key));
  for (const row of before) {
    if (!keys.has(row.key)) changed.set(row.key, row.scope);
  }

  if (changed.size === 0) return "none";
  const publicScopes = [...changed]
    .filter(([key]) => key.startsWith("NEXT_PUBLIC_"))
    .map(([, scope]) => scope);
  if (publicScopes.length === 0) return "restart";
  // The scope decides which build has to happen, and getting this wrong is not
  // cosmetic: offering "Redeploy" for a preview-scoped variable would queue a
  // production deployment off the production branch, shipping every commit that
  // has landed there since the last release — none of which was asked for here.
  return publicScopes.some((scope) => scope !== "preview")
    ? "rebuild-production"
    : "rebuild-preview";
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
  const fetchEnvironments = useCallback(
    () => api.deploy.environments(targetId),
    [targetId],
  );
  const { data: environments } = usePoll(fetchEnvironments, null);
  const scopeOptions = useMemo(
    () => envScopeOptions(environments ?? []),
    [environments],
  );

  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<EnvEffect>("none");
  const [applying, setApplying] = useState(false);
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");

  useEffect(() => {
    if (data) setDrafts(data.map(toDraft));
  }, [data]);

  const rows = useMemo(() => drafts ?? [], [drafts]);

  /**
   * A row being edited stays visible whatever the filters say — a new row has an
   * empty key and would otherwise vanish the moment it was added under a search.
   */
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((draft) => {
      if (draft.key.length === 0) return true;
      if (needle.length > 0 && !draft.key.toLowerCase().includes(needle)) {
        return false;
      }
      return scopeFilter === "" || envScopeValue(draft) === scopeFilter;
    });
  }, [rows, search, scopeFilter]);

  function patch(id: string, changes: Partial<Draft>) {
    setDrafts((current) =>
      (current ?? []).map((draft) =>
        draft.id === id ? { ...draft, ...changes } : draft,
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
        setPending("none");
      } else {
        // Naming the deployment matters here: production may well have taken the
        // change while one preview did not. The dialog deliberately stays open —
        // those containers are still running the old environment, and closing it
        // would leave a toast that disappears as the only trace, with no way back
        // to the action short of editing a variable and saving again.
        for (const result of failed) {
          toast.error(`${result.hostname}: ${result.error ?? "failed"}`);
        }
      }
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

  const filtered = visible.length !== rows.length;

  return (
    <Section
      title="Environment variables"
      count={filtered ? `${visible.length}/${rows.length}` : rows.length}
      actions={
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDrafts([...rows, emptyDraft()])}
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
      <div className="flex flex-wrap gap-2 pb-3">
        <Input
          value={search}
          placeholder="Search keys"
          className="h-8 w-48 text-xs"
          onChange={(event) => setSearch(event.target.value)}
        />
        <OptionSelect<string>
          className="w-32"
          aria-label="Scope filter"
          value={scopeFilter === "" ? null : scopeFilter}
          onValueChange={(scope) => setScopeFilter(scope ?? "")}
          emptyLabel="every scope"
          options={scopeOptions}
        />
      </div>

      <div className="flex flex-col">
        <div className="hidden gap-3 border-b pb-2 text-xs text-muted-foreground md:grid md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.4fr)_7rem_2rem]">
          <span>Key</span>
          <span>Source</span>
          <span>Value</span>
          <span>Scope</span>
          <span />
        </div>
        {visible.map((draft) => (
          <div
            key={draft.id}
            className="grid grid-cols-1 gap-2 border-b py-2 md:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1.4fr)_7rem_2rem] md:gap-3"
          >
            <Input
              value={draft.key}
              placeholder="KEY"
              className="h-8 font-mono text-xs"
              onChange={(event) => patch(draft.id, { key: event.target.value })}
            />
            <OptionSelect<Draft["source"]>
              aria-label="Source"
              value={draft.source}
              onValueChange={(source) =>
                patch(draft.id, { source: source ?? "literal" })
              }
              options={ENV_SOURCES}
            />
            {draft.source === "binding" ? (
              <OptionSelect
                className="w-full"
                aria-label="Binding"
                value={draft.reference || null}
                onValueChange={(reference) =>
                  patch(draft.id, { reference: reference ?? "" })
                }
                emptyLabel="—"
                options={(bindings?.bindings ?? []).map((binding) => ({
                  value: binding.reference,
                  label: `${binding.reference}${binding.available ? "" : " (unavailable)"}`,
                  disabled: !binding.available,
                }))}
              />
            ) : draft.source === "template" ? (
              <TemplateInput
                value={draft.template}
                bindings={bindings?.bindings ?? []}
                onChange={(template) => patch(draft.id, { template })}
              />
            ) : (
              <Input
                value={draft.value}
                type="password"
                placeholder={draft.keepStored ? "stored" : ""}
                className="h-8 font-mono text-xs"
                onChange={(event) =>
                  patch(draft.id, { value: event.target.value })
                }
              />
            )}
            <OptionSelect<string>
              aria-label="Scope"
              value={envScopeValue(draft)}
              onValueChange={(value) =>
                patch(draft.id, parseEnvScopeValue(value ?? "all"))
              }
              options={scopeOptions}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setDrafts(rows.filter((row) => row.id !== draft.id))
              }
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}
        {visible.length === 0 && (
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
              {pending === "rebuild-production"
                ? "Redeploy required"
                : pending === "rebuild-preview"
                  ? "Next preview build required"
                  : "Restart required"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === "rebuild-production"
                ? "A NEXT_PUBLIC_ variable is compiled into the bundle, so this change needs a new build to take effect."
                : pending === "rebuild-preview"
                  ? "This NEXT_PUBLIC_ variable is scoped to preview and is compiled into the bundle, so it takes effect on the next preview build of its branch. There is nothing to redeploy from here."
                  : "Running containers keep the environment they were created with, so they need to be recreated to pick this up."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>
              {pending === "rebuild-preview" ? "Got it" : "Later"}
            </AlertDialogCancel>
            {/* No action for the preview case: the only honest one would be a
                production deployment, which is not what changed. */}
            {pending === "rebuild-preview" ? null : (
              <AlertDialogAction
                disabled={applying}
                onClick={(event) => {
                  // The action closes the dialog by default, and this work has to
                  // report back into it.
                  event.preventDefault();
                  void (pending === "rebuild-production"
                    ? rebuildNow()
                    : applyNow());
                }}
              >
                {applying
                  ? "Working…"
                  : pending === "rebuild-production"
                    ? "Redeploy"
                    : "Restart"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Section>
  );
}
