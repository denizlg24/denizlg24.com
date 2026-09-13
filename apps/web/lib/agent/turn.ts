import type {
  AgentExecutionMode,
  AgentMemoryMode,
  AgentMessageMetadata,
  AgentToolToggles,
  AgentUIMessage,
  BackgroundAgentPageContext,
} from "@repo/schemas";
import {
  convertToModelMessages,
  createIdGenerator,
  type ToolSet,
  toUIMessageStream,
  type UIMessageChunk,
} from "ai";
import {
  type ConnectorToolset,
  openConnectorToolset,
} from "@/lib/connectors/toolset";
import {
  type AgentTurnEnd,
  type LlmPurpose,
  streamAgentTurn,
} from "@/lib/llm-service";
import { sandboxEnabled } from "@/lib/sandbox-config";
import { getAppTimeZone } from "@/lib/timezone";
import type { AgentRunSurface, AgentRunTaskContext } from "@/lib/tools/types";
import { createApprovalPolicy, isReadOnlyCall } from "./approval";
import { buildBuiltinTools } from "./builtin-tools";
import { buildAgentInstructions } from "./instructions";
import type { TurnMemory } from "./memory";
import { messageText, normalizeAgentMessage } from "./messages";
import {
  withContextBlocks,
  withMemoryImages,
  withPageContext,
} from "./model-messages";

const generateMessageId = createIdGenerator({ prefix: "msg", size: 20 });
const TURN_END_GRACE_MS = 2_000;

export interface AgentTurnFinish {
  messages: AgentUIMessage[];
  responseMessage: AgentUIMessage;
  isAborted: boolean;
  /** Whether a call the turn made would have needed approval in interactive mode. */
  isWriteCall: (toolName: string, input: unknown) => boolean;
}

export interface AgentTurnInput {
  purpose: LlmPurpose;
  source: string;
  model: string;
  surface: AgentRunSurface;
  unattended: boolean;
  executionMode: AgentExecutionMode;
  memoryMode: AgentMemoryMode;
  conversationId?: string;
  /** Full history, ending with the new user message or the resumed assistant message. */
  messages: AgentUIMessage[];
  toolToggles: AgentToolToggles;
  connectors?: readonly string[];
  pageContext?: BackgroundAgentPageContext;
  responseStyle?: "voice";
  /** A client is attached and can run the desktop page tools. */
  pageTools: boolean;
  task?: AgentRunTaskContext;
  memory: TurnMemory;
  /** Surface-specific tools, e.g. the LaTeX project's. */
  extraTools?: ToolSet;
  extraInstructions?: string;
  /** Model-only text appended to the request, e.g. the editor's cursor window. */
  extraContext?: readonly string[];
  abortSignal?: AbortSignal;
  onFinish: (finish: AgentTurnFinish) => Promise<void>;
}

function lastUserText(messages: readonly AgentUIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return messageText(message);
  }
  return "";
}

function withFinishReason(
  message: AgentUIMessage,
  end: AgentTurnEnd | null,
): AgentUIMessage {
  if (!end) return message;
  return {
    ...message,
    metadata: { ...message.metadata, finishReason: end.finishReason },
  };
}

/**
 * One agent turn as a UI message stream. The caller owns what happens to the
 * finished messages; connector clients are closed here whatever the outcome.
 */
