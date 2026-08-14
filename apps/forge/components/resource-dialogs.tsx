"use client";

import { ResourceIcon } from "@repo/cloud-ui/tech-icon";
import { usePoll } from "@repo/cloud-ui/use-poll";
import {
  type ConnectableEnvironment,
  DATABASE_RESOURCE_KINDS,
  RESOURCE_KINDS,
  type Resource,
  type ResourceConnectionScope,
  type ResourceKind,
} from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { OptionSelect } from "@repo/ui/option-select";
import { type ReactNode, useCallback, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

const ENVIRONMENT_VALUE_PREFIX = "environment:";

interface Scope {
  scopes: ResourceConnectionScope;
  environmentId: string | null;
}

function scopeValue(scope: Scope): string {
  return scope.environmentId === null
    ? scope.scopes
    : `${ENVIRONMENT_VALUE_PREFIX}${scope.environmentId}`;
}

function parseScopeValue(value: string): Scope {
  if (value.startsWith(ENVIRONMENT_VALUE_PREFIX)) {
    return {
      scopes: "environment",
      environmentId: value.slice(ENVIRONMENT_VALUE_PREFIX.length),
    };
  }
  return {
    scopes: value === "production" || value === "preview" ? value : "both",
    environmentId: null,
  };
}

/**
 * The scope and the environment it may name are one control, because they are
 * one decision: `both`, one of the two unnamed sides, or a named environment.
 * Encoding the environment into the option value keeps them from ever
 * disagreeing — a separate environment picker could sit on `environment` with
 * nothing selected, which the API refuses.
 */
function ScopeField({
  value,
  environments,
  onChange,
}: {
  value: Scope;
  environments: readonly ConnectableEnvironment[];
  onChange: (scope: Scope) => void;
}) {
  // Two targets under one project may each hold a `staging`, and only then is
  // the target's name worth the width.
  const targets = new Set(environments.map((row) => row.targetId));
  const options = [
    { value: "both", label: "both" },
    { value: "production", label: "production" },
    { value: "preview", label: "preview" },
    ...environments.map((environment) => ({
      value: `${ENVIRONMENT_VALUE_PREFIX}${environment.id}`,
      label:
        targets.size > 1
          ? `${environment.targetName} · ${environment.name}`
          : environment.name,
    })),
  ];
  return (
    <Field label="Scope">
      <OptionSelect
        className="w-full min-w-0"
        contentClassName="max-w-[min(20rem,calc(100vw-2rem))]"
        aria-label="Scope"
        value={scopeValue(value)}
        onValueChange={(next) => {
          if (next) onChange(parseScopeValue(next));
        }}
        options={options}
      />
    </Field>
  );
}

/** The environments a connection to this project can be scoped to. */
function useConnectableEnvironments(
  projectId: string | undefined,
): ConnectableEnvironment[] {
  const fetchEnvironments = useCallback(
    () =>
      projectId
        ? api.deploy.connectableEnvironments(projectId)
        : Promise.resolve([]),
    [projectId],
  );
  const { data } = usePoll(fetchEnvironments, null);
  return data ?? [];
}

/**
 * An empty prefix is the default connection, which is what a bare
 * `database.postgres.*` binding resolves to. A second resource of the same kind
 * on one project needs a prefix or it collides with the first.
 */
function PrefixField({
  value,
  onChange,
}: {
  value: string;
  onChange: (prefix: string) => void;
}) {
  return (
    <Field label="Env prefix">
      <Input
        value={value}
        placeholder="STAGING"
        className="font-mono text-xs"
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
    </Field>
  );
}

export function CreateResourceDialog({
  /** Set on `/[project]/resources`, where the new resource connects on creation. */
  projectId,
  onCreated,
  trigger,
}: {
  projectId?: string;
  onCreated: () => Promise<unknown> | void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ResourceKind>("postgres");
  const [name, setName] = useState("");
  const [scope, setScope] = useState<Scope>({
    scopes: "both",
    environmentId: null,
  });
  const [envPrefix, setEnvPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  const environments = useConnectableEnvironments(projectId);

  // s3 and meilisearch are addressed by a project's slug — a bucket is a
  // directory named exactly that, and a search key is scoped to an index
  // prefix derived the same way. Standalone, only a database makes sense.
  const kinds = projectId ? RESOURCE_KINDS : DATABASE_RESOURCE_KINDS;
  // The name defaults to the project slug server-side, so it is optional here
  // and required only when there is no project to derive one from.
  const nameRequired = !projectId;

  async function create() {
    setBusy(true);
    try {
      const { password, resource } = await api.deploy.createResource({
        envPrefix,
        environmentId: scope.environmentId,
        kind,
        scopes: scope.scopes,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(projectId ? { projectId } : {}),
      });
      // The only moment the password exists outside the encrypted column. It
      // is still readable from the reveal, so this is a convenience rather
      // than the last chance — saying otherwise would be a lie.
      toast.success(
        password
          ? `Created ${resource.name} — password in the credentials reveal`
          : `Created ${resource.name}`,
      );
      setOpen(false);
      setName("");
      setEnvPrefix("");
      await onCreated();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create resource</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label="Kind">
            {/* Decorative and outside the trigger: it tracks the selection,
                and the option's own label names the kind. */}
            <div className="flex items-center gap-2">
              <ResourceIcon
                kind={kind}
                className="size-4 shrink-0 text-muted-foreground"
              />
              <OptionSelect<ResourceKind>
                className="w-full"
                aria-label="Kind"
                value={kind}
                onValueChange={(next) => {
                  if (next) setKind(next);
                }}
                options={kinds.map((option) => ({
                  value: option,
                  label: option,
                }))}
              />
            </div>
          </Field>
          <Field label={nameRequired ? "Name" : "Name (optional)"}>
            <Input
              value={name}
              placeholder={projectId ? "defaults to the project slug" : ""}
              className="font-mono text-xs"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          {projectId ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <ScopeField
                value={scope}
                environments={environments}
                onChange={setScope}
              />
              <PrefixField value={envPrefix} onChange={setEnvPrefix} />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            size="sm"
            disabled={busy || (nameRequired && name.trim().length === 0)}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Connects an existing resource to a project, from either side of the pair. */
export function ConnectResourceDialog({
  resourceId,
  projectId,
  onConnected,
  trigger,
}: {
  /** Fixed on `/resources/[id]`; the dialog then picks the project. */
  resourceId?: string;
  /** Fixed on `/[project]/resources`; the dialog then picks the resource. */
  projectId?: string;
  onConnected: () => Promise<unknown> | void;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [scope, setScope] = useState<Scope>({
    scopes: "both",
    environmentId: null,
  });
  const [envPrefix, setEnvPrefix] = useState("");
  const [busy, setBusy] = useState(false);
  // From this side the project is fixed; from the other it is whatever the
  // picker above is sitting on, so the environment list follows the selection.
  const environments = useConnectableEnvironments(projectId ?? selected);

  const fetchProjects = useCallback(
    () => (resourceId ? api.deploy.projects() : Promise.resolve([])),
    [resourceId],
  );
  const fetchResources = useCallback(
    () => (projectId ? api.deploy.resources() : Promise.resolve([])),
    [projectId],
  );
  const { data: projects } = usePoll(fetchProjects, null);
  const { data: resources } = usePoll(fetchResources, null);

  async function connect() {
    const targetResource = resourceId ?? selected;
    const targetProject = projectId ?? selected;
    if (!targetResource || !targetProject) return;
    setBusy(true);
    try {
      await api.deploy.connectResource(targetResource, {
        envPrefix,
        environmentId: scope.environmentId,
        projectId: targetProject,
        scopes: scope.scopes,
      });
      toast.success("Connected");
      setOpen(false);
      setSelected("");
      setEnvPrefix("");
      setScope({ scopes: "both", environmentId: null });
      await onConnected();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {resourceId ? "Connect to a project" : "Connect a resource"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={resourceId ? "Project" : "Resource"}>
            <OptionSelect
              className="w-full"
              aria-label={resourceId ? "Project" : "Resource"}
              value={selected || null}
              onValueChange={(next) => {
                setSelected(next ?? "");
                // The old project's environments are gone from the list, so a
                // scope naming one of them would post an id this project
                // cannot resolve.
                setScope({ scopes: "both", environmentId: null });
              }}
              emptyLabel="—"
              options={
                resourceId
                  ? (projects ?? []).map((project) => ({
                      value: project.id,
                      label: `${project.slug}${project.hasTarget ? "" : " (no deployable)"}`,
                    }))
                  : (resources ?? []).map((resource: Resource) => ({
                      value: resource.id,
                      label: `${resource.kind} · ${resource.name}`,
                    }))
              }
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <ScopeField
              value={scope}
              environments={environments}
              onChange={setScope}
            />
            <PrefixField value={envPrefix} onChange={setEnvPrefix} />
          </div>
        </div>
        <DialogFooter>
          <Button
            size="sm"
            disabled={busy || selected.length === 0}
            onClick={() => void connect()}
          >
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
