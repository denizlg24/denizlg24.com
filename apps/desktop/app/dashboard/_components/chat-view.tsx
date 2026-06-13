"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { ScrollArea } from "@repo/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@repo/ui/sheet";
import { Skeleton } from "@repo/ui/skeleton";
import {
  ArrowLeft,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useUserSettings } from "@/context/user-context";
import {
  type StreamError,
  type StreamResult,
  useChatStream,
} from "@/hooks/use-chat-stream";
import { denizApi } from "@/lib/api-wrapper";
import type {
  IChatAttachment,
  IChatContentSegment,
  IChatMessage,
  IChatMessageAttachment,
  IChatPendingAction,
  IChatToolCall,
  IConversation,
  IConversationMeta,
} from "@/lib/data-types";
import { ChatInput } from "./chat-input";
import { ChatMessage } from "./chat-message";
import { DashboardSummary } from "./dashboard-summary";

const MODEL_LABELS: Record<string, string> = {
  "claude-opus-4-7": "Opus 4.7",
  "claude-opus-4-6": "Opus 4.6",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5": "Haiku 4.5",
  "claude-opus-4-5": "Opus 4.5",
  "claude-sonnet-4-5": "Sonnet 4.5",
};

const SUGGESTIONS = [
  "What events do I have this week?",
  "Summarize my recent notes",
  "Show me my kanban boards",
  "What's on my timetable today?",
  "Search for recent blog posts",
  "List my pending contacts",
  "Show my project portfolio",
  "Check my latest emails",
];

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function useSuggestion() {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % SUGGESTIONS.length);
        setVisible(true);
      }, 300);
    }, 4000);
    return () => clearInterval(id);
  }, []);
  return { text: SUGGESTIONS[index], visible };
}

function isStreamError(r: StreamResult | StreamError | null): r is StreamError {
  return r !== null && "error" in r;
}

type ConversationGroup = {
  label: string;
  conversations: IConversationMeta[];
};

function groupConversationsByDate(
  conversations: IConversationMeta[],
): ConversationGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  const groups = {
    Today: [] as IConversationMeta[],
    Yesterday: [] as IConversationMeta[],
    "Previous 7 days": [] as IConversationMeta[],
    "Previous 30 days": [] as IConversationMeta[],
    Older: [] as IConversationMeta[],
  };

  for (const conv of conversations) {
    const date = new Date(conv.updatedAt);
    if (date >= today) {
      groups.Today.push(conv);
    } else if (date >= yesterday) {
      groups.Yesterday.push(conv);
    } else if (date >= sevenDaysAgo) {
      groups["Previous 7 days"].push(conv);
    } else if (date >= thirtyDaysAgo) {
      groups["Previous 30 days"].push(conv);
    } else {
      groups.Older.push(conv);
    }
  }

  const orderedLabels = [
    "Today",
    "Yesterday",
    "Previous 7 days",
    "Previous 30 days",
    "Older",
  ] as const;

  return orderedLabels
    .filter((label) => groups[label].length > 0)
    .map((label) => ({ label, conversations: groups[label] }));
}

