"use client";

import type { DeploymentKind } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { NativeSelect } from "@repo/ui/native-select";
import { Section } from "@repo/ui/section";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  type BuildConfigForm,
  BuildFields,
  buildConfigChanged,
  buildConfigFromTarget,
  buildConfigPatch,
} from "@/components/deploy/build-config-fields";
import { useResolvedBuildConfig } from "@/components/deploy/repo-import";
import { api, errorMessage } from "@/lib/api";
import { useTarget } from "../_components/target-context";

export default function CreateDeploymentPage() {
  const { target, reload } = useTarget();
  const resolved = useResolvedBuildConfig(target);
  const router = useRouter();

  const [ref, setRef] = useState(target.productionBranch);
  const [sha, setSha] = useState("");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<DeploymentKind>("production");
  const [form, setForm] = useState<BuildConfigForm>(() =>
    buildConfigFromTarget(target),
  );
  const [busy, setBusy] = useState(false);

  const configChanged = buildConfigChanged(form, target);

  async function deploy() {
    setBusy(true);
    try {
      // Saved before the deployment is queued, so the build that starts is the
      // one these settings describe rather than the previous configuration.
      if (configChanged) {
        await api.deploy.updateTarget(target.id, buildConfigPatch(form));
        await reload();
      }
      const created = await api.deploy.create(target.id, {
        ref,
        kind,
        ...(sha.trim() ? { sha: sha.trim() } : {}),
        ...(message.trim() ? { message: message.trim() } : {}),
      });
      toast.success(`Queued ${ref}`);
      router.push(`/deployments/${target.id}/deployments/${created.id}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link
          href={`/deployments/${target.id}`}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          ← {target.name}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Create deployment</h2>
          <Button size="sm" disabled={busy} onClick={() => void deploy()}>
            Deploy
          </Button>
        </div>
      </div>

      <Section title="Source">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ref" className="text-xs text-muted-foreground">
              Branch
            </Label>
            <Input
              id="ref"
              value={ref}
              className="text-xs"
              onChange={(event) => setRef(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kind" className="text-xs text-muted-foreground">
              Kind
            </Label>
            <NativeSelect
              id="kind"
              value={kind}
              className="w-full text-xs"
              onChange={(event) =>
                setKind(event.target.value as DeploymentKind)
              }
            >
              <option value="production">production</option>
              <option value="preview">preview</option>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="sha" className="text-xs text-muted-foreground">
              Commit
            </Label>
            <Input
              id="sha"
              value={sha}
              placeholder={
                target.githubInstallationId === null
                  ? "required until the GitHub App is installed"
                  : "defaults to the branch head"
              }
              className="font-mono text-xs"
              onChange={(event) => setSha(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="message" className="text-xs text-muted-foreground">
              Message
            </Label>
            <Input
              id="message"
              value={message}
              className="text-xs"
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>
        </div>
      </Section>

      <Section
        title="Build configuration"
        actions={
          configChanged && (
            <span className="text-xs text-muted-foreground">
              saved to the target on deploy
            </span>
          )
        }
      >
        <BuildFields
          form={form}
          resolved={resolved}
          onChange={(changes) =>
            setForm((current) => ({ ...current, ...changes }))
          }
        />
      </Section>
    </div>
  );
}
