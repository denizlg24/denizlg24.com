import { useCallback, useRef, useState } from "react";
import type { denizApi } from "@/lib/api-wrapper";
import type {
  IChatClientToolResult,
  IChatContentSegment,
  IChatPendingAction,
  IChatToolCall,
  INoteGraph,
} from "@/lib/data-types";
import { classifyNoteLocally } from "@/lib/semantic/classify-note";

interface ClientToolRequest {
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
}

type ClientToolResult = IChatClientToolResult;

interface ChatStreamBody {
  conversationId?: string;
  message?: string | unknown[];
  model: string;
  toolsEnabled?: boolean;
  webSearchEnabled?: boolean;
  toolApprovals?: Record<string, boolean>;
  clientToolResults?: ClientToolResult[];
}

export interface StreamResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    iterations?: number;
  };
  segments: IChatContentSegment[];
  pendingActions: IChatPendingAction[];
  clientToolResults: ClientToolResult[];
  paused?: boolean;
}

export interface StreamError {
  error: string;
}

export interface BackoffState {
  active: boolean;
  retryAfterMs: number;
  attempt: number;
  maxAttempts: number;
}

export interface MaxIterationsState {
  active: boolean;
  iterations: number;
  hasUnansweredTools: boolean;
}

function isApiError<T>(value: T | { code: number; message: string }): value is {
  code: number;
  message: string;
} {
  return Boolean(value && typeof value === "object" && "code" in value);
}

