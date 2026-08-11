"use client";

import {
  DEPLOY_NODE_VERSIONS,
  type DeployBuilder,
  type DeployNodeVersion,
  type DeployTarget,
  deriveMemoryCeilingMb,
  MAX_MEMORY_MB,
  MIN_MEMORY_MB,
  type ResolvedBuildConfig,
  type UpdateDeployTargetInput,
} from "@repo/schemas/cloud";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { OverrideField, OverrideSelect } from "./override-field";

/**
 * The target's build configuration as overrides, where `null` means "whatever
 * the preset resolves". That is the same thing the columns mean, so the form
 * and the row hold the same values — a blank box is not an empty command, it is
 * the absence of an opinion, and the preset fills it at deploy time.
 *
 * Shared by Settings and the deploy page, because deploying with different
 * build settings *is* editing the target and both surfaces write these fields.
 */
export interface BuildConfigForm {
  productionBranch: string;
  rootDirectory: string;
  /** The preset id. Null until detection has run. */
  framework: string | null;
  builder: DeployBuilder | null;
  nodeVersion: DeployNodeVersion | null;
  dockerfilePath: string | null;
  installCommand: string | null;
  buildCommand: string | null;
  startCommand: string | null;
  healthPath: string;
  memoryReservationMb: string;
  cpuLimit: string;
}

/**
 * What a target is created with. Kept beside the form rather than at the call
 * site so "the defaults" is one thing — the API applies the same values when a
 * field is omitted, and two copies of them drift.
 */
export function defaultBuildConfig(): BuildConfigForm {
  return {
    productionBranch: "main",
    rootDirectory: "",
    framework: null,
    builder: null,
    nodeVersion: null,
    dockerfilePath: null,
    installCommand: null,
    buildCommand: null,
    startCommand: null,
    healthPath: "/",
    memoryReservationMb: "256",
    cpuLimit: "1",
  };
}

export function buildConfigFromTarget(target: DeployTarget): BuildConfigForm {
  return {
    productionBranch: target.productionBranch,
    rootDirectory: target.rootDirectory ?? "",
    framework: target.framework,
    // "auto" is the column default every target starts with, which is the
    // absence of a choice — the same thing the resolver reads it as.
    builder: target.builder === "auto" ? null : target.builder,
    nodeVersion: target.nodeVersion,
    dockerfilePath: target.dockerfilePath,
    installCommand: target.installCommand,
    buildCommand: target.buildCommand,
    startCommand: target.startCommand,
    healthPath: target.healthPath,
    memoryReservationMb: String(target.memoryReservationMb),
    cpuLimit: String(target.cpuLimit),
  };
}

/** An override the owner turned on and then emptied is not an override. */
function optional(value: string | null): string | null {
  if (value === null) return null;
  return value.trim().length === 0 ? null : value.trim();
}

export function buildConfigPatch(
  form: BuildConfigForm,
): Omit<UpdateDeployTargetInput, "autoDeploy" | "previewDeploys"> {
  return {
    productionBranch: form.productionBranch,
    rootDirectory: optional(form.rootDirectory),
    framework: form.framework,
    builder: form.builder ?? "auto",
    nodeVersion: form.nodeVersion,
    dockerfilePath: optional(form.dockerfilePath),
    installCommand: optional(form.installCommand),
    buildCommand: optional(form.buildCommand),
    startCommand: optional(form.startCommand),
    healthPath: form.healthPath,
    memoryReservationMb: Number(form.memoryReservationMb),
    cpuLimit: Number(form.cpuLimit),
  };
}

/** True once anything in the form differs from what the target already holds. */
export function buildConfigChanged(
  form: BuildConfigForm,
  target: DeployTarget,
): boolean {
  const original = buildConfigFromTarget(target);
  return (Object.keys(original) as (keyof BuildConfigForm)[]).some(
    (key) => original[key] !== form[key],
  );
}

type FieldChange = (changes: Partial<BuildConfigForm>) => void;

