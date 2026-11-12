"use client";

import type {
  AgentConversationResponse,
  AgentToolToggles,
  AgentUIMessage,
  StudyCitation,
} from "@repo/schemas";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@repo/ui/ai-elements/prompt-input";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { generateId } from "ai";
import { ChevronDown, MessageSquare, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AgentModelPicker, AgentToolsMenu } from "../agent/agent-composer";
import { AgentMessageList } from "../agent/agent-messages";
import {
  loadAgentComposerPrefs,
  saveAgentComposerPrefs,
} from "../agent/launcher-prefs";
import { describeAgentError, useAgentChat } from "../agent/use-agent-chat";
import { pickDefaultModel, useModelCatalog } from "../agent/use-model-catalog";
import { useAdmin } from "../provider";
import { CitationList, CitedText } from "./citations";
import { listStudyThreads, type StudyThread } from "./study-api";
import {
  errorMessage,
  messageCitations,
  openStudySource,
  relativeTime,
} from "./study-format";

const REQUIRED = ["tool-use"];

function threadTitle(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || "Study";
}

/** Source keys the newest assistant answer cited — what the Map highlights. */
export function latestCitedKeys(messages: AgentUIMessage[]): string[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const citations = messageCitations(message);
    if (citations.length === 0) continue;
    return [...new Set(citations.map((citation) => citation.sourceKey))];
  }
  return [];
}

