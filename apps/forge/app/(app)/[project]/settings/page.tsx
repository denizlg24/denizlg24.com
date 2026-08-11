"use client";

import {
  type BuildConfigForm,
  BuildFields,
  buildConfigFromTarget,
  buildConfigPatch,
  RuntimeFields,
} from "@repo/cloud-ui/deploy/build-config-fields";
import { useResolvedBuildConfig } from "@repo/cloud-ui/deploy/repo-import";
import { formatRelative } from "@repo/cloud-ui/format";
import type { DeployTarget } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Section } from "@repo/ui/section";
import { Switch } from "@repo/ui/switch";
import { TypedConfirmDialog } from "@repo/ui/typed-confirm-dialog";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useTarget } from "@/components/target-context";
import { api, errorMessage } from "@/lib/api";

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

      <AvailabilitySection target={target} onChanged={() => void reload()} />

      <DangerSection target={target} />
    </div>
  );
}

/**
 * Pausing tears the production container down and stops the target counting
 * against the host's memory; nothing else about the project changes. Resuming
 * has to rebuild, because the teardown took the image with it — which is worth
 * saying on the button, since every other way back to a live site here is
 * instant.
 */
function AvailabilitySection({
  target,
  onChanged,
}: {
  target: DeployTarget;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const paused = target.pausedAt !== null;

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      toast.success(done);
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Availability"
      actions={
        paused ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const { deployment } = await api.deploy.resumeTarget(target.id);
                return deployment;
              }, "Resumed — rebuilding")
            }
          >
            Resume
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(() => api.deploy.pauseTarget(target.id), "Paused")
            }
          >
            Pause
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {paused ? (
          <>
            <span className="text-foreground">
              Paused {formatRelative(target.pausedAt)}
            </span>
            <span>Resuming rebuilds the last production commit.</span>
          </>
        ) : (
          <span>
            Stops the production container and releases its{" "}
            {target.memoryReservationMb} MB reservation. Builds are refused
            until it resumes.
          </span>
        )}
      </div>
    </Section>
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

/**
 * Cloud kept delete in the header beside `Visit`, one misclick from the link
 * the owner actually wanted. It sits at the bottom of the settings rail here,
 * behind the same typed confirmation.
 */
function DangerSection({ target }: { target: DeployTarget }) {
  const router = useRouter();

  return (
    <Section title="Danger">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Tears down every container, domain and record this project owns.
        </p>
        <TypedConfirmDialog
          title={`Delete ${target.name}`}
          keyword={target.name}
          actionLabel="Delete"
          onConfirm={async () => {
            try {
              await api.deploy.removeTarget(target.id);
              toast.success("Project deleted");
              router.push("/");
            } catch (error) {
              toast.error(errorMessage(error));
            }
          }}
          trigger={
            <Button variant="destructive" size="sm">
              Delete
            </Button>
          }
        />
      </div>
    </Section>
  );
}
