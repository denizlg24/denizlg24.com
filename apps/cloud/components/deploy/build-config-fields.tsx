"use client";

import {
  DEPLOY_NODE_VERSIONS,
  type DeployBuilder,
  type DeployNodeVersion,
  type DeployTarget,
  type UpdateDeployTargetInput,
} from "@repo/schemas/cloud";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { NativeSelect } from "@repo/ui/native-select";

/**
 * The target's build configuration as strings, because every one of these is a
 * text box and an empty box has to mean "unset" rather than "zero". Shared by
 * Settings and the deploy page — deploying with different build settings is
 * editing the target, so both surfaces write the same fields.
 */
export interface BuildConfigForm {
  productionBranch: string;
  rootDirectory: string;
  builder: DeployBuilder;
  /** Empty means "whatever the repository says". See DEPLOY_NODE_VERSIONS. */
  nodeVersion: DeployNodeVersion | "";
  dockerfilePath: string;
  installCommand: string;
  buildCommand: string;
  startCommand: string;
  healthPath: string;
  memoryLimitMb: string;
  cpuLimit: string;
}

/**
 * What a target is created with. Kept here beside the form rather than at the
 * call site so "the defaults" is one thing — the API applies the same values
 * when a field is omitted, and two copies of them drift.
 */
export function defaultBuildConfig(): BuildConfigForm {
  return {
    productionBranch: "main",
    rootDirectory: "",
    builder: "auto",
    nodeVersion: "",
    dockerfilePath: "",
    installCommand: "",
    buildCommand: "",
    startCommand: "",
    healthPath: "/",
    memoryLimitMb: "512",
    cpuLimit: "1",
  };
}

export function buildConfigFromTarget(target: DeployTarget): BuildConfigForm {
  return {
    productionBranch: target.productionBranch,
    rootDirectory: target.rootDirectory ?? "",
    builder: target.builder,
    nodeVersion: target.nodeVersion ?? "",
    dockerfilePath: target.dockerfilePath ?? "",
    installCommand: target.installCommand ?? "",
    buildCommand: target.buildCommand ?? "",
    startCommand: target.startCommand ?? "",
    healthPath: target.healthPath,
    memoryLimitMb: String(target.memoryLimitMb),
    cpuLimit: String(target.cpuLimit),
  };
}

/** Blank clears the override; the API takes null for "unset". */
function optional(value: string): string | null {
  return value.trim().length === 0 ? null : value.trim();
}

export function buildConfigPatch(
  form: BuildConfigForm,
): Omit<UpdateDeployTargetInput, "autoDeploy" | "previewDeploys"> {
  return {
    productionBranch: form.productionBranch,
    rootDirectory: optional(form.rootDirectory),
    builder: form.builder,
    nodeVersion: form.nodeVersion === "" ? null : form.nodeVersion,
    dockerfilePath: optional(form.dockerfilePath),
    installCommand: optional(form.installCommand),
    buildCommand: optional(form.buildCommand),
    startCommand: optional(form.startCommand),
    healthPath: form.healthPath,
    memoryLimitMb: Number(form.memoryLimitMb),
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

function TextField({
  id,
  label,
  value,
  placeholder,
  mono,
  onChange,
}: {
  id: keyof BuildConfigForm;
  label: string;
  value: string;
  placeholder?: string;
  mono?: boolean;
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
        placeholder={placeholder}
        className={mono ? "font-mono text-xs" : "text-xs"}
        onChange={(event) => onChange({ [id]: event.target.value })}
      />
    </div>
  );
}

/** What decides how the image is produced. */
export function BuildFields({
  form,
  onChange,
  /**
   * The new-target flow owns the root directory in its own section, because
   * changing it there re-runs detection. Two boxes for one value would let the
   * second one move it without anything re-detecting.
   */
  hideRootDirectory,
}: {
  form: BuildConfigForm;
  onChange: FieldChange;
  hideRootDirectory?: boolean;
}) {
  const dockerfile = form.builder !== "nixpacks";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="builder" className="text-xs text-muted-foreground">
          Builder
        </Label>
        <NativeSelect
          id="builder"
          value={form.builder}
          className="w-full text-xs"
          onChange={(event) =>
            onChange({ builder: event.target.value as DeployBuilder })
          }
        >
          <option value="auto">auto</option>
          <option value="nixpacks">nixpacks</option>
          <option value="dockerfile">dockerfile</option>
        </NativeSelect>
      </div>
      {!hideRootDirectory && (
        <TextField
          id="rootDirectory"
          label="Root directory"
          value={form.rootDirectory}
          placeholder="./"
          mono
          onChange={onChange}
        />
      )}
      {dockerfile && (
        <TextField
          id="dockerfilePath"
          label="Dockerfile path"
          value={form.dockerfilePath}
          placeholder="Dockerfile"
          mono
          onChange={onChange}
        />
      )}
      {/* A Dockerfile states its own install and build steps — and its own
          base image — so the agent refuses all of these rather than accepting
          and ignoring them. */}
      {form.builder === "nixpacks" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label
              htmlFor="nodeVersion"
              className="text-xs text-muted-foreground"
            >
              Node version
            </Label>
            <NativeSelect
              id="nodeVersion"
              value={form.nodeVersion}
              className="w-full text-xs"
              onChange={(event) =>
                onChange({
                  nodeVersion: event.target.value as DeployNodeVersion | "",
                })
              }
            >
              {/* Not the safe-looking default it appears to be: nixpacks
                  resolves engines.node to the range floor, so ">=18" asks for
                  a Node nixpkgs has removed. */}
              <option value="">from the repo</option>
              {DEPLOY_NODE_VERSIONS.map((version) => (
                <option key={version} value={version}>
                  {version}
                </option>
              ))}
            </NativeSelect>
          </div>
          <TextField
            id="installCommand"
            label="Install command"
            value={form.installCommand}
            mono
            onChange={onChange}
          />
          <TextField
            id="buildCommand"
            label="Build command"
            value={form.buildCommand}
            mono
            onChange={onChange}
          />
        </>
      )}
      <TextField
        id="startCommand"
        label="Start command"
        value={form.startCommand}
        mono
        onChange={onChange}
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
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <TextField
        id="healthPath"
        label="Health path"
        value={form.healthPath}
        mono
        onChange={onChange}
      />
      <TextField
        id="memoryLimitMb"
        label="Memory (MB)"
        value={form.memoryLimitMb}
        onChange={onChange}
      />
      <TextField
        id="cpuLimit"
        label="CPU limit"
        value={form.cpuLimit}
        onChange={onChange}
      />
    </div>
  );
}
