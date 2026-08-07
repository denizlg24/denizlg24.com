"use client";

import type { DeployBuilder, DeployTarget } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { NativeSelect } from "@repo/ui/native-select";
import { Switch } from "@repo/ui/switch";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

/** Blank clears the override; the API takes null for "unset". */
function optional(value: string): string | null {
  return value.trim().length === 0 ? null : value.trim();
}

export function SettingsPanel({
  target,
  onSaved,
}: {
  target: DeployTarget;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    productionBranch: target.productionBranch,
    rootDirectory: target.rootDirectory ?? "",
    builder: target.builder,
    dockerfilePath: target.dockerfilePath ?? "",
    installCommand: target.installCommand ?? "",
    buildCommand: target.buildCommand ?? "",
    startCommand: target.startCommand ?? "",
    healthPath: target.healthPath,
    memoryLimitMb: String(target.memoryLimitMb),
    cpuLimit: String(target.cpuLimit),
    autoDeploy: target.autoDeploy,
    previewDeploys: target.previewDeploys,
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await api.deploy.updateTarget(target.id, {
        productionBranch: form.productionBranch,
        rootDirectory: optional(form.rootDirectory),
        builder: form.builder,
        dockerfilePath: optional(form.dockerfilePath),
        installCommand: optional(form.installCommand),
        buildCommand: optional(form.buildCommand),
        startCommand: optional(form.startCommand),
        healthPath: form.healthPath,
        memoryLimitMb: Number(form.memoryLimitMb),
        cpuLimit: Number(form.cpuLimit),
        autoDeploy: form.autoDeploy,
        previewDeploys: form.previewDeploys,
      });
      toast.success("Saved");
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const fields: { id: keyof typeof form; label: string; mono?: boolean }[] = [
    { id: "productionBranch", label: "Production branch" },
    { id: "rootDirectory", label: "Root directory", mono: true },
    { id: "dockerfilePath", label: "Dockerfile path", mono: true },
    { id: "installCommand", label: "Install command", mono: true },
    { id: "buildCommand", label: "Build command", mono: true },
    { id: "startCommand", label: "Start command", mono: true },
    { id: "healthPath", label: "Health path", mono: true },
    { id: "memoryLimitMb", label: "Memory (MB)" },
    { id: "cpuLimit", label: "CPU limit" },
  ];

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="builder">Builder</Label>
          <NativeSelect
            id="builder"
            value={form.builder}
            className="w-full"
            onChange={(event) =>
              setForm({
                ...form,
                builder: event.target.value as DeployBuilder,
              })
            }
          >
            <option value="auto">auto</option>
            <option value="nixpacks">nixpacks</option>
            <option value="dockerfile">dockerfile</option>
          </NativeSelect>
        </div>
        {fields.map((field) => (
          <div key={field.id} className="flex flex-col gap-1.5">
            <Label htmlFor={field.id}>{field.label}</Label>
            <Input
              id={field.id}
              value={String(form[field.id])}
              className={field.mono ? "font-mono text-xs" : undefined}
              onChange={(event) =>
                setForm({ ...form, [field.id]: event.target.value })
              }
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id="auto-deploy"
            checked={form.autoDeploy}
            onCheckedChange={(checked) =>
              setForm({ ...form, autoDeploy: checked })
            }
          />
          <Label htmlFor="auto-deploy">Auto deploy</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="preview-deploys"
            checked={form.previewDeploys}
            onCheckedChange={(checked) =>
              setForm({ ...form, previewDeploys: checked })
            }
          />
          <Label htmlFor="preview-deploys">Preview deploys</Label>
        </div>
      </div>

      <div>
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          Save
        </Button>
      </div>

      <EnvoyLink target={target} onChanged={onSaved} />
    </div>
  );
}

/**
 * Off unless it is turned on here, per target. Envoy encrypts client-side, so
 * pulling env from it means this box holds the project passphrase — which is
 * why it is never inferred from a matching project.
 */
function EnvoyLink({
  target,
  onChanged,
}: {
  target: DeployTarget;
  onChanged: () => void;
}) {
  const [projectId, setProjectId] = useState(target.envoyProjectId ?? "");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      toast.success(label);
      setPassphrase("");
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Envoy</span>
        {target.envoyProjectId && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run("Unlinked", () => api.deploy.unlinkEnvoy(target.id))
            }
          >
            Unlink
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="envoy-project">Project</Label>
          <Input
            id="envoy-project"
            value={projectId}
            className="font-mono text-xs"
            onChange={(event) => setProjectId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="envoy-passphrase">Passphrase</Label>
          <Input
            id="envoy-passphrase"
            type="password"
            value={passphrase}
            placeholder={target.envoyProjectId ? "stored" : ""}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </div>
      </div>
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={
            busy || projectId.trim().length === 0 || passphrase.length === 0
          }
          onClick={() =>
            void run("Linked", () =>
              api.deploy.linkEnvoy(target.id, {
                envoyProjectId: projectId.trim(),
                passphrase,
              }),
            )
          }
        >
          Link
        </Button>
      </div>
    </div>
  );
}
