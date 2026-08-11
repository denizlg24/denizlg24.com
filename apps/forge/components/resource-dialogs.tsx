"use client";

import { ResourceIcon } from "@repo/cloud-ui/tech-icon";
import { usePoll } from "@repo/cloud-ui/use-poll";
import {
  DATABASE_RESOURCE_KINDS,
  RESOURCE_CONNECTION_SCOPES,
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

function ScopeField({
  value,
  onChange,
}: {
  value: ResourceConnectionScope;
  onChange: (scope: ResourceConnectionScope) => void;
}) {
  return (
    <Field label="Scope">
      <OptionSelect<ResourceConnectionScope>
        className="w-full"
        aria-label="Scope"
        value={value}
        onValueChange={(scope) => {
          if (scope) onChange(scope);
        }}
        options={RESOURCE_CONNECTION_SCOPES.map((scope) => ({
          value: scope,
          label: scope,
        }))}
      />
    </Field>
  );
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
  const [scopes, setScopes] = useState<ResourceConnectionScope>("both");
  const [envPrefix, setEnvPrefix] = useState("");
  const [busy, setBusy] = useState(false);

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
        kind,
        scopes,
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
              <ScopeField value={scopes} onChange={setScopes} />
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
  const [scopes, setScopes] = useState<ResourceConnectionScope>("both");
  const [envPrefix, setEnvPrefix] = useState("");
  const [busy, setBusy] = useState(false);

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
        projectId: targetProject,
        scopes,
      });
      toast.success("Connected");
      setOpen(false);
      setSelected("");
      setEnvPrefix("");
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
              onValueChange={(next) => setSelected(next ?? "")}
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
            <ScopeField value={scopes} onChange={setScopes} />
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