const BUILDER_OPTIONS: readonly { value: DeployBuilder; label: string }[] = [
  { value: "nixpacks", label: "nixpacks" },
  { value: "dockerfile", label: "dockerfile" },
];

const NODE_OPTIONS = DEPLOY_NODE_VERSIONS.map((version) => ({
  value: version,
  label: version,
}));

/**
 * What decides how the image is produced.
 *
 * `resolved` is what detection made of the repository at the currently selected
 * directory. Without it every field would show a blank box and the owner would
 * have to deploy to find out what runs.
 */
export function BuildFields({
  form,
  resolved,
  onChange,
}: {
  form: BuildConfigForm;
  resolved: ResolvedBuildConfig | null;
  onChange: FieldChange;
}) {
  // The resolved builder, not the override, decides which fields are relevant:
  // with the override off, what runs is whatever the preset picked.
  const builder = form.builder ?? resolved?.builder.value ?? "auto";
  const dockerfile = builder === "dockerfile";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <OverrideSelect
        label="Builder"
        preset={resolved?.builder.value ?? null}
        value={form.builder}
        options={BUILDER_OPTIONS}
        onChange={(value) => onChange({ builder: value })}
      />
      {dockerfile ? (
        <OverrideField
          label="Dockerfile path"
          preset={resolved?.dockerfilePath.value ?? null}
          value={form.dockerfilePath}
          onChange={(value) => onChange({ dockerfilePath: value })}
        />
      ) : (
        <OverrideSelect
          label="Node version"
          preset={resolved?.nodeVersion.value ?? null}
          value={form.nodeVersion}
          options={NODE_OPTIONS}
          onChange={(value) => onChange({ nodeVersion: value })}
        />
      )}
      {/* A Dockerfile states its own install and build steps — and its own base
          image — so the agent refuses all of these rather than accepting and
          ignoring them. */}
      {!dockerfile && (
        <>
          <OverrideField
            label="Install command"
            preset={resolved?.installCommand.value ?? null}
            value={form.installCommand}
            onChange={(value) => onChange({ installCommand: value })}
          />
          <OverrideField
            label="Build command"
            preset={resolved?.buildCommand.value ?? null}
            value={form.buildCommand}
            onChange={(value) => onChange({ buildCommand: value })}
          />
          <OverrideField
            label="Start command"
            preset={resolved?.startCommand.value ?? null}
            value={form.startCommand}
            onChange={(value) => onChange({ startCommand: value })}
          />
        </>
      )}
      {dockerfile && (
        <OverrideField
          label="Start command"
          preset={resolved?.startCommand.value ?? null}
          value={form.startCommand}
          onChange={(value) => onChange({ startCommand: value })}
        />
      )}
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
}: {
  id: keyof BuildConfigForm;
  label: string;
  value: string;
  onChange: FieldChange;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        className="font-mono text-xs"
        onChange={(event) => onChange({ [id]: event.target.value })}
      />
    </div>
  );
}

/** What the container gets once the image exists. */
export function RuntimeFields({
  form,
  onChange,
}: {
  form: BuildConfigForm;
  onChange: FieldChange;
}) {
  const reservationMb = Number(form.memoryReservationMb);
  const ceilingMb =
    Number.isInteger(reservationMb) &&
    reservationMb >= MIN_MEMORY_MB &&
    reservationMb <= MAX_MEMORY_MB
      ? deriveMemoryCeilingMb(reservationMb)
      : null;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <TextField
        id="healthPath"
        label="Health path"
        value={form.healthPath}
        onChange={onChange}
      />
      <TextField
        id="memoryReservationMb"
        label="Reserved memory (MB)"
        value={form.memoryReservationMb}
        onChange={onChange}
      />
      <TextField
        id="cpuLimit"
        label="CPU limit"
        value={form.cpuLimit}
        onChange={onChange}
      />
      {ceilingMb !== null && (
        <p className="text-xs text-muted-foreground sm:col-span-3">
          May burst to {ceilingMb.toLocaleString()} MB before it is stopped.
          Admission control counts only the reservation.
        </p>
      )}
    </div>
  );
}