export function useChatStream(API: denizApi | null) {
  const [streamSegments, setStreamSegments] = useState<IChatContentSegment[]>(
    [],
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingConfirmations, setPendingConfirmations] = useState<
    IChatPendingAction[]
  >([]);
  const [backoff, setBackoff] = useState<BackoffState>({
    active: false,
    retryAfterMs: 0,
    attempt: 0,
    maxAttempts: 0,
  });
  const [maxIterations, setMaxIterations] = useState<MaxIterationsState>({
    active: false,
    iterations: 0,
    hasUnansweredTools: false,
  });
  const abortRef = useRef<(() => void) | null>(null);

  const abort = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const streamChat = useCallback(
    async (
      body: ChatStreamBody,
    ): Promise<StreamResult | StreamError | null> => {
      if (!API) return null;

      setIsStreaming(true);
      setStreamSegments([]);
      setPendingConfirmations([]);
      setMaxIterations({
        active: false,
        iterations: 0,
        hasUnansweredTools: false,
      });

      let aborted = false;
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      abortRef.current = () => {
        aborted = true;
        controller.abort();
        reader?.cancel().catch(() => {});
      };
      const segments: IChatContentSegment[] = [];
      const pendingActions: IChatPendingAction[] = [];
      // Seed with results carried in from a prior pause so they round-trip
      // through every re-pause until the conversation can complete.
      const accumulatedClientToolResults: ClientToolResult[] =
        body.clientToolResults ? [...body.clientToolResults] : [];
      let clientToolRequests: ClientToolRequest[] = [];
      let accumulated = "";

      const pushUpdate = () => setStreamSegments([...segments]);

      const appendText = (text: string) => {
        const last = segments[segments.length - 1];
        if (last?.type === "text") {
          last.text += text;
        } else {
          segments.push({ type: "text", text });
        }
        accumulated += text;
        pushUpdate();
      };

      const findToolCall = (toolId: string): IChatToolCall | null => {
        for (const seg of segments) {
          if (seg.type !== "tool_group") continue;
          const tc = seg.calls.find((c) => c.toolId === toolId);
          if (tc) return tc;
        }
        return null;
      };

      const addToolCall = (tc: IChatToolCall) => {
        const existing = findToolCall(tc.toolId);
        if (existing) {
          Object.assign(existing, tc);
          pushUpdate();
          return;
        }

        const last = segments[segments.length - 1];
        if (last?.type === "tool_group") {
          last.calls.push(tc);
        } else {
          segments.push({ type: "tool_group", calls: [tc] });
        }
        pushUpdate();
      };

      const updateToolCall = (
        toolId: string,
        update: Partial<IChatToolCall>,
      ): boolean => {
        const tc = findToolCall(toolId);
        if (tc) {
          Object.assign(tc, update);
          pushUpdate();
          return true;
        }
        return false;
      };

      const addPendingAction = (action: IChatPendingAction) => {
        const existing = pendingActions.find(
          (item) => item.toolId === action.toolId,
        );
        if (existing) {
          Object.assign(existing, action);
        } else {
          pendingActions.push(action);
        }
        setPendingConfirmations([...pendingActions]);
      };

      const executeClientTool = async (
        request: ClientToolRequest,
      ): Promise<ClientToolResult> => {
        try {
          if (aborted) throw new Error("Aborted");
          updateToolCall(request.toolId, { status: "calling" });

          if (request.toolName !== "semantic_classify_note") {
            throw new Error(`Unknown client tool "${request.toolName}"`);
          }

          const noteId =
            typeof request.input.noteId === "string"
              ? request.input.noteId
              : "";
          if (!noteId) throw new Error("noteId is required");

          const graphResult = await API.GET<INoteGraph>({ endpoint: "notes" });
          if (isApiError(graphResult)) throw new Error(graphResult.message);

          const note = graphResult.notes.find((item) => item._id === noteId);
          if (!note) throw new Error("Note not found");

          const result = await classifyNoteLocally({
            api: API,
            note,
            groups: graphResult.groups,
            signal: controller.signal,
          });
          // Send Claude only the minimum needed to confirm the operation.
          const content = JSON.stringify({
            ok: true,
            noteId: result.note._id,
            assignedGroupIds: result.classification.assignedGroupIds,
            suggestedGroupIds: result.classification.suggestedGroupIds,
            suggestedTags: result.classification.suggestedTags,
            mode: result.classification.mode,
          });

          updateToolCall(request.toolId, {
            result: content,
            isError: false,
            status: "done",
          });

          return { toolUseId: request.toolId, content };
        } catch (error) {
          const content =
            error instanceof Error ? error.message : "Client tool failed";
          updateToolCall(request.toolId, {
            result: content,
            isError: true,
            status: "error",
          });
          return { toolUseId: request.toolId, content, isError: true };
        }
      };

      try {
        let requestBody = body;

        while (true) {
          const result = await API.POST_STREAM({
            endpoint: "chat",
            body: requestBody,
            signal: controller.signal,
          });

          if ("code" in result) {
            setIsStreaming(false);
            return { error: result.message ?? "Request failed" };
          }

          reader = result.body?.getReader();
          if (!reader) {
            setIsStreaming(false);
            return { error: "No response body received" };
          }

          const decoder = new TextDecoder();
          let buffer = "";
          let shouldContinueWithClientResults = false;

          while (true) {
            if (aborted) {
              await reader.cancel();
              break;
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const json = line.slice(6);
              let event: { type: string; [k: string]: unknown };
              try {
                event = JSON.parse(json);
              } catch (err) {
                console.warn("Failed to parse SSE event:", err, json);
                continue;
              }

              if (event.type === "delta") {
                appendText(event.text as string);
              } else if (event.type === "tool_call") {
                addToolCall({
                  toolId: event.toolId as string,
                  toolName: event.toolName as string,
                  input: event.input as Record<string, unknown>,
                  status: "calling",
                });
              } else if (event.type === "client_tool_required") {
                const request = {
                  toolId: event.toolId as string,
                  toolName: event.toolName as string,
                  input: event.input as Record<string, unknown>,
                };
                clientToolRequests.push(request);
                updateToolCall(request.toolId, { status: "calling" });
              } else if (event.type === "tool_result") {
                const updated = updateToolCall(event.toolId as string, {
                  result: event.result as string,
                  isError: event.isError as boolean,
                  status: event.isError ? "error" : "done",
                });
                if (!updated && typeof event.toolName === "string") {
                  addToolCall({
                    toolId: event.toolId as string,
                    toolName: event.toolName,
                    input: {},
                    result: event.result as string,
                    isError: event.isError as boolean,
                    status: event.isError ? "error" : "done",
                  });
                }
              } else if (event.type === "tool_confirmation_required") {
                updateToolCall(event.toolId as string, {
                  status: "pending_approval",
                });
                addPendingAction({
                  toolId: event.toolId as string,
                  toolName: event.toolName as string,
                  input: event.input as Record<string, unknown>,
                  status: "pending",
                });
              } else if (event.type === "rate_limit_backoff") {
                const retryAfterMs = event.retryAfterMs as number;
                setBackoff({
                  active: true,
                  retryAfterMs,
                  attempt: event.attempt as number,
                  maxAttempts: event.maxAttempts as number,
                });
                setTimeout(() => {
                  setBackoff((prev) => ({ ...prev, active: false }));
                }, retryAfterMs);
              } else if (event.type === "max_iterations_reached") {
                setMaxIterations({
                  active: true,
                  iterations: event.iterations as number,
                  hasUnansweredTools: Boolean(event.hasUnansweredTools),
                });
              } else if (event.type === "persist_warning") {
                console.warn("Persist warning from server:", event.error);
              } else if (event.type === "paused") {
                // Always execute any pending client tools immediately —
                // they don't need user interaction. Accumulate their
                // results so they're carried through the (possibly
                // multi-trip) approval handshake.
                let hasNewClientToolResults = false;
                if (clientToolRequests.length > 0) {
                  const results = await Promise.all(
                    clientToolRequests.map(executeClientTool),
                  );
                  const seenIds = new Set(
                    accumulatedClientToolResults.map((r) => r.toolUseId),
                  );
                  for (const r of results) {
                    if (!seenIds.has(r.toolUseId)) {
                      accumulatedClientToolResults.push(r);
                      seenIds.add(r.toolUseId);
                      hasNewClientToolResults = true;
                    }
                  }
                  clientToolRequests = [];
                }

                if (aborted) {
                  setIsStreaming(false);
                  return null;
                }

                if (pendingActions.length === 0 || hasNewClientToolResults) {
                  // Resume immediately whenever client-side work was produced.
                  // If approvals were already supplied for this continuation,
                  // carry them through so mixed client/server turns do not ask
                  // for the same approval twice.
                  requestBody = {
                    conversationId: body.conversationId,
                    model: body.model,
                    toolsEnabled: body.toolsEnabled,
                    webSearchEnabled: body.webSearchEnabled,
                    clientToolResults: [...accumulatedClientToolResults],
                    ...(requestBody.toolApprovals
                      ? { toolApprovals: requestBody.toolApprovals }
                      : {}),
                  };
                  shouldContinueWithClientResults = true;
                  break;
                }

                // Approvals still required — surface to UI. Caller
                // must re-invoke streamChat with toolApprovals AND the
                // accumulated clientToolResults so the server can build
                // a single user turn covering every pending tool_use.
                setIsStreaming(false);
                return {
                  content: accumulated,
                  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
                  segments: [...segments],
                  pendingActions,
                  clientToolResults: [...accumulatedClientToolResults],
                  paused: true,
                };
              } else if (event.type === "done") {
                setIsStreaming(false);
                return {
                  content: accumulated,
                  usage: event.usage as StreamResult["usage"],
                  segments: [...segments],
                  pendingActions,
                  clientToolResults: [...accumulatedClientToolResults],
                };
              } else if (event.type === "error") {
                setIsStreaming(false);
                return {
                  error: (event.error as string) ?? "An unknown error occurred",
                };
              }
            }

            if (shouldContinueWithClientResults) break;
          }

          if (shouldContinueWithClientResults) continue;
          break;
        }

        setIsStreaming(false);
        return aborted
          ? null
          : {
              content: accumulated,
              usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
              segments: [...segments],
              pendingActions,
              clientToolResults: [...accumulatedClientToolResults],
            };
      } catch (e) {
        setIsStreaming(false);
        if (aborted) return null;
        return {
          error:
            e instanceof Error ? e.message : "An unexpected error occurred",
        };
      }
    },
    [API],
  );

  return {
    streamSegments,
    isStreaming,
    streamChat,
    abort,
    pendingConfirmations,
    setPendingConfirmations,
    backoff,
    maxIterations,
    setMaxIterations,
  };
}
