"use client";

import type {
  AgentConversationResponse,
  AgentExecutionMode,
  AgentMemoryMode,
  AgentToolToggles,
  AgentUIMessage,
  BackgroundAgentRun,
  BackgroundAgentRunList,
  BackgroundAgentRunResponse,
  Connector,
  ConversationListResponse,
  IConversationMeta,
} from "@repo/schemas";
import { type FileUIPart, generateId } from "ai";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { AdminApiError } from "../client";
import { useAdmin } from "../provider";
import { captureAgentPageContext } from "./agent-page-context";
import { awaitsClient, shouldContinueAgentTurn } from "./agent-parts";
import {
  type AgentComposerPrefs,
  loadAgentComposerPrefs,
  saveAgentComposerPrefs,
} from "./launcher-prefs";
import { type AgentChat, useAgentChat } from "./use-agent-chat";
import { useConnectors } from "./use-connectors";
import {
  isModelEligible,
  type ModelCatalogState,
  pickDefaultModel,
  useModelCatalog,
} from "./use-model-catalog";

const HISTORY_PAGE_SIZE = 90;
const TRACKED_RUN_POLL_MS = 2_000;
const ACTIVE_RUN_POLL_MS = 4_000;
const IDLE_RUN_POLL_MS = 15_000;
const MAX_ATTACHMENTS = 8;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface AgentSettings {
  model: string | null;
  tools: AgentToolToggles;
  executionMode: AgentExecutionMode;
  memoryMode: AgentMemoryMode;
  background: boolean;
  /** Connector slugs switched off for this conversation. */
  disabledConnectors: string[];
}

export interface AgentAttachment {
  id: string;
  name: string;
  mediaType: string;
  kind: "image" | "pdf";
  size: number;
  previewUrl?: string;
  url?: string;
  status: "uploading" | "done" | "error";
  error?: string;
}

interface HistoryState {
  conversations: IConversationMeta[];
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  loaded: boolean;
}

export interface AgentSession {
  chat: AgentChat;
  conversationId: string | null;
  title: string;
  loadingConversation: boolean;
  settings: AgentSettings;
  updateSettings: (patch: Partial<AgentSettings>) => void;
  connectors: Connector[];
  catalog: ModelCatalogState;
  requiredCapabilities: string[];
  modelIncompatible: boolean;
  draft: string;
  setDraft: (value: string) => void;
  attachments: AgentAttachment[];
  addFiles: (files: File[]) => void;
  removeAttachment: (id: string) => void;
  send: (text?: string) => Promise<void>;
  retry: () => void;
  newChat: () => void;
  openConversation: (id: string) => Promise<void>;
  renameConversation: (title: string) => Promise<void>;
  setMemoryMode: (mode: AgentMemoryMode) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  history: HistoryState & {
    refresh: () => Promise<void>;
    loadMore: () => Promise<void>;
  };
  allowBackground: boolean;
  backgroundRun: BackgroundAgentRun | null;
  /** True while a turn streams, a background run works, or the thread waits on approval. */
  busy: boolean;
}

const AgentSessionContext = createContext<AgentSession | null>(null);

export function useAgentSession(): AgentSession {
  const session = useContext(AgentSessionContext);
  if (!session) {
    throw new Error("useAgentSession must be used within AgentSessionProvider");
  }
  return session;
}

export function useOptionalAgentSession(): AgentSession | null {
  return useContext(AgentSessionContext);
}

function settingsFromPrefs(
  prefs: AgentComposerPrefs,
  model: string | null,
): AgentSettings {
  return {
    model,
    tools: {
      webSearch: prefs.webSearch,
      webFetch: prefs.webFetch,
      thinkLonger: prefs.thinkLonger,
    },
    executionMode: prefs.executionMode,
    memoryMode: "enabled",
    background: false,
    disabledConnectors: [],
  };
}

function conversationTitle(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Attachment";
  return trimmed.length > 50 ? `${trimmed.slice(0, 50)}…` : trimmed;
}

