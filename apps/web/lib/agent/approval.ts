import type { AgentExecutionMode, AgentMemoryMode } from "@repo/schemas";
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

/** Whether this call only reads, judged per action when the tool has actions. */
export function isReadOnlyCall(
  binding: ConnectorToolBinding,
  input: unknown,
): boolean {
  const action = chosenAction(input);
  if (binding.actions && action) {
    return binding.actions[action]?.readOnly === true;
  }
  return binding.readOnly;
}

function isDestructiveCall(
  binding: ConnectorToolBinding,
  input: unknown,
): boolean {
  const action = chosenAction(input);
  if (binding.actions && action) {
    return binding.actions[action]?.destructive === true;
  }
  return binding.destructive;
}

/**
 * A connector call cannot see the turn's memory mode, so an incognito turn
 * refuses memory writes here instead — the same rule the built-in
 * `save_memory` enforces by being absent.
 */
function isMemoryWrite(binding: ConnectorToolBinding, input: unknown): boolean {
  return (
    binding.builtIn &&
    binding.toolName.startsWith(MEMORY_TOOL_PREFIX) &&
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
