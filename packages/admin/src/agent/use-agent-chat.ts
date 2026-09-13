"use client";

import { Chat, useChat } from "@ai-sdk/react";
import {
  type AgentPageTool,
  type AgentUIMessage,
  isAgentPageTool,
} from "@repo/schemas";
import {
  type ChatTransport,
  DefaultChatTransport,
  type UIMessageChunk,
} from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { AdminApiError, type AdminClient } from "../client";
import { useAdmin } from "../provider";
import { captureAgentPageContext } from "./agent-page-context";
import { shouldContinueAgentTurn } from "./agent-parts";

export type AgentChatTrigger = "submit-message" | "regenerate-message";

export interface AgentRequestContext {
  trigger: AgentChatTrigger;
  messageId: string | undefined;
  messages: AgentUIMessage[];
}

export interface UseAgentChatOptions {
  /** Admin API path a turn posts to, relative to the admin base (`chat`). */
  endpoint: string;
  /** A new key starts a new chat: another conversation, another project. */
  chatKey: string;
  initialMessages?: AgentUIMessage[];
  /** The request body minus `trigger`, `messageId` and `message`; built when a request is made. */
  body: (context: AgentRequestContext) => object | Promise<object>;
  /** False while incognito: the page tools then refuse to read the page. */
  canReadPage?: () => boolean;
  onFinish?: (event: {
    message: AgentUIMessage;
    messages: AgentUIMessage[];
    isAbort: boolean;
    isError: boolean;
  }) => void;
}

type SendMessagesOptions = Parameters<
  ChatTransport<AgentUIMessage>["sendMessages"]
>[0];

/**
 * The default transport's stream parsing over `client.raw`, so the host's
 * fetch and auth (Tauri + bearer, or the session cookie) carry every turn.
 * `sendMessages` is overridden rather than handing in a `fetch`: the option is
 * typed as `typeof globalThis.fetch`, which an adapter cannot satisfy without
 * a cast once Bun's `fetch.preconnect` is in the type.
 */
class AdminChatTransport extends DefaultChatTransport<AgentUIMessage> {
  private readonly adminClient: AdminClient;
  private readonly resolveEndpoint: () => string;
  private readonly buildBody: (
    context: AgentRequestContext,
  ) => object | Promise<object>;

  constructor(
    adminClient: AdminClient,
    resolveEndpoint: () => string,
    buildBody: (context: AgentRequestContext) => object | Promise<object>,
  ) {
    super();
    this.adminClient = adminClient;
    this.resolveEndpoint = resolveEndpoint;
    this.buildBody = buildBody;
  }

  override async sendMessages({
    abortSignal,
    messages,
    trigger,
    messageId,
  }: SendMessagesOptions): Promise<ReadableStream<UIMessageChunk>> {
    const body = await this.buildBody({ trigger, messageId, messages });
    const response = await this.adminClient.raw(this.resolveEndpoint(), {
      method: "POST",
      body: {
        ...body,
        trigger,
        messageId,
        message: messages.at(-1),
      },
      signal: abortSignal,
    });
    if (!response.body) throw new Error("The response body is empty.");
    return this.processResponseStream(response.body);
  }

  override async reconnectToStream(): Promise<null> {
    return null;
  }
}

function pathInput(input: unknown): string {
  if (typeof input !== "object" || input === null || !("path" in input)) {
    return "";
  }
  return typeof input.path === "string" ? input.path : "";
}

export function describeAgentError(error: Error | undefined): string | null {
  if (!error) return null;
  if (error instanceof AdminApiError) {
    if (error.code === 429) return "Rate limited — try again shortly";
    return error.message;
  }
  return error.message || "The agent failed";
}

/**
 * `useChat` over the admin transport. The server owns the thread: a request
 * carries only the last message, and the page tools run here — their result
 * goes back through `addToolOutput`, and `sendAutomaticallyWhen` resumes the
 * stored turn once nothing is left waiting on the client.
 */
export function useAgentChat(options: UseAgentChatOptions) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const latest = useRef({ options, client, routes, router });
  latest.current = { options, client, routes, router };

  const chat = useMemo(() => {
    const runPageTool = async (tool: AgentPageTool, input: unknown) => {
      const { routes: currentRoutes, router: currentRouter } = latest.current;
      if (tool === "get_current_page_context") {
        if (latest.current.options.canReadPage?.() === false) {
          throw new Error("Page context is unavailable in Incognito mode");
        }
        return captureAgentPageContext({
          includeVisibleText: true,
          dashboardRoot: currentRoutes.dashboardRoot,
        });
      }
      if (tool === "navigate_desktop") {
        const path = pathInput(input);
        if (!path.startsWith(currentRoutes.dashboardRoot)) {
          throw new Error(
            `path must start with ${currentRoutes.dashboardRoot}`,
          );
        }
        currentRouter.push(path);
        return { ok: true, path };
      }
      currentRouter.refresh();
      return { ok: true, path: window.location.pathname };
    };

    const instance: Chat<AgentUIMessage> = new Chat<AgentUIMessage>({
      id: options.chatKey,
      messages: options.initialMessages,
      transport: new AdminChatTransport(
        latest.current.client,
        () => latest.current.options.endpoint,
        (context) => latest.current.options.body(context),
      ),
      sendAutomaticallyWhen: shouldContinueAgentTurn,
      onToolCall: ({ toolCall }) => {
        if (toolCall.dynamic || !isAgentPageTool(toolCall.toolName)) return;
        const tool = toolCall.toolName;
        runPageTool(tool, toolCall.input).then(
          (output) => {
            void instance.addToolOutput({
              tool,
              toolCallId: toolCall.toolCallId,
              output,
            });
          },
          (error: unknown) => {
            void instance.addToolOutput({
              tool,
              toolCallId: toolCall.toolCallId,
              state: "output-error",
              errorText:
                error instanceof Error ? error.message : "The page tool failed",
            });
          },
        );
      },
      onFinish: ({ message, messages, isAbort, isError }) => {
        latest.current.options.onFinish?.({
          message,
          messages,
          isAbort,
          isError,
        });
      },
    });
    return instance;
  }, [options.chatKey]);

  useEffect(
    () => () => {
      void chat.stop();
    },
    [chat],
  );

  const helpers = useChat<AgentUIMessage>({ chat });
  return { ...helpers, chat };
}

export type AgentChat = ReturnType<typeof useAgentChat>;