function convertApiMessagesToDisplay(
  rawMessages: IConversation["messages"],
): IChatMessage[] {
  const display: IChatMessage[] = [];

  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i];

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        display.push(msg);
        continue;
      }

      const contentArr = msg.content as any[];
      const isToolResultMessage =
        contentArr.length > 0 &&
        contentArr.every((block: any) => block.type === "tool_result");

      if (isToolResultMessage) {
        const prevDisplay = display[display.length - 1];
        if (prevDisplay?.role === "assistant" && prevDisplay.segments) {
          for (const result of contentArr) {
            for (const seg of prevDisplay.segments) {
              if (seg.type !== "tool_group") continue;
              const tc = seg.calls.find(
                (c: IChatToolCall) => c.toolId === result.tool_use_id,
              );
              if (tc) {
                tc.result =
                  typeof result.content === "string"
                    ? result.content
                    : JSON.stringify(result.content);
                tc.isError = result.is_error ?? false;
                tc.status = result.is_error ? "error" : "done";
              }
            }
          }
        }
        continue;
      }

      const attachments: IChatMessageAttachment[] = [];
      for (const block of contentArr) {
        if (block.type === "image" && block.source?.url) {
          attachments.push({
            type: "image",
            url: block.source.url,
            name: "Image",
          });
        } else if (block.type === "document" && block.source?.url) {
          attachments.push({
            type: "pdf",
            url: block.source.url,
            name: block.source.url.split("/").pop() ?? "Document",
          });
        }
      }

      display.push({
        ...msg,
        attachments: attachments.length > 0 ? attachments : undefined,
      });
      continue;
    }

    if (typeof msg.content === "string") {
      display.push(msg);
      continue;
    }

    const contentArr = msg.content as any[];
    const segments: IChatContentSegment[] = [];

    for (const block of contentArr) {
      if (block.type === "text") {
        const last = segments[segments.length - 1];
        if (last?.type === "text") {
          last.text += block.text;
        } else {
          segments.push({ type: "text", text: block.text });
        }
      } else if (block.type === "tool_use") {
        const toolCall: IChatToolCall = {
          toolId: block.id,
          toolName: block.name,
          input: block.input,
          status: "calling",
        };
        const last = segments[segments.length - 1];
        if (last?.type === "tool_group") {
          last.calls.push(toolCall);
        } else {
          segments.push({ type: "tool_group", calls: [toolCall] });
        }
      }
    }

    const nextMsg = rawMessages[i + 1];
    if (
      nextMsg?.role === "user" &&
      Array.isArray(nextMsg.content) &&
      (nextMsg.content as any[]).every(
        (block: any) => block.type === "tool_result",
      )
    ) {
      for (const result of nextMsg.content as any[]) {
        for (const seg of segments) {
          if (seg.type !== "tool_group") continue;
          const tc = seg.calls.find((c) => c.toolId === result.tool_use_id);
          if (tc) {
            tc.result =
              typeof result.content === "string"
                ? result.content
                : JSON.stringify(result.content);
            tc.isError = result.is_error ?? false;
            tc.status = result.is_error ? "error" : "done";
          }
        }
      }
    } else {
      for (const seg of segments) {
        if (seg.type !== "tool_group") continue;
        for (const tc of seg.calls) {
          if (tc.status === "calling") {
            tc.status = "pending_approval";
          }
        }
      }
    }

    const displayMsg: IChatMessage = {
      ...msg,
      segments: segments.length > 0 ? segments : undefined,
      content:
        segments
          .filter((s): s is { type: "text"; text: string } => s.type === "text")
          .map((s) => s.text)
          .join("") || "",
    };

    const prevDisplay = display[display.length - 1];
    if (
      prevDisplay?.role === "assistant" &&
      prevDisplay.segments &&
      i >= 2 &&
      rawMessages[i - 1]?.role === "user" &&
      Array.isArray(rawMessages[i - 1]?.content) &&
      (rawMessages[i - 1]?.content as any[]).every(
        (block: any) => block.type === "tool_result",
      )
    ) {
      prevDisplay.segments = [
        ...prevDisplay.segments,
        ...(displayMsg.segments ?? []),
      ];
      const prevText =
        typeof prevDisplay.content === "string" ? prevDisplay.content : "";
      const newText =
        typeof displayMsg.content === "string" ? displayMsg.content : "";
      prevDisplay.content = prevText + newText;

      if (displayMsg.tokenUsage) {
        prevDisplay.tokenUsage = displayMsg.tokenUsage;
      }
      continue;
    }

    display.push(displayMsg);
  }

  return display;
}

