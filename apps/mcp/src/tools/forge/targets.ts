import type { McpServer } from "@modelcontextprotocol/server";
import {
  createDeployBranchRuleInputSchema,
  createDeployEnvironmentInputSchema,
  createDeployTargetRequestSchema,
  deployEnvVarInputSchema,
  linkEnvoyProjectInputSchema,
  updateDeployBranchRuleInputSchema,
  updateDeployEnvironmentInputSchema,
  updateDeployTargetInputSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import {
  type Api,
  defineTool,
  fail,
  ok,
  p,
  type ToolResult,
  uuid,
} from "../define";
import { withCommitSubjects } from "./commits";

const targetId = uuid.describe("Deploy target id");

export function registerForgeTargets(server: McpServer, api: Api) {
  defineTool(server, {
    name: "forge_targets_list",
    title: "Forge: targets",
    description:
      "Every deploy target with its latest and latest production deployment. Commit messages are subject lines.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: async () =>
      withCommitSubjects(await api.cloud.get("/api/deploy/targets")),
  });

  defineTool(server, {
    name: "forge_capacity_get",
    title: "Forge: capacity",
    description: "Host memory budget and what each stable slot is charged.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/deploy/capacity"),
  });

  defineTool(server, {
    name: "forge_projects_list",
    title: "Forge: connectable projects",
    description:
      "Every cloud project as the resource picker sees it: id, slug, name, whether anything deploys from it.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
    run: () => api.cloud.get("/api/deploy/projects"),
  });

  defineTool(server, {
    name: "forge_target_get",
    title: "Forge: target",
    description: "One deploy target with its resolved build configuration.",
    input: z.object({ targetId }),
    annotations: { readOnlyHint: true },
    run: ({ targetId }) => api.cloud.get(p`/api/deploy/targets/${targetId}`),
  });

  defineTool(server, {
    name: "forge_target_by_slug",
    title: "Forge: target by project slug",
    description: "Resolves the deploy target behind a project slug.",
    input: z.object({ slug: z.string().min(1) }),
    annotations: { readOnlyHint: true },
    run: ({ slug }) => api.cloud.get(p`/api/deploy/projects/${slug}/target`),
  });

  defineTool(server, {
    name: "forge_target_create",
    title: "Forge: create target",
    description:
      "Creates a deploy target from a GitHub repository. Use forge_github_repo_detect first for the build fields.",
    input: z.object(createDeployTargetRequestSchema.shape),
    run: (body) => api.cloud.post("/api/deploy/targets", body),
  });

  defineTool(server, {
    name: "forge_target_update",
    title: "Forge: update target",
    description:
      "Changes build/runtime settings, branch, memory or name of a target.",
    input: z.object({ targetId, ...updateDeployTargetInputSchema.shape }),
    annotations: { idempotentHint: true },
    run: ({ targetId, ...body }) =>
      api.cloud.patch(p`/api/deploy/targets/${targetId}`, body),
  });

  defineTool(server, {
    name: "forge_target_delete",
    title: "Forge: delete target",
    description:
      "Tears down every deployment the target holds, then removes it and its domains, env and rules.",
    input: z.object({ targetId }),
    annotations: { destructiveHint: true },
    run: ({ targetId }) => api.cloud.delete(p`/api/deploy/targets/${targetId}`),
  });

  defineTool(server, {
    name: "forge_target_pause",
    title: "Forge: pause target",
    description:
      "Removes every container and image of the target and stops charging it against the host. Rows stay.",
    input: z.object({ targetId }),
    annotations: { destructiveHint: true },
    run: ({ targetId }) =>
      api.cloud.post(p`/api/deploy/targets/${targetId}/pause`),
  });

  defineTool(server, {
    name: "forge_target_resume",
    title: "Forge: resume target",
    description:
      "Rebuilds production for a paused target — a fresh build, not a restart.",
    input: z.object({ targetId }),
    run: ({ targetId }) =>
      api.cloud.post(p`/api/deploy/targets/${targetId}/resume`),
  });

  defineTool(server, {
    name: "forge_target_envoy_link",
    title: "Forge: link Envoy project",
    description:
      "Stores the Envoy project and passphrase so builds pull env from Envoy.",
    input: z.object({ targetId, ...linkEnvoyProjectInputSchema.shape }),
    annotations: { idempotentHint: true },
    run: ({ targetId, ...body }) =>
      api.cloud.put(p`/api/deploy/targets/${targetId}/envoy`, body),
  });

  defineTool(server, {
    name: "forge_target_envoy_unlink",
    title: "Forge: unlink Envoy project",
    description: "Forgets the stored Envoy project and passphrase.",
    input: z.object({ targetId }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: ({ targetId }) =>
      api.cloud.delete(p`/api/deploy/targets/${targetId}/envoy`),
  });

  // Env vars ---------------------------------------------------------------

  defineTool(server, {
    name: "forge_env_list",
    title: "Forge: env vars",
    description:
      "Env vars of a target. Literal values are never returned — only hasValue. Includes bindings and templates.",
    input: z.object({ targetId }),
    annotations: { readOnlyHint: true },
    run: ({ targetId }) =>
      api.cloud.get(p`/api/deploy/targets/${targetId}/env`),
  });

  const envVars = z
    .array(deployEnvVarInputSchema)
    .max(500)
    .describe(
      "source literal (value; omit to keep stored), binding (reference), template (template). scope all|production|preview|environment(+environmentId).",
    );

  defineTool(server, {
    name: "forge_env_replace",
    title: "Forge: replace env vars",
    description:
      "Replaces the whole env set. A literal without value keeps what is stored; a key left out is deleted. Run forge_env_apply afterwards.",
    input: z.object({ targetId, vars: envVars }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: ({ targetId, vars }) =>
      api.cloud.put(p`/api/deploy/targets/${targetId}/env`, { vars }),
  });

  const storedEnvSchema = z.object({
    data: z.array(
      z.object({
        key: z.string(),
        source: z.enum(["literal", "binding", "template"]),
        reference: z.string().nullable(),
        template: z.string().nullable(),
        scope: z.string(),
        environmentId: z.string().nullable(),
      }),
    ),
  });

  type StoredVar = z.infer<typeof storedEnvSchema>["data"][number];
  type VarInput = z.infer<typeof deployEnvVarInputSchema>;

  function sameSlot(
    a: { key: string; scope: string; environmentId?: string | null },
    b: VarInput,
  ) {
    return (
      a.key === b.key &&
      a.scope === b.scope &&
      (a.environmentId ?? null) === (b.environmentId ?? null)
    );
  }

  function toInput(row: StoredVar): VarInput {
    const base = {
      key: row.key,
      scope: row.scope as VarInput["scope"],
      environmentId: row.environmentId,
    };
    if (row.source === "binding") {
      return { ...base, source: "binding", reference: row.reference ?? "" };
    }
    if (row.source === "template") {
      return { ...base, source: "template", template: row.template ?? "" };
    }
    return { ...base, source: "literal" };
  }

  async function loadEnv(
    targetId: string,
  ): Promise<{ error: ToolResult } | { rows: VarInput[] }> {
    const current = await api.cloud.get(p`/api/deploy/targets/${targetId}/env`);
    if (current.isError) return { error: current };
    const parsed = storedEnvSchema.safeParse(current.structuredContent);
    if (!parsed.success) {
      return {
        error: fail(502, "Unexpected env list shape from the cloud API"),
      };
    }
    return { rows: parsed.data.data.map(toInput) };
  }

  defineTool(server, {
    name: "forge_env_set",
    title: "Forge: set env vars",
    description:
      "Upserts the given vars (matched on key+scope+environment) and keeps every other one. Run forge_env_apply afterwards.",
    input: z.object({ targetId, vars: envVars.min(1) }),
    annotations: { idempotentHint: true },
    run: async ({ targetId, vars }) => {
      const loaded = await loadEnv(targetId);
      if ("error" in loaded) return loaded.error;
      const kept = loaded.rows.filter(
        (row) => !vars.some((incoming) => sameSlot(row, incoming)),
      );
      return api.cloud.put(p`/api/deploy/targets/${targetId}/env`, {
        vars: [...kept, ...vars],
      });
    },
  });

  defineTool(server, {
    name: "forge_env_unset",
    title: "Forge: unset env vars",
    description:
      "Removes the named keys (every scope unless scope/environmentId narrow it) and keeps the rest. Run forge_env_apply afterwards.",
    input: z.object({
      targetId,
      keys: z.array(z.string().min(1)).min(1),
      scope: z.string().optional(),
      environmentId: uuid.optional(),
    }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: async ({ targetId, keys, scope, environmentId }) => {
      const loaded = await loadEnv(targetId);
      if ("error" in loaded) return loaded.error;
      const remaining = loaded.rows.filter((row) => {
        if (!keys.includes(row.key)) return true;
        if (scope && row.scope !== scope) return true;
        if (environmentId && row.environmentId !== environmentId) return true;
        return false;
      });
      const removed = loaded.rows.length - remaining.length;
      if (removed === 0) return ok({ removed: 0, vars: loaded.rows.length });
      const result = await api.cloud.put(
        p`/api/deploy/targets/${targetId}/env`,
        {
          vars: remaining,
        },
      );
      return result.isError
        ? result
        : ok({ removed, ...result.structuredContent });
    },
  });

  defineTool(server, {
    name: "forge_env_apply",
    title: "Forge: apply env",
    description:
      "Recreates the live containers so an env change takes effect. docker restart cannot do this.",
    input: z.object({ targetId }),
    run: ({ targetId }) =>
      api.cloud.post(p`/api/deploy/targets/${targetId}/apply-env`),
  });

  defineTool(server, {
    name: "forge_bindings_list",
    title: "Forge: bindings",
    description:
      "Binding references a target's env can point at: connected resources and their exported values.",
    input: z.object({ targetId }),
    annotations: { readOnlyHint: true },
    run: ({ targetId }) => api.cloud.get(p`/api/deploy/bindings/${targetId}`),
  });

  // Environments -----------------------------------------------------------

  defineTool(server, {
    name: "forge_environments_list",
    title: "Forge: environments",
    description:
      "Custom environments (staging, qa…) of a target, or of a project when only projectId is given.",
    input: z.object({
      targetId: targetId.optional(),
      projectId: uuid
        .optional()
        .describe("Cloud project id, for resource scoping"),
    }),
    annotations: { readOnlyHint: true },
    run: ({ targetId, projectId }) => {
      if (targetId) {
        return api.cloud.get(p`/api/deploy/targets/${targetId}/environments`);
      }
      if (projectId) {
        return api.cloud.get(p`/api/deploy/projects/${projectId}/environments`);
      }
      return Promise.resolve(fail(400, "targetId or projectId is required"));
    },
  });

  defineTool(server, {
    name: "forge_environment_create",
    title: "Forge: create environment",
    description:
      "Adds a custom environment. It owns a generated hostname and is charged the host's memory continuously.",
    input: z.object({ targetId, ...createDeployEnvironmentInputSchema.shape }),
    run: ({ targetId, ...body }) =>
      api.cloud.post(p`/api/deploy/targets/${targetId}/environments`, body),
  });

  defineTool(server, {
    name: "forge_environment_update",
    title: "Forge: update environment",
    description: "Memory, auto-deploy or paused state of an environment.",
    input: z.object({
      environmentId: uuid,
      ...updateDeployEnvironmentInputSchema.shape,
    }),
    annotations: { idempotentHint: true },
    run: ({ environmentId, ...body }) =>
      api.cloud.patch(p`/api/deploy/environments/${environmentId}`, body),
  });

  defineTool(server, {
    name: "forge_environment_delete",
    title: "Forge: delete environment",
    description: "Tears the environment's deployment down and removes it.",
    input: z.object({ environmentId: uuid }),
    annotations: { destructiveHint: true },
    run: ({ environmentId }) =>
      api.cloud.delete(p`/api/deploy/environments/${environmentId}`),
  });

  // Branch rules -----------------------------------------------------------

  defineTool(server, {
    name: "forge_branch_rules_list",
    title: "Forge: branch rules",
    description:
      "Rules routing branches to environments, highest priority first.",
    input: z.object({ targetId }),
    annotations: { readOnlyHint: true },
    run: ({ targetId }) =>
      api.cloud.get(p`/api/deploy/targets/${targetId}/branch-rules`),
  });

  defineTool(server, {
    name: "forge_branch_rule_create",
    title: "Forge: create branch rule",
    description: "Routes branches matching a pattern to an environment.",
    input: z.object({ targetId, ...createDeployBranchRuleInputSchema.shape }),
    run: ({ targetId, ...body }) =>
      api.cloud.post(p`/api/deploy/targets/${targetId}/branch-rules`, body),
  });

  defineTool(server, {
    name: "forge_branch_rule_update",
    title: "Forge: update branch rule",
    description:
      "Pattern, match type, priority, environment or enabled flag of a rule.",
    input: z.object({
      ruleId: uuid,
      ...updateDeployBranchRuleInputSchema.shape,
    }),
    annotations: { idempotentHint: true },
    run: ({ ruleId, ...body }) =>
      api.cloud.patch(p`/api/deploy/branch-rules/${ruleId}`, body),
  });

  defineTool(server, {
    name: "forge_branch_rule_delete",
    title: "Forge: delete branch rule",
    description: "Removes a branch rule.",
    input: z.object({ ruleId: uuid }),
    annotations: { destructiveHint: true, idempotentHint: true },
    run: ({ ruleId }) =>
      api.cloud.delete(p`/api/deploy/branch-rules/${ruleId}`),
  });

  defineTool(server, {
    name: "forge_branch_routes_preview",
    title: "Forge: branch routes",
    description:
      "What each branch of the repository would do if pushed now: production, environment or preview.",
    input: z.object({ targetId }),
    annotations: { readOnlyHint: true },
    run: ({ targetId }) =>
      api.cloud.get(p`/api/deploy/targets/${targetId}/branch-routes`),
  });
}