export async function startAgentTurn(
  input: AgentTurnInput,
): Promise<ReadableStream<UIMessageChunk>> {
  const messages = input.messages.map(normalizeAgentMessage);
  const builtins = await buildBuiltinTools({
    pageTools: input.pageTools,
    context: {
      conversationId: input.conversationId,
      memoryMode: input.memoryMode,
      run: {
        surface: input.surface,
        unattended: input.unattended,
        executionMode: input.executionMode,
        clientToolsAvailable: input.pageTools,
        ...(input.task ? { task: input.task } : {}),
      },
    },
  });

  let connectors: ConnectorToolset | null = null;
  try {
    connectors = await openConnectorToolset({
      only: input.connectors,
      model: input.model,
    });
    const tools: ToolSet = {
      ...connectors.tools,
      ...builtins.tools,
      ...input.extraTools,
    };

    const timeZone = await getAppTimeZone();
    const instructionOptions = {
      timeZone,
      executionMode: input.executionMode,
      responseStyle: input.responseStyle,
      pageTools: input.pageTools,
      sandbox: sandboxEnabled(),
      connectors: {
        names: [
          ...new Set(
            [...connectors.bindings.values()].map(
              (binding) => binding.connectorName,
            ),
          ),
        ],
        guidance: connectors.instructions,
        unavailable: connectors.unavailable,
      },
      extra: input.extraInstructions,
    };
    const instructions = buildAgentInstructions({
      ...instructionOptions,
      memoryContext: input.memory.context,
    });
    const logInstructions = buildAgentInstructions({
      ...instructionOptions,
      memoryContext: null,
    });

    const converted = await convertToModelMessages(messages, {
      tools,
      ignoreIncompleteToolCalls: true,
    });
    const modelMessages = withMemoryImages(
      withContextBlocks(
        withPageContext(converted, input.pageContext),
        input.extraContext ?? [],
      ),
      input.memory.images,
    );

    const approval = createApprovalPolicy({
      executionMode: input.executionMode,
      memoryMode: input.memoryMode,
      connectorBindings: connectors.bindings,
      builtinWrites: builtins.writes,
    });

    let resolveEnd: (end: AgentTurnEnd) => void = () => {};
    const turnEnd = new Promise<AgentTurnEnd>((resolve) => {
      resolveEnd = resolve;
    });

    const turn = await streamAgentTurn({
      purpose: input.purpose,
      source: input.source,
      conversationId: input.conversationId,
      model: input.model,
      instructions,
      logInstructions,
      logPrompt: lastUserText(messages),
      messages: modelMessages,
      tools,
      toolApproval: approval,
      webSearch: input.toolToggles.webSearch,
      webFetch: input.toolToggles.webFetch,
      thinkLonger: input.toolToggles.thinkLonger,
      abortSignal: input.abortSignal,
      onTurnEnd: resolveEnd,
    });

    const opened = connectors;
    const startMetadata: AgentMessageMetadata = {
      createdAt: new Date().toISOString(),
      model: turn.modelId,
      ...(input.memory.traceId
        ? {
            retrievalTraceId: input.memory.traceId,
            memoryInjected: input.memory.injected,
          }
        : {}),
      tools: {
        webSearch: input.toolToggles.webSearch,
        webFetch: input.toolToggles.webFetch,
        thinkLonger: input.toolToggles.thinkLonger,
      },
    };

    return toUIMessageStream<ToolSet, AgentUIMessage>({
      stream: turn.result.stream,
      tools,
      originalMessages: messages,
      generateMessageId,
      sendSources: true,
      messageMetadata: ({ part }) => {
        if (part.type === "start") return startMetadata;
        if (part.type === "finish") {
          return {
            usage: turn.describeUsage(part.totalUsage),
            finishReason: part.finishReason,
          };
        }
        return undefined;
      },
      onError: (error) => {
        console.error("Agent turn stream error:", error);
        return error instanceof Error ? error.message : "The agent failed";
      },
      onEnd: async ({ messages, responseMessage, isAborted }) => {
        try {
          const end = await Promise.race([
            turnEnd,
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), TURN_END_GRACE_MS),
            ),
          ]);
          const response = withFinishReason(responseMessage, end);
          await input.onFinish({
            messages: messages.map((message) =>
              message.id === response.id ? response : message,
            ),
            responseMessage: response,
            isAborted,
            isWriteCall: (toolName, callInput) => {
              const binding = opened.bindings.get(toolName);
              if (binding) return !isReadOnlyCall(binding, callInput);
              return builtins.writes.has(toolName);
            },
          });
        } finally {
          await opened.close();
        }
      },
    });
  } catch (error) {
    await connectors?.close();
    throw error;
  }
}