export function ChatView() {
  const { settings, loading: loadingSettings, setSettings } = useUserSettings();

  const API = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const {
    streamSegments,
    isStreaming,
    streamChat,
    abort,
    pendingConfirmations,
    setPendingConfirmations,
    backoff,
    maxIterations,
    setMaxIterations,
  } = useChatStream(API);
  const now = useClock();
  const suggestion = useSuggestion();

  const [input, setInput] = useState("");
  const [model, setModel] = useState("claude-haiku-4-5");
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [messages, setMessages] = useState<IChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<IConversationMeta[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [active, setActive] = useState(false);
  const [title, setTitle] = useState("");
  const [attachments, setAttachments] = useState<IChatAttachment[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(settings.chatSidebarOpen);
  const attachmentsRef = useRef<IChatAttachment[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const lastScrollTop = useRef(0);

  const isActive = active || messages.length > 0;

  const toggleSidebar = useCallback(
    (open: boolean) => {
      setSidebarOpen(open);
      setSettings({ chatSidebarOpen: open });
    },
    [setSettings],
  );

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const query = searchQuery.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(query));
  }, [conversations, searchQuery]);

  const groupedConversations = useMemo(
    () => groupConversationsByDate(filteredConversations),
    [filteredConversations],
  );

  const handleNewChat = useCallback(() => {
    if (isStreaming) abort();
    setActive(false);
    setMessages([]);
    setConversationId(null);
    setTitle("");
    setInput("");
    setAttachments([]);
    setSearchQuery("");
    userScrolledUp.current = false;
    toggleSidebar(false);
  }, [isStreaming, abort, toggleSidebar]);

  const fetchConversations = useCallback(async () => {
    if (!API) return;
    setLoadingConversations(true);
    const result = await API.GET<{ conversations: IConversationMeta[] }>({
      endpoint: "conversations",
    });
    if (!("code" in result)) {
      setConversations(result.conversations);
    }
    setLoadingConversations(false);
  }, [API]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    if (API && (!isActive || sidebarOpen)) fetchConversations();
  }, [API, isActive, sidebarOpen, fetchConversations]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (
        scrollTop < lastScrollTop.current &&
        scrollHeight - scrollTop - clientHeight > 100
      ) {
        userScrolledUp.current = true;
      }
      if (scrollHeight - scrollTop - clientHeight < 20) {
        userScrolledUp.current = false;
      }
      lastScrollTop.current = scrollTop;
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!userScrolledUp.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamSegments]);

  const loadConversation = async (meta: IConversationMeta) => {
    if (!API) return;
    const result = await API.GET<{ conversation: IConversation }>({
      endpoint: `conversations/${meta._id}`,
    });
    if ("code" in result) {
      toast.error("Failed to load conversation");
      return;
    }
    setConversationId(meta._id);
    setMessages(convertApiMessagesToDisplay(result.conversation.messages));
    setModel(result.conversation.llmModel);
    setTitle(result.conversation.title);
    setActive(true);
    userScrolledUp.current = false;
    toggleSidebar(false);
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!API) return;
    const result = await API.DELETE<{ success: boolean }>({
      endpoint: `conversations/${id}`,
    });
    if (!("code" in result)) {
      setConversations((prev) => prev.filter((c) => c._id !== id));
    }
  };

  const handleBack = () => {
    if (isStreaming) abort();
    setActive(false);
    setMessages([]);
    setConversationId(null);
    setTitle("");
    setInput("");
    setAttachments([]);
    userScrolledUp.current = false;
  };

  const uploadSingleAttachment = useCallback(
    async (att: IChatAttachment) => {
      if (!API) return;
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === att.id ? { ...a, status: "uploading" as const } : a,
        ),
      );
      const fd = new FormData();
      fd.append("file", att.file);
      const res = await API.UPLOAD<{ url: string; hash: string }>({
        endpoint: "upload",
        formData: fd,
      });
      if ("code" in res) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === att.id
              ? { ...a, status: "error" as const, error: res.message }
              : a,
          ),
        );
      } else {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === att.id
              ? { ...a, status: "done" as const, uploadedUrl: res.url }
              : a,
          ),
        );
      }
    },
    [API],
  );

  const handleAttachmentsChange = useCallback(
    (newAttachments: IChatAttachment[]) => {
      const prev = attachments;
      setAttachments(newAttachments);
      const added = newAttachments.filter(
        (a) => a.status === "pending" && !prev.some((p) => p.id === a.id),
      );
      for (const att of added) {
        uploadSingleAttachment(att);
      }
    },
    [attachments, uploadSingleAttachment],
  );

  const sendMessage = async (messageContent: string) => {
    if (!API || isStreaming) return;

    let messageAttachments: IChatMessageAttachment[] | undefined;
    let messagePayload: string | unknown[] = messageContent;

    if (attachments.length > 0) {
      const stillInFlight = () =>
        attachmentsRef.current.some(
          (a) => a.status === "uploading" || a.status === "pending",
        );

      if (stillInFlight()) {
        await new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (!stillInFlight()) {
              clearInterval(interval);
              resolve();
            }
          }, 100);
        });
      }

      const currentAttachments = attachmentsRef.current;
      const failed = currentAttachments.filter((a) => a.status === "error");
      if (failed.length > 0) {
        toast.error(`Failed to upload ${failed.length} file(s)`);
        return;
      }

      const contentBlocks: unknown[] = [];
      messageAttachments = [];

      for (const att of currentAttachments) {
        if (att.type === "image") {
          contentBlocks.push({
            type: "image",
            source: { type: "url", url: att.uploadedUrl },
          });
          messageAttachments.push({
            type: "image",
            url: att.uploadedUrl!,
            name: att.name,
          });
        } else {
          contentBlocks.push({
            type: "document",
            source: { type: "url", url: att.uploadedUrl },
          });
          messageAttachments.push({
            type: "pdf",
            url: att.uploadedUrl!,
            name: att.name,
          });
        }
      }

      if (messageContent) {
        contentBlocks.push({ type: "text", text: messageContent });
      }

      messagePayload = contentBlocks;
    }

    const userMessage: IChatMessage = {
      role: "user",
      content: messageContent,
      attachments: messageAttachments,
      createdAt: new Date().toISOString(),
    };

    const currentMessages = [...messages, userMessage];
    setMessages(currentMessages);
    setInput("");
    setAttachments([]);
    setActive(true);
    userScrolledUp.current = false;

    let currentConversationId = conversationId;

    if (!currentConversationId) {
      const msgTitle =
        messageContent.length > 50
          ? `${messageContent.slice(0, 50)}...`
          : messageContent || "Image conversation";
      setTitle(msgTitle);

      const createResult = await API.POST<{
        conversation: IConversation;
      }>({
        endpoint: "conversations",
        body: { title: msgTitle, model },
      });

      if ("code" in createResult) {
        toast.error("Failed to create conversation");
        return;
      }
      currentConversationId = createResult.conversation._id;
      setConversationId(currentConversationId);
    }

    const streamResult = await streamChat({
      conversationId: currentConversationId,
      message: messagePayload,
      model,
      toolsEnabled,
      webSearchEnabled,
    });

    if (isStreamError(streamResult)) {
      const errorMessage: IChatMessage = {
        role: "assistant",
        content: "",
        error: streamResult.error,
        createdAt: new Date().toISOString(),
      };
      setMessages([...currentMessages, errorMessage]);
    } else if (streamResult) {
      const assistantMessage: IChatMessage = {
        role: "assistant",
        content: streamResult.content,
        tokenUsage: streamResult.paused ? undefined : streamResult.usage,
        segments:
          streamResult.segments.length > 0 ? streamResult.segments : undefined,
        pendingActions:
          streamResult.pendingActions.length > 0
            ? streamResult.pendingActions
            : undefined,
        clientToolResults:
          streamResult.paused && streamResult.clientToolResults.length > 0
            ? streamResult.clientToolResults
            : undefined,
        createdAt: new Date().toISOString(),
      };

      setMessages([...currentMessages, assistantMessage]);
    }
  };

  const continueChat = async (toolApprovals: Record<string, boolean>) => {
    if (!API || isStreaming || !conversationId) return;

    userScrolledUp.current = false;

    // Recover any client tool results that were computed during the
    // pause — the server needs them alongside toolApprovals to build a
    // single user turn covering every pending tool_use.
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant");
    const carriedClientToolResults = lastAssistant?.clientToolResults;

    const streamResult = await streamChat({
      conversationId,
      toolApprovals,
      clientToolResults: carriedClientToolResults,
      model,
      toolsEnabled,
      webSearchEnabled,
    });

    if (isStreamError(streamResult)) {
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        const lastMsg = updated[lastIdx];
        if (lastMsg?.role === "assistant") {
          updated[lastIdx] = { ...lastMsg, error: streamResult.error };
        } else {
          updated.push({
            role: "assistant",
            content: "",
            error: streamResult.error,
            createdAt: new Date().toISOString(),
          });
        }
        return updated;
      });
    } else if (streamResult) {
      setMessages((prev) => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        const lastMsg = updated[lastIdx];

        if (lastMsg?.role === "assistant") {
          const existingSegments = lastMsg.segments ?? [];
          const newSegments = streamResult.segments;
          const mergedSegments = [...existingSegments, ...newSegments];

          const prevText =
            typeof lastMsg.content === "string" ? lastMsg.content : "";

          updated[lastIdx] = {
            ...lastMsg,
            content: prevText + streamResult.content,
            segments: mergedSegments.length > 0 ? mergedSegments : undefined,
            tokenUsage: streamResult.paused
              ? lastMsg.tokenUsage
              : streamResult.usage,
            pendingActions:
              streamResult.pendingActions.length > 0
                ? streamResult.pendingActions
                : undefined,
            clientToolResults:
              streamResult.paused && streamResult.clientToolResults.length > 0
                ? streamResult.clientToolResults
                : undefined,
          };
        } else {
          updated.push({
            role: "assistant",
            content: streamResult.content,
            tokenUsage: streamResult.paused ? undefined : streamResult.usage,
            segments:
              streamResult.segments.length > 0
                ? streamResult.segments
                : undefined,
            pendingActions:
              streamResult.pendingActions.length > 0
                ? streamResult.pendingActions
                : undefined,
            clientToolResults:
              streamResult.paused && streamResult.clientToolResults.length > 0
                ? streamResult.clientToolResults
                : undefined,
            createdAt: new Date().toISOString(),
          });
        }

        return updated;
      });
    }
  };

  const handleSend = async () => {
    if (!input.trim() && attachments.length === 0) return;
    await sendMessage(input.trim());
  };

  const retryFromError = async () => {
    setMessages((prev) => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      if (updated[lastIdx]?.role === "assistant" && updated[lastIdx]?.error) {
        updated.splice(lastIdx, 1);
      }
      return updated;
    });

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg || !conversationId) return;

    const messageContent = lastUserMsg.content;

    userScrolledUp.current = false;

    const streamResult = await streamChat({
      conversationId,
      message: messageContent as string | unknown[],
      model,
      toolsEnabled,
      webSearchEnabled,
    });

    if (isStreamError(streamResult)) {
      const errorMessage: IChatMessage = {
        role: "assistant",
        content: "",
        error: streamResult.error,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } else if (streamResult) {
      const assistantMessage: IChatMessage = {
        role: "assistant",
        content: streamResult.content,
        tokenUsage: streamResult.paused ? undefined : streamResult.usage,
        segments:
          streamResult.segments.length > 0 ? streamResult.segments : undefined,
        pendingActions:
          streamResult.pendingActions.length > 0
            ? streamResult.pendingActions
            : undefined,
        clientToolResults:
          streamResult.paused && streamResult.clientToolResults.length > 0
            ? streamResult.clientToolResults
            : undefined,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    }
  };

  const getAllPendingActions = (): IChatPendingAction[] => {
    if (pendingConfirmations.length > 0) {
      return pendingConfirmations.filter((a) => a.status === "pending");
    }
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.pendingActions) {
      return lastMsg.pendingActions.filter((a) => a.status === "pending");
    }
    return [];
  };

  const markToolCallsInSegments = (
    segments: IChatContentSegment[],
    ids: Set<string>,
    status: "done" | "error",
  ): IChatContentSegment[] =>
    segments.map((seg) => {
      if (seg.type !== "tool_group") return seg;
      return {
        ...seg,
        calls: seg.calls.map((c) =>
          ids.has(c.toolId) ? { ...c, status: status } : c,
        ),
      };
    });

  const handleApproveAll = async () => {
    const pending = getAllPendingActions();
    if (pending.length === 0) return;

    const ids = new Set(pending.map((a) => a.toolId));

    setMessages((prev) =>
      prev.map((msg) => {
        let updated = msg;
        if (msg.pendingActions) {
          updated = {
            ...updated,
            pendingActions: msg.pendingActions.map((a) =>
              a.status === "pending"
                ? { ...a, status: "approved" as const }
                : a,
            ),
          };
        }
        if (msg.segments) {
          updated = {
            ...updated,
            segments: markToolCallsInSegments(msg.segments, ids, "done"),
          };
        }
        return updated;
      }),
    );

    setPendingConfirmations([]);

    const approvals: Record<string, boolean> = {};
    for (const a of pending) {
      approvals[a.toolId] = true;
    }

    await continueChat(approvals);
  };

  const handleDenyAll = async () => {
    const pending = getAllPendingActions();
    if (pending.length === 0) return;

    const ids = new Set(pending.map((a) => a.toolId));

    setMessages((prev) =>
      prev.map((msg) => {
        let updated = msg;
        if (msg.pendingActions) {
          updated = {
            ...updated,
            pendingActions: msg.pendingActions.map((a) =>
              a.status === "pending" ? { ...a, status: "denied" as const } : a,
            ),
          };
        }
        if (msg.segments) {
          updated = {
            ...updated,
            segments: markToolCallsInSegments(msg.segments, ids, "error"),
          };
        }
        return updated;
      }),
    );

    setPendingConfirmations([]);

    const denials: Record<string, boolean> = {};
    for (const a of pending) {
      denials[a.toolId] = false;
    }

    await continueChat(denials);
  };

  if (!isActive) {
    return (
      <>
        <Sheet open={sidebarOpen} onOpenChange={toggleSidebar}>
          <SheetContent side="left" className="w-80 p-0 flex flex-col">
            <SheetHeader className="px-4 py-3 border-b">
              <SheetTitle className="text-sm font-medium">
                Conversations
              </SheetTitle>
              <div className="relative mt-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
                <Input
                  placeholder="Search conversations..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 text-sm"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-foreground" />
                  </button>
                )}
              </div>
            </SheetHeader>
            <ScrollArea className="flex-1 overflow-hidden">
              <div className="p-2 pt-0! overflow-hidden">
                <div
                  onClick={handleNewChat}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface transition-colors cursor-pointer mb-2"
                >
                  <Plus className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  <span className="text-sm text-foreground/70">New chat</span>
                </div>
                {loadingConversations ? (
                  <div className="flex flex-col gap-0.5">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 px-3 py-2"
                      >
                        <Skeleton className="w-3.5 h-3.5 rounded shrink-0 bg-surface" />
                        <Skeleton
                          className="h-4 flex-1 rounded bg-surface"
                          style={{ maxWidth: `${55 + ((i * 23) % 35)}%` }}
                        />
                      </div>
                    ))}
                  </div>
                ) : groupedConversations.length === 0 ? (
                  <p className="text-xs text-muted-foreground/50 px-3 py-4 text-center">
                    {searchQuery
                      ? "No conversations found"
                      : "No conversations yet"}
                  </p>
                ) : (
                  <div className="flex flex-col gap-4">
                    {groupedConversations.map((group) => (
                      <div key={group.label}>
                        <p className="text-[11px] text-muted-foreground/50 px-3 py-1 uppercase tracking-wider">
                          {group.label}
                        </p>
                        <div className="flex flex-col gap-0.5">
                          {group.conversations.map((conv) => (
                            <div
                              key={conv._id}
                              onClick={() => loadConversation(conv)}
                              className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface transition-colors cursor-pointer"
                            >
                              <MessageSquare className="w-3.5 h-3.5 text-muted-foreground/40" />
                              <span className="text-sm text-foreground/70 truncate">
                                {conv.title}
                              </span>
                              <span className="text-[10px] text-muted-foreground/30 group-hover:hidden">
                                {MODEL_LABELS[conv.llmModel] ?? conv.llmModel}
                              </span>
                              <button
                                onClick={(e) => deleteConversation(conv._id, e)}
                                className="hidden group-hover:flex col-start-3 items-center justify-center w-5 h-5 rounded hover:bg-destructive/10 transition-colors"
                              >
                                <Trash2 className="w-3 h-3 text-muted-foreground/50 hover:text-destructive" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>

        <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-4 py-8 relative">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleSidebar(true)}
            className="absolute top-4 left-4"
          >
            <Menu className="w-4 h-4" />
          </Button>
          <SidebarTrigger className="absolute left-14 top-4 size-9 md:hidden" />
          <div className="flex flex-col items-center gap-6 w-full max-w-2xl">
            <div className="flex flex-col items-center gap-1">
              <p className="text-3xl font-light text-foreground/80 tabular-nums tracking-tight">
                {now.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
              <p className="text-xs text-muted-foreground/50">
                {now.toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
            <p
              className={`text-sm text-muted-foreground/40 italic h-5 transition-opacity duration-300 ${suggestion.visible ? "opacity-100" : "opacity-0"}`}
            >
              {suggestion.text}
            </p>
            <ChatInput
              value={input}
              onChange={setInput}
              onSend={handleSend}
              model={model}
              onModelChange={setModel}
              disabled={isStreaming}
              streaming={isStreaming}
              onAbort={abort}
              toolsEnabled={toolsEnabled}
              onToolsEnabledChange={setToolsEnabled}
              webSearchEnabled={webSearchEnabled}
              onWebSearchEnabledChange={setWebSearchEnabled}
              attachments={attachments}
              onAttachmentsChange={handleAttachmentsChange}
            />
            <div className="w-full max-w-3xl mt-4">
              <DashboardSummary />
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Sheet open={sidebarOpen} onOpenChange={toggleSidebar}>
        <SheetContent side="left" className="w-80 p-0 flex flex-col">
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="text-sm font-medium">
              Conversations
            </SheetTitle>
            <div className="relative mt-2">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
              <Input
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-foreground" />
                </button>
              )}
            </div>
          </SheetHeader>
          <ScrollArea className="flex-1 overflow-hidden">
            <div className="p-2 overflow-hidden">
              <div
                onClick={handleNewChat}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface transition-colors cursor-pointer mb-2"
              >
                <Plus className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                <span className="text-sm text-foreground/70">New chat</span>
              </div>
              {loadingConversations ? (
                <div className="flex flex-col gap-0.5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2">
                      <Skeleton className="w-3.5 h-3.5 rounded shrink-0 bg-surface" />
                      <Skeleton
                        className="h-4 flex-1 rounded bg-surface"
                        style={{ maxWidth: `${55 + ((i * 23) % 35)}%` }}
                      />
                    </div>
                  ))}
                </div>
              ) : groupedConversations.length === 0 ? (
                <p className="text-xs text-muted-foreground/50 px-3 py-4 text-center">
                  {searchQuery
                    ? "No conversations found"
                    : "No conversations yet"}
                </p>
              ) : (
                <div className="flex flex-col gap-4">
                  {groupedConversations.map((group) => (
                    <div key={group.label}>
                      <p className="text-[11px] text-muted-foreground/50 px-3 py-1 uppercase tracking-wider">
                        {group.label}
                      </p>
                      <div className="flex flex-col gap-0.5">
                        {group.conversations.map((conv) => (
                          <div
                            key={conv._id}
                            onClick={() => loadConversation(conv)}
                            className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface transition-colors cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5 text-muted-foreground/40" />
                            <span className="text-sm text-foreground/70 truncate">
                              {conv.title}
                            </span>
                            <span className="text-[10px] text-muted-foreground/30 group-hover:hidden">
                              {MODEL_LABELS[conv.llmModel] ?? conv.llmModel}
                            </span>
                            <button
                              onClick={(e) => deleteConversation(conv._id, e)}
                              className="hidden group-hover:flex col-start-3 items-center justify-center w-5 h-5 rounded hover:bg-destructive/10 transition-colors"
                            >
                              <Trash2 className="w-3 h-3 text-muted-foreground/50 hover:text-destructive" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 border-b">
          <SidebarTrigger className="-ml-1 size-7 shrink-0 md:hidden" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => toggleSidebar(true)}
            className="shrink-0"
          >
            <Menu className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            className="shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-foreground/70 truncate">{title}</span>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto px-4 py-6"
        >
          <div className="max-w-3xl mx-auto">
            {messages.map((msg, i) => {
              const isLastAssistant =
                isStreaming &&
                i === messages.length - 1 &&
                msg.role === "assistant";

              return (
                <ChatMessage
                  key={`${i}-${msg.createdAt}`}
                  message={msg}
                  isStreaming={isLastAssistant}
                  streamSegments={isLastAssistant ? streamSegments : undefined}
                  onApproveAll={handleApproveAll}
                  onDenyAll={handleDenyAll}
                  onRetry={msg.error ? retryFromError : undefined}
                />
              );
            })}
            {isStreaming &&
              (messages.length === 0 ||
                messages[messages.length - 1].role === "user") && (
                <ChatMessage
                  message={{
                    role: "assistant",
                    content: "",
                    pendingActions:
                      pendingConfirmations.length > 0
                        ? pendingConfirmations
                        : undefined,
                    createdAt: new Date().toISOString(),
                  }}
                  isStreaming
                  streamSegments={streamSegments}
                  onApproveAll={handleApproveAll}
                  onDenyAll={handleDenyAll}
                />
              )}
          </div>
        </div>

        {backoff.active && (
          <div className="mx-4 mb-2 flex items-center gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-700">
            <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span>
              Rate limited — retrying in{" "}
              <span className="font-mono font-medium tabular-nums">
                {Math.ceil(backoff.retryAfterMs / 1000)}s
              </span>
              <span className="text-amber-600/60 ml-1">
                (attempt {backoff.attempt}/{backoff.maxAttempts})
              </span>
            </span>
          </div>
        )}

        {maxIterations.active && (
          <div className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-md border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-xs text-orange-700">
            <span>
              Reached max tool iterations ({maxIterations.iterations}).
              {maxIterations.hasUnansweredTools
                ? " Some tool calls were not completed."
                : ""}
            </span>
            <button
              onClick={() =>
                setMaxIterations({
                  active: false,
                  iterations: 0,
                  hasUnansweredTools: false,
                })
              }
              className="text-orange-600/60 hover:text-orange-700"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        <ChatInput
          value={input}
          onChange={setInput}
          onSend={handleSend}
          model={model}
          onModelChange={setModel}
          disabled={isStreaming}
          streaming={isStreaming}
          onAbort={abort}
          docked
          modelLabel={MODEL_LABELS[model] ?? model}
          toolsEnabled={toolsEnabled}
          onToolsEnabledChange={setToolsEnabled}
          webSearchEnabled={webSearchEnabled}
          onWebSearchEnabledChange={setWebSearchEnabled}
          attachments={attachments}
          onAttachmentsChange={handleAttachmentsChange}
        />
      </div>
    </>
  );
}