function isTerminal(run: BackgroundAgentRun): boolean {
  return run.status !== "queued" && run.status !== "running";
}

export function AgentSessionProvider({
  allowBackground = false,
  onActiveRunChange,
  children,
}: {
  allowBackground?: boolean;
  onActiveRunChange?: (run: BackgroundAgentRun | null) => void;
  children: ReactNode;
}) {
  const { client, routes } = useAdmin();
  const catalog = useModelCatalog();
  const { connectors: connectorList } = useConnectors();
  const [prefs] = useState(loadAgentComposerPrefs);
  const [settings, setSettings] = useState<AgentSettings>(() =>
    settingsFromPrefs(prefs, prefs.model),
  );
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [thread, setThread] = useState<{
    key: string;
    messages: AgentUIMessage[];
  }>(() => ({ key: `draft:${generateId()}`, messages: [] }));
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [history, setHistory] = useState<HistoryState>({
    conversations: [],
    nextCursor: null,
    loading: false,
    loadingMore: false,
    loaded: false,
  });
  const [trackedRunId, setTrackedRunId] = useState<string | null>(null);
  const [backgroundRun, setBackgroundRun] = useState<BackgroundAgentRun | null>(
    null,
  );

  const conversationIdRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const adoptedRuns = useRef(new Set<string>());
  const onActiveRunChangeRef = useRef(onActiveRunChange);
  onActiveRunChangeRef.current = onActiveRunChange;

  const connectors = useMemo(
    () => (connectorList ?? []).filter((connector) => connector.enabled),
    [connectorList],
  );
  const connectorsRef = useRef(connectors);
  connectorsRef.current = connectors;

  const chat = useAgentChat({
    endpoint: "chat",
    chatKey: thread.key,
    initialMessages: thread.messages,
    canReadPage: () => settingsRef.current.memoryMode !== "incognito",
    body: () => {
      const current = settingsRef.current;
      const disabled = new Set(current.disabledConnectors);
      return {
        conversationId: conversationIdRef.current,
        model: current.model,
        tools: current.tools,
        connectors:
          disabled.size === 0
            ? undefined
            : connectorsRef.current
                .map((connector) => connector.slug)
                .filter((slug) => !disabled.has(slug)),
        executionMode: current.executionMode,
        pageContext:
          current.memoryMode === "incognito"
            ? undefined
            : captureAgentPageContext({ dashboardRoot: routes.dashboardRoot }),
      };
    },
  });

  const requiredCapabilities = useMemo(
    () => [
      "tool-use",
      ...(settings.tools.webSearch ? ["web-search"] : []),
      ...(attachments.some((attachment) => attachment.kind === "image")
        ? ["vision"]
        : []),
    ],
    [attachments, settings.tools.webSearch],
  );

  const modelIncompatible =
    settings.model !== null &&
    !isModelEligible(settings.model, catalog.models, requiredCapabilities);

  useEffect(() => {
    if (settings.model || !catalog.models?.length) return;
    const stored = prefs.model;
    const next =
      stored && catalog.models.some((model) => model.id === stored)
        ? stored
        : pickDefaultModel(catalog.models, ["tool-use"]);
    if (next) setSettings((current) => ({ ...current, model: next }));
  }, [catalog.models, prefs.model, settings.model]);

  const updateSettings = useCallback((patch: Partial<AgentSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveAgentComposerPrefs({
        model: next.model,
        webSearch: next.tools.webSearch,
        webFetch: next.tools.webFetch,
        thinkLonger: next.tools.thinkLonger,
        executionMode: next.executionMode,
      });
      return next;
    });
  }, []);

  const refreshHistory = useCallback(async () => {
    setHistory((current) => ({ ...current, loading: !current.loaded }));
    try {
      const result = await client.get<ConversationListResponse>(
        `conversations?limit=${HISTORY_PAGE_SIZE}`,
      );
      setHistory({
        conversations: result.conversations,
        nextCursor: result.nextCursor,
        loading: false,
        loadingMore: false,
        loaded: true,
      });
    } catch {
      setHistory((current) => ({ ...current, loading: false }));
    }
  }, [client]);

  const loadMoreHistory = useCallback(async () => {
    const cursor = history.nextCursor;
    if (!cursor || history.loadingMore) return;
    setHistory((current) => ({ ...current, loadingMore: true }));
    try {
      const params = new URLSearchParams({
        limit: String(HISTORY_PAGE_SIZE),
        cursor,
      });
      const result = await client.get<ConversationListResponse>(
        `conversations?${params.toString()}`,
      );
      setHistory((current) => {
        const seen = new Set(current.conversations.map((entry) => entry._id));
        return {
          ...current,
          conversations: [
            ...current.conversations,
            ...result.conversations.filter((entry) => !seen.has(entry._id)),
          ],
          nextCursor: result.nextCursor,
          loadingMore: false,
        };
      });
    } catch {
      setHistory((current) => ({ ...current, loadingMore: false }));
    }
  }, [client, history.loadingMore, history.nextCursor]);

  const resetAttachments = useCallback(() => {
    setAttachments((current) => {
      for (const attachment of current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      }
      return [];
    });
  }, []);

  const newChat = useCallback(() => {
    conversationIdRef.current = null;
    setConversationId(null);
    setTitle("");
    setTrackedRunId(null);
    setBackgroundRun(null);
    setDraft("");
    resetAttachments();
    setSettings((current) => ({
      ...current,
      memoryMode: "enabled",
      background: false,
      disabledConnectors: [],
    }));
    setThread({ key: `draft:${generateId()}`, messages: [] });
  }, [resetAttachments]);

  const openConversation = useCallback(
    async (id: string) => {
      setLoadingConversation(true);
      try {
        const { conversation } = await client.get<AgentConversationResponse>(
          `conversations/${id}`,
        );
        conversationIdRef.current = id;
        setConversationId(id);
        setTitle(conversation.title);
        setSettings((current) => ({
          ...current,
          model: conversation.llmModel,
          memoryMode: conversation.memoryMode,
          background: false,
          disabledConnectors: [],
        }));
        setThread({
          key: `${id}:${generateId()}`,
          messages: conversation.messages,
        });
      } catch {
        toast.error("Failed to load conversation");
      } finally {
        setLoadingConversation(false);
      }
    },
    [client],
  );

  const renameConversation = useCallback(
    async (nextTitle: string) => {
      const id = conversationIdRef.current;
      const trimmed = nextTitle.trim();
      if (!id || !trimmed) return;
      const previous = title;
      setTitle(trimmed);
      try {
        await client.patch(`conversations/${id}`, { title: trimmed });
        setHistory((current) => ({
          ...current,
          conversations: current.conversations.map((entry) =>
            entry._id === id ? { ...entry, title: trimmed } : entry,
          ),
        }));
      } catch {
        setTitle(previous);
        toast.error("Failed to rename conversation");
      }
    },
    [client, title],
  );

  const setMemoryMode = useCallback(
    async (mode: AgentMemoryMode) => {
      const id = conversationIdRef.current;
      if (!id) {
        setSettings((current) => ({ ...current, memoryMode: mode }));
        return;
      }
      try {
        const { conversation } = await client.patch<AgentConversationResponse>(
          `conversations/${id}`,
          { memoryMode: mode },
        );
        setSettings((current) => ({
          ...current,
          memoryMode: conversation.memoryMode,
        }));
      } catch (cause) {
        toast.error(
          cause instanceof AdminApiError
            ? cause.message
            : "Failed to change memory mode",
        );
      }
    },
    [client],
  );

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await client.del(`conversations/${id}`);
      } catch {
        toast.error("Failed to delete conversation");
        return;
      }
      setHistory((current) => ({
        ...current,
        conversations: current.conversations.filter(
          (entry) => entry._id !== id,
        ),
      }));
      if (conversationIdRef.current === id) newChat();
    },
    [client, newChat],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const accepted = files
        .filter(
          (file) =>
            (file.type.startsWith("image/") ||
              file.type === "application/pdf") &&
            file.size <= MAX_ATTACHMENT_BYTES,
        )
        .slice(0, Math.max(0, MAX_ATTACHMENTS - attachments.length));
      if (accepted.length < files.length) {
        toast.error("Images or PDFs up to 20 MB, eight at a time");
      }
      for (const file of accepted) {
        const id = generateId();
        const kind = file.type.startsWith("image/") ? "image" : "pdf";
        setAttachments((current) => [
          ...current,
          {
            id,
            name: file.name,
            mediaType: file.type,
            kind,
            size: file.size,
            previewUrl:
              kind === "image" ? URL.createObjectURL(file) : undefined,
            status: "uploading",
          },
        ]);
        const formData = new FormData();
        formData.append("file", file);
        client
          .upload<{ url: string }>("upload", formData)
          .then(({ url }) => {
            setAttachments((current) =>
              current.map((attachment) =>
                attachment.id === id
                  ? { ...attachment, url, status: "done" }
                  : attachment,
              ),
            );
          })
          .catch((cause: unknown) => {
            setAttachments((current) =>
              current.map((attachment) =>
                attachment.id === id
                  ? {
                      ...attachment,
                      status: "error",
                      error:
                        cause instanceof Error
                          ? cause.message
                          : "Upload failed",
                    }
                  : attachment,
              ),
            );
          });
      }
    },
    [attachments.length, client],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => {
      const found = current.find((attachment) => attachment.id === id);
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return current.filter((attachment) => attachment.id !== id);
    });
  }, []);

  const streaming = chat.status === "submitted" || chat.status === "streaming";

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? draft).trim();
      const ready =
        override === undefined
          ? attachments.filter(
              (attachment): attachment is AgentAttachment & { url: string } =>
                attachment.status === "done" && attachment.url !== undefined,
            )
          : [];
      const current = settingsRef.current;
      if ((!text && ready.length === 0) || !current.model) return;
      if (streaming || trackedRunId) return;
      if (
        override === undefined &&
        attachments.some((attachment) => attachment.status === "uploading")
      ) {
        return;
      }

      const files: FileUIPart[] = ready.map((attachment) => ({
        type: "file",
        mediaType: attachment.mediaType,
        url: attachment.url,
        filename: attachment.name,
      }));
      const page =
        current.memoryMode === "incognito" || typeof window === "undefined"
          ? undefined
          : {
              pathname: window.location.pathname,
              ...(document.title ? { title: document.title } : {}),
            };

      if (override === undefined) {
        setDraft("");
        resetAttachments();
      }

      let id = conversationIdRef.current;
      if (!id) {
        const nextTitle = conversationTitle(text);
        try {
          const { conversation } = await client.post<AgentConversationResponse>(
            "conversations",
            {
              title: nextTitle,
              model: current.model,
              memoryMode: current.memoryMode,
            },
          );
          id = conversation._id;
        } catch {
          toast.error("Failed to create conversation");
          if (override === undefined) setDraft(text);
          return;
        }
        conversationIdRef.current = id;
        setConversationId(id);
        setTitle(nextTitle);
        if (history.loaded) void refreshHistory();
      }

      if (current.background && allowBackground) {
        try {
          const { run } = await client.post<BackgroundAgentRunResponse>(
            "background-agent/runs",
            {
              prompt: text,
              model: current.model,
              conversationId: id,
              pageContext:
                current.memoryMode === "incognito"
                  ? undefined
                  : captureAgentPageContext({
                      dashboardRoot: routes.dashboardRoot,
                    }),
              attachments: ready.map((attachment) => ({
                type: attachment.kind,
                url: attachment.url,
                name: attachment.name,
              })),
            },
          );
          chat.setMessages((messages) => [
            ...messages,
            {
              id: generateId(),
              role: "user",
              parts: [
                ...files,
                ...(text ? [{ type: "text" as const, text }] : []),
              ],
            },
          ]);
          adoptedRuns.current.add(run.id);
          setBackgroundRun(run);
          setTrackedRunId(run.id);
          onActiveRunChangeRef.current?.(run);
        } catch {
          toast.error("Failed to start background run");
        }
        return;
      }

      const metadata = page ? { page } : undefined;
      void (text
        ? chat.sendMessage({ text, files, metadata })
        : chat.sendMessage({ files, metadata }));
    },
    [
      allowBackground,
      attachments,
      chat,
      client,
      draft,
      history.loaded,
      refreshHistory,
      resetAttachments,
      routes.dashboardRoot,
      streaming,
      trackedRunId,
    ],
  );

  const retry = useCallback(() => {
    const messages = chat.messages;
    const last = messages.at(-1);
    chat.clearError();
    if (!last) return;
    if (last.role === "user" || shouldContinueAgentTurn({ messages })) {
      void chat.sendMessage();
      return;
    }
    void chat.regenerate({ messageId: last.id });
  }, [chat]);

  useEffect(() => {
    if (!trackedRunId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const { run } = await client.get<BackgroundAgentRunResponse>(
          `background-agent/runs/${trackedRunId}`,
        );
        if (cancelled) return;
        setBackgroundRun(run);
        if (!isTerminal(run)) {
          onActiveRunChangeRef.current?.(run);
          timer = setTimeout(tick, TRACKED_RUN_POLL_MS);
          return;
        }
        onActiveRunChangeRef.current?.(null);
        setTrackedRunId(null);
        setBackgroundRun(null);
        await openConversation(run.conversationId);
        if (run.status === "completed") toast.success("Agent finished");
        else toast.error(run.error ?? "Background run failed");
      } catch {
        if (!cancelled) timer = setTimeout(tick, TRACKED_RUN_POLL_MS);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, openConversation, trackedRunId]);

  useEffect(() => {
    if (!allowBackground || trackedRunId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let run: BackgroundAgentRun | null = null;
      try {
        const result = await client.get<BackgroundAgentRunList>(
          "background-agent/runs?active=true",
        );
        run = result.runs[0] ?? null;
      } catch {}
      if (cancelled) return;
      onActiveRunChangeRef.current?.(run);
      if (run && !adoptedRuns.current.has(run.id)) {
        adoptedRuns.current.add(run.id);
        setBackgroundRun(run);
        setTrackedRunId(run.id);
        return;
      }
      timer = setTimeout(tick, run ? ACTIVE_RUN_POLL_MS : IDLE_RUN_POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [allowBackground, client, trackedRunId]);

  const awaitingApproval = awaitsClient(chat.messages);

  const value = useMemo<AgentSession>(
    () => ({
      chat,
      conversationId,
      title,
      loadingConversation,
      settings,
      updateSettings,
      connectors,
      catalog,
      requiredCapabilities,
      modelIncompatible,
      draft,
      setDraft,
      attachments,
      addFiles,
      removeAttachment,
      send,
      retry,
      newChat,
      openConversation,
      renameConversation,
      setMemoryMode,
      deleteConversation,
      history: {
        ...history,
        refresh: refreshHistory,
        loadMore: loadMoreHistory,
      },
      allowBackground,
      backgroundRun,
      busy: streaming || trackedRunId !== null || awaitingApproval,
    }),
    [
      addFiles,
      allowBackground,
      attachments,
      awaitingApproval,
      backgroundRun,
      catalog,
      chat,
      connectors,
      conversationId,
      deleteConversation,
      draft,
      history,
      loadMoreHistory,
      loadingConversation,
      modelIncompatible,
      newChat,
      openConversation,
      refreshHistory,
      removeAttachment,
      renameConversation,
      requiredCapabilities,
      retry,
      send,
      setMemoryMode,
      settings,
      streaming,
      title,
      trackedRunId,
      updateSettings,
    ],
  );

  return (
    <AgentSessionContext.Provider value={value}>
      {children}
    </AgentSessionContext.Provider>
  );
}
