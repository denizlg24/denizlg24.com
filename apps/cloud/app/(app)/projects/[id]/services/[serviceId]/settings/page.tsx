"use client";

import {
  type BuildConfigForm,
  BuildFields,
  buildConfigFromTarget,
  buildConfigPatch,
  RuntimeFields,
} from "@repo/cloud-ui/deploy/build-config-fields";
import { useResolvedBuildConfig } from "@repo/cloud-ui/deploy/repo-import";
import type { DeployTarget } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Section } from "@repo/ui/section";
import { Switch } from "@repo/ui/switch";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useTarget } from "../_components/target-context";

export default function SettingsPage() {
  const { target, reload } = useTarget();
  const [form, setForm] = useState<BuildConfigForm>(() =>
    buildConfigFromTarget(target),
  );
  const [name, setName] = useState(target.name);
  const [autoDeploy, setAutoDeploy] = useState(target.autoDeploy);
  const [previewDeploys, setPreviewDeploys] = useState(target.previewDeploys);
  const [busy, setBusy] = useState(false);
  const resolved = useResolvedBuildConfig(target);
  const normalizedName = name.trim();
  const nameValid =
    normalizedName.length <= 128 && /^[a-z0-9][a-z0-9-]*$/.test(normalizedName);

  function patch(changes: Partial<BuildConfigForm>) {
    setForm((current) => ({ ...current, ...changes }));
  }

  async function save() {
    setBusy(true);
    try {
      await api.deploy.updateTarget(target.id, {
        name: normalizedName,
        ...buildConfigPatch(form),
        autoDeploy,
        previewDeploys,
      });
      toast.success("Saved");
      await reload();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <Section
        title="General"
        actions={
          <Button
            size="sm"
            disabled={busy || !nameValid}
            onClick={() => void save()}
          >
            Save
          </Button>
        }
      >
        <div className="flex max-w-sm flex-col gap-1.5">
          <Label
            htmlFor="deployment-name"
            className="text-xs text-muted-foreground"
          >
            Deployment name
          </Label>
          <Input
            id="deployment-name"
            value={name}
            pattern="[a-z0-9][a-z0-9-]*"
            className="text-xs"
            onChange={(event) => setName(event.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            GitHub checks use forge / {normalizedName || "deployment"}.
          </p>
        </div>
      </Section>

      <Section title="Build">
        <BuildFields form={form} resolved={resolved} onChange={patch} />
      </Section>

      <Section title="Runtime">
        <RuntimeFields form={form} onChange={patch} />
      </Section>

      <Section title="Git">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="productionBranch"
                className="text-xs text-muted-foreground"
              >
                Production branch
              </Label>
              <Input
                id="productionBranch"
                value={form.productionBranch}
                className="text-xs"
                onChange={(event) =>
                  patch({ productionBranch: event.target.value })
                }
              />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Toggle
              id="auto-deploy"
              label="Auto deploy"
              checked={autoDeploy}
              onChange={setAutoDeploy}
            />
            <Toggle
              id="preview-deploys"
              label="Preview deploys"
              checked={previewDeploys}
              onChange={setPreviewDeploys}
            />
          </div>
        </div>
      </Section>

      <EnvoySection target={target} onChanged={() => void reload()} />
    </div>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
    </div>
  );
}

/**
 * Off unless it is turned on here, per target. Envoy encrypts client-side, so
 * pulling env from it means this box holds the project passphrase — which is
 * why it is never inferred from a matching project.
 */
function EnvoySection({
  target,
  onChanged,
}: {
  target: DeployTarget;
  onChanged: () => void;
}) {
  const [projectId, setProjectId] = useState(target.envoyProjectId ?? "");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const resolved = useResolvedBuildConfig(target);

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
    <Section
      title="Envoy"
      actions={
        <div className="flex gap-2">
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
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="envoy-project"
            className="text-xs text-muted-foreground"
          >
            Project
          </Label>
          <Input
            id="envoy-project"
            value={projectId}
            className="font-mono text-xs"
            onChange={(event) => setProjectId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="envoy-passphrase"
            className="text-xs text-muted-foreground"
          >
            Passphrase
          </Label>
          <Input
            id="envoy-passphrase"
            type="password"
            value={passphrase}
            placeholder={target.envoyProjectId ? "stored" : ""}
            className="text-xs"
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </div>
      </div>
    </Section>
  );
}