export function NotebookChat({
  notebookId,
  initialConversationId,
  onCitedKeys,
}: {
  notebookId: string;
  initialConversationId?: string;
  onCitedKeys?: (keys: string[]) => void;
}) {
  const admin = useAdmin();
  const { client } = admin;
  const catalog = useModelCatalog();
  const [prefs] = useState(loadAgentComposerPrefs);
  const [model, setModel] = useState<string | null>(prefs.model);
  const [tools, setTools] = useState<AgentToolToggles>({
    webSearch: false,
    webFetch: false,
    thinkLonger: prefs.thinkLonger,
  });
  const [threads, setThreads] = useState<StudyThread[] | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [thread, setThread] = useState<{
    key: string;
    messages: AgentUIMessage[];
  }>(() => ({ key: `draft:${generateId()}`, messages: [] }));
  const [loadingThread, setLoadingThread] = useState(
    Boolean(initialConversationId),
  );
  const [draft, setDraft] = useState("");

  const conversationIdRef = useRef<string | null>(null);
  const settingsRef = useRef({ model, tools });
  settingsRef.current = { model, tools };

  useEffect(() => {
    if (model || !catalog.models?.length) return;
    const stored = prefs.model;
    const next =
      stored && catalog.models.some((entry) => entry.id === stored)
        ? stored
        : pickDefaultModel(catalog.models, REQUIRED);
    if (next) setModel(next);
  }, [catalog.models, model, prefs.model]);

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await listStudyThreads(client, notebookId));
    } catch {
      setThreads((current) => current ?? []);
    }
  }, [client, notebookId]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  const chat = useAgentChat({
    endpoint: `study/notebooks/${encodeURIComponent(notebookId)}/chat`,
    chatKey: thread.key,
    initialMessages: thread.messages,
    canReadPage: () => false,
    body: () => ({
      conversationId: conversationIdRef.current,
      model: settingsRef.current.model,
      tools: settingsRef.current.tools,
      executionMode: "interactive",
    }),
    onFinish: () => void refreshThreads(),
  });

  const openThread = useCallback(
    async (id: string) => {
      setLoadingThread(true);
      try {
        const { conversation } = await client.get<AgentConversationResponse>(
          `conversations/${encodeURIComponent(id)}`,
        );
        conversationIdRef.current = id;
        setConversationId(id);
        setModel(conversation.llmModel);
        setThread({
          key: `${id}:${generateId()}`,
          messages: conversation.messages,
        });
      } catch (error) {
        toast.error(errorMessage(error, "Failed to load thread"));
      } finally {
        setLoadingThread(false);
      }
    },
    [client],
  );

  // Only the first answer counts: a later notebook refresh names the thread
  // already open, and reopening it would cut off a turn mid-stream.
  const openedInitial = useRef(false);
  useEffect(() => {
    if (openedInitial.current || !initialConversationId) return;
    openedInitial.current = true;
    void openThread(initialConversationId);
  }, [initialConversationId, openThread]);

  const newThread = () => {
    void chat.stop();
    conversationIdRef.current = null;
    setConversationId(null);
    setDraft("");
    setThread({ key: `draft:${generateId()}`, messages: [] });
  };

  const citedKeys = useMemo(
    () => latestCitedKeys(chat.messages),
    [chat.messages],
  );
  const onCitedKeysRef = useRef(onCitedKeys);
  onCitedKeysRef.current = onCitedKeys;
  const citedSignature = citedKeys.join("|");
  useEffect(() => {
    onCitedKeysRef.current?.(citedSignature ? citedSignature.split("|") : []);
  }, [citedSignature]);

  const openCitation = useCallback(
    (citation: StudyCitation) => {
      void openStudySource(admin, citation);
    },
    [admin],
  );

  const handlers = useMemo(
    () => ({
      onApproval: (id: string, approved: boolean) =>
        void chat.addToolApprovalResponse({ id, approved }),
      onRegenerate: (messageId: string) => void chat.regenerate({ messageId }),
      renderText: (
        text: string,
        streaming: boolean,
        message: AgentUIMessage,
      ) => (
        <CitedText
          text={text}
          streaming={streaming}
          citations={messageCitations(message)}
          onOpen={openCitation}
        />
      ),
      renderAfter: (message: AgentUIMessage) => (
        <CitationList
          citations={messageCitations(message)}
          onOpen={openCitation}
        />
      ),
    }),
    [chat, openCitation],
  );

  const busy = chat.status === "submitted" || chat.status === "streaming";
  const canSend = Boolean(draft.trim()) && Boolean(model) && !busy;

  const send = async () => {
    const text = draft.trim();
    const currentModel = settingsRef.current.model;
    if (!text || !currentModel) return;
    setDraft("");
    let id = conversationIdRef.current;
    if (!id) {
      try {
        const { conversation } = await client.post<AgentConversationResponse>(
          "conversations",
          {
            title: threadTitle(text),
            model: currentModel,
            memoryMode: "incognito",
          },
        );
        id = conversation._id;
      } catch (error) {
        setDraft(text);
        toast.error(errorMessage(error, "Failed to start thread"));
        return;
      }
      conversationIdRef.current = id;
      setConversationId(id);
    }
    void chat.sendMessage({ text });
  };

  const error = describeAgentError(chat.error);
  const current = threads?.find((entry) => entry.id === conversationId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 max-w-full justify-start"
            >
              <MessageSquare />
              <span className="min-w-0 truncate">
                {current?.title ?? (conversationId ? "Thread" : "New thread")}
              </span>
              <ChevronDown className="opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-80 max-h-96">
            <DropdownMenuItem onSelect={newThread}>
              <Plus /> New thread
            </DropdownMenuItem>
            {threads && threads.length > 0 ? <DropdownMenuSeparator /> : null}
            {(threads ?? []).map((entry) => (
              <DropdownMenuItem
                key={entry.id}
                onSelect={() => void openThread(entry.id)}
                className={cn(entry.id === conversationId && "bg-surface")}
              >
                <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {relativeTime(entry.updatedAt)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1" />
        {threads ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {threads.length}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New thread"
          onClick={newThread}
        >
          <Plus />
        </Button>
      </div>

      {loadingThread ? (
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
          <Skeleton className="ml-auto h-8 w-1/2" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        </div>
      ) : chat.messages.length === 0 ? (
        <div className="min-h-0 flex-1" />
      ) : (
        <AgentMessageList
          messages={chat.messages}
          status={chat.status}
          handlers={handlers}
          contentClassName="max-w-3xl"
        />
      )}

      {error ? (
        <div
          role="alert"
          className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 pb-2 text-xs text-destructive"
        >
          <span className="min-w-0 flex-1 truncate" title={error}>
            {error}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Dismiss"
            className="text-muted-foreground"
            onClick={chat.clearError}
          >
            <X />
          </Button>
        </div>
      ) : null}

      <div className="@container/composer mx-auto w-full max-w-3xl shrink-0 p-3 pt-0">
        <PromptInput onSubmit={() => void send()}>
          <PromptInputBody>
            <PromptInputTextarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask this notebook"
              disabled={!model}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <AgentModelPicker
                model={model}
                onModelChange={(next) => {
                  setModel(next);
                  saveAgentComposerPrefs({
                    ...loadAgentComposerPrefs(),
                    model: next,
                  });
                }}
                models={catalog.models}
                loading={catalog.loading}
                error={catalog.error}
                stale={catalog.stale}
                onRetry={catalog.retry}
                requiredCapabilities={REQUIRED}
              />
              <AgentToolsMenu tools={tools} onChange={setTools} />
            </PromptInputTools>
            <PromptInputSubmit
              status={chat.status}
              onStop={() => void chat.stop()}
              hasContent={canSend || busy}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
