import {
  type AgentExecutionMode,
  type AgentMemoryMode,
  mcpCatalogCallSchema,
} from "@repo/schemas";
import type { ConnectorToolBinding } from "@/lib/connectors/toolset";
import type { AgentToolApprovalPolicy } from "@/lib/llm-service";

const MEMORY_TOOL_PREFIX = "web_agent_memory";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chosenAction(input: unknown): string | null {
  return isRecord(input) && typeof input.action === "string"
    ? input.action
    : null;
}

/**
 * The tool and arguments a call actually reaches. A catalog call reaches its
 * `resource` with `operation` as the action, and is judged by that
 * resource's own flags; null when the resource is not one it may reach.
 */
function resolveCall(
  binding: ConnectorToolBinding,
  input: unknown,
): { binding: ConnectorToolBinding; input: unknown } | null {
  if (!binding.catalogTargets) return { binding, input };
  const call = mcpCatalogCallSchema.safeParse(input);
  if (!call.success) return null;
  const target = binding.catalogTargets.get(call.data.resource);
  if (!target) return null;
  return {
    binding: target,
    input: call.data.operation ? { action: call.data.operation } : {},
  };
}

function flagsOf(binding: ConnectorToolBinding, input: unknown) {
  const action = chosenAction(input);
  if (binding.actions && action) {
    const flags = binding.actions[action];
    return {
      readOnly: flags?.readOnly === true,
      destructive: flags?.destructive === true,
    };
  }
  return { readOnly: binding.readOnly, destructive: binding.destructive };
}

/**
 * Whether this call only reads, judged per action when the tool has actions.
 * A catalog call reads only when both the call tool and the operation it
 * names say so; the server refuses the mismatch anyway, but approval never
 * relies on that.
 */
export function isReadOnlyCall(
  binding: ConnectorToolBinding,
  input: unknown,
): boolean {
  const resolved = resolveCall(binding, input);
  if (!resolved) return false;
  const target = flagsOf(resolved.binding, resolved.input).readOnly;
  return resolved.binding === binding ? target : target && binding.readOnly;
}

function isDestructiveCall(
  binding: ConnectorToolBinding,
  input: unknown,
): boolean {
  const resolved = resolveCall(binding, input);
  if (!resolved) return binding.destructive;
  return (
    flagsOf(resolved.binding, resolved.input).destructive ||
    (resolved.binding !== binding && binding.destructive)
  );
}

/**
 * A connector call cannot see the turn's memory mode, so an incognito turn
 * refuses memory writes here instead — the same rule the built-in
 * `save_memory` enforces by being absent. Judged on the tool a catalog call
 * reaches, not on the catalog tool's own name.
 */
function isMemoryWrite(binding: ConnectorToolBinding, input: unknown): boolean {
  const target = resolveCall(binding, input)?.binding;
  return (
    binding.builtIn &&
    target?.toolName.startsWith(MEMORY_TOOL_PREFIX) === true &&
    !isReadOnlyCall(binding, input)
  );
}

export function createApprovalPolicy(options: {
  executionMode: AgentExecutionMode;
  memoryMode: AgentMemoryMode;
  connectorBindings: ReadonlyMap<string, ConnectorToolBinding>;
  builtinWrites: ReadonlySet<string>;
}): AgentToolApprovalPolicy {
  return ({ toolName, input }) => {
    const binding = options.connectorBindings.get(toolName);
    if (binding) {
      if (!resolveCall(binding, input)) {
        return {
          type: "denied",
          reason:
            "That resource is disabled or unknown; find one with catalog_search",
        };
      }
      if (options.memoryMode === "incognito" && isMemoryWrite(binding, input)) {
        return {
          type: "denied",
          reason: "Incognito conversation: memory is not written",
        };
      }
      if (
        options.executionMode === "yolo" ||
        binding.approval === "never-ask"
      ) {
        return undefined;
      }
      const destructive = isDestructiveCall(binding, input);
      if (binding.approval === "always-ask") {
        return {
          type: "user-approval",
          ...(destructive ? { reason: "Destructive" } : {}),
        };
      }
      return isReadOnlyCall(binding, input)
        ? undefined
        : {
            type: "user-approval",
            ...(destructive ? { reason: "Destructive" } : {}),
          };
    }
    if (
      options.executionMode === "interactive" &&
      options.builtinWrites.has(toolName)
    ) {
      return "user-approval";
    }
    return undefined;
  };
}
