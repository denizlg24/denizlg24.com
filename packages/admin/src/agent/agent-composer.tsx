"use client";

import type {
  AgentMemoryMode,
  AgentToolToggles,
  Connector,
  LlmCatalogModel,
} from "@repo/schemas";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorMeta,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@repo/ui/ai-elements/model-selector";
import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuCheckboxItem,
  PromptInputActionMenuContent,
  PromptInputActionMenuLabel,
  PromptInputActionMenuRadioGroup,
  PromptInputActionMenuRadioItem,
  PromptInputActionMenuSeparator,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@repo/ui/ai-elements/prompt-input";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@repo/ui/attachment";
import { Spinner } from "@repo/ui/spinner";
import { StatusDot } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import type { ChatStatus } from "ai";
import {
  Brain,
  ChevronDown,
  FileText,
  Globe,
  Hand,
  Link2,
  Mic,
  Plus,
  SlidersHorizontal,
  Square,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useAdmin } from "../provider";
import { type AgentAttachment, useAgentSession } from "./agent-session";
import { useDictation } from "./use-dictation";
import { isModelEligible } from "./use-model-catalog";

const ACCEPTED_TYPES =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf";
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const TOOL_ITEMS: Array<{
  key: keyof AgentToolToggles;
  label: string;
  icon: typeof Globe;
}> = [
  { key: "webSearch", label: "Search the web", icon: Globe },
  { key: "webFetch", label: "Fetch pages", icon: Link2 },
  { key: "thinkLonger", label: "Think longer", icon: Brain },
];

const MEMORY_MODES: Array<{ mode: AgentMemoryMode; label: string }> = [
  { mode: "enabled", label: "Memory on" },
  { mode: "retrieval-off", label: "Learning only" },
  { mode: "incognito", label: "Incognito" },
];

/** Pill labels drop out below this container width and leave the icon. */
const PILL_LABEL = "hidden @[30rem]/composer:inline";

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatSize(size: number): string {
  if (size < 1_024) return `${size} B`;
  if (size < 1_048_576) return `${Math.round(size / 1_024)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

export function AgentToolsMenu({
  tools,
  onChange,
}: {
  tools: AgentToolToggles;
  onChange: (tools: AgentToolToggles) => void;
}) {
  const activeCount = TOOL_ITEMS.filter((item) => tools[item.key]).length;
  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger active={activeCount > 0} aria-label="Tools">
        <Wrench />
        <span className={PILL_LABEL}>Tools</span>
        {activeCount > 0 ? (
          <span className="tabular-nums">{activeCount}</span>
        ) : null}
        <ChevronDown className="hidden size-3 opacity-60 @[30rem]/composer:block" />
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent>
        {TOOL_ITEMS.map((item) => (
          <PromptInputActionMenuCheckboxItem
            key={item.key}
            checked={tools[item.key]}
            onCheckedChange={(checked) =>
              onChange({ ...tools, [item.key]: checked === true })
            }
          >
            <item.icon />
            {item.label}
          </PromptInputActionMenuCheckboxItem>
        ))}
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}

function AgentCapabilitiesMenu({
  tools,
  onToolsChange,
  connectors,
  disabledConnectors,
  onConnectorsChange,
}: {
  tools: AgentToolToggles;
  onToolsChange: (tools: AgentToolToggles) => void;
  connectors: Connector[];
  disabledConnectors: string[];
  onConnectorsChange: (disabled: string[]) => void;
}) {
  const disabled = new Set(disabledConnectors);
  const optionalTools = TOOL_ITEMS.filter((item) => tools[item.key]).length;
  const connectorCount = connectors.filter(
    (connector) => !disabled.has(connector.slug),
  ).length;
  const customized = optionalTools > 0 || connectorCount !== connectors.length;

  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger
        active={customized}
        aria-label="Tools and connectors"
        title="Tools and connectors"
        variant="ghost"
      >
        <SlidersHorizontal />
        <span className={PILL_LABEL}>Tools</span>
        <ChevronDown className="hidden size-3 opacity-60 @[30rem]/composer:block" />
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent className="w-64 max-w-[calc(100vw-1.5rem)]">
        <PromptInputActionMenuLabel>Tools</PromptInputActionMenuLabel>
        {TOOL_ITEMS.map((item) => (
          <PromptInputActionMenuCheckboxItem
            key={item.key}
            checked={tools[item.key]}
            onCheckedChange={(checked) =>
              onToolsChange({ ...tools, [item.key]: checked === true })
            }
          >
            <item.icon />
            {item.label}
          </PromptInputActionMenuCheckboxItem>
        ))}
        {connectors.length > 0 ? (
          <>
            <PromptInputActionMenuSeparator />
            <PromptInputActionMenuLabel>Connectors</PromptInputActionMenuLabel>
            {connectors.map((connector) => (
              <PromptInputActionMenuCheckboxItem
                key={connector.slug}
                checked={!disabled.has(connector.slug)}
                onCheckedChange={(checked) =>
                  onConnectorsChange(
                    checked === true
                      ? disabledConnectors.filter(
                          (slug) => slug !== connector.slug,
                        )
                      : [...disabledConnectors, connector.slug],
                  )
                }
              >
                <StatusDot
                  tone={
                    connector.status === "ready"
                      ? "good"
                      : connector.status === "error"
                        ? "critical"
                        : "warning"
                  }
                  label={connector.status}
                  className="size-1.5"
                />
                <span className="min-w-0 flex-1 truncate">
                  {connector.name}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {connector.toolCount}
                </span>
              </PromptInputActionMenuCheckboxItem>
            ))}
          </>
        ) : null}
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}

function groupByCreator(models: LlmCatalogModel[]) {
  const groups = new Map<string, LlmCatalogModel[]>();
  for (const model of models) {
    const bucket = groups.get(model.creator);
    if (bucket) bucket.push(model);
    else groups.set(model.creator, [model]);
  }
  return [...groups.entries()];
}

function formatContextWindow(tokens: number | undefined): string | null {
  if (!tokens) return null;
  return tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`
    : `${Math.round(tokens / 1_000)}K`;
}

export function AgentModelPicker({
  model,
  onModelChange,
  models,
  loading,
  error,
  stale,
  onRetry,
  requiredCapabilities,
}: {
  model: string | null;
  onModelChange: (model: string) => void;
  models: LlmCatalogModel[] | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  onRetry: () => void;
  requiredCapabilities: string[];
}) {
  const { platform } = useAdmin();
  const [open, setOpen] = useState(false);
  const Hosted = platform.HostedModelSelector;
  const selected = models?.find((entry) => entry.id === model);
  const incompatible =
    model !== null && !isModelEligible(model, models, requiredCapabilities);

  if (Hosted) {
    return (
      <Hosted
        model={model}
        onModelChange={onModelChange}
        models={models}
        loading={loading}
        error={error}
        stale={stale}
        onRetry={onRetry}
        requiredCapabilities={requiredCapabilities}
        variant="compact"
        className="min-w-0 max-w-36 shrink"
      />
    );
  }

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <PromptInputButton
          aria-label="Model"
          className={cn(
            "max-w-44 min-w-20 shrink",
            incompatible && "text-destructive",
          )}
          disabled={loading && !models}
          variant="ghost"
        >
          <span className="truncate">
            {selected?.name ?? model ?? (loading ? "Loading…" : "Model")}
          </span>
          <ChevronDown className="size-3 opacity-60" />
        </PromptInputButton>
      </ModelSelectorTrigger>
      <ModelSelectorContent title="Model">
        <ModelSelectorInput placeholder="Search models" />
        <ModelSelectorList>
          <ModelSelectorEmpty>
            {error ? (
              <button type="button" className="underline" onClick={onRetry}>
                Retry
              </button>
            ) : (
              "No models"
            )}
          </ModelSelectorEmpty>
          {groupByCreator(models ?? []).map(([creator, entries]) => (
            <ModelSelectorGroup key={creator} heading={creator}>
              {entries.map((entry) => {
                const eligible = requiredCapabilities.every((tag) =>
                  entry.tags.includes(tag),
                );
                return (
                  <ModelSelectorItem
                    key={entry.id}
                    value={`${entry.name} ${entry.id}`}
                    className={cn(!eligible && "opacity-50")}
                    onSelect={() => {
                      onModelChange(entry.id);
                      setOpen(false);
                    }}
                  >
                    <ModelSelectorName>{entry.name}</ModelSelectorName>
                    <ModelSelectorMeta>
                      {formatContextWindow(entry.contextWindow)}
                    </ModelSelectorMeta>
                  </ModelSelectorItem>
                );
              })}
            </ModelSelectorGroup>
          ))}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

function AgentRunMenu({
  memoryMode,
  memoryLocked,
  onMemoryModeChange,
  executionMode,
  onExecutionModeChange,
  allowBackground,
  background,
  onBackgroundChange,
}: {
  memoryMode: AgentMemoryMode;
  memoryLocked: boolean;
  onMemoryModeChange: (mode: AgentMemoryMode) => void;
  executionMode: "interactive" | "yolo";
  onExecutionModeChange: (mode: "interactive" | "yolo") => void;
  allowBackground: boolean;
  background: boolean;
  onBackgroundChange: (value: boolean) => void;
}) {
  return (
    <PromptInputActionMenu>
      <PromptInputActionMenuTrigger
        active={
          executionMode === "yolo" || memoryMode !== "enabled" || background
        }
        aria-label="Run mode"
        title="Run mode"
        variant="ghost"
      >
        {executionMode === "yolo" ? <Zap /> : <Hand />}
        <span className={PILL_LABEL}>
          {executionMode === "yolo" ? "Auto" : "Ask"}
        </span>
        <ChevronDown className="hidden size-3 opacity-60 @[30rem]/composer:block" />
      </PromptInputActionMenuTrigger>
      <PromptInputActionMenuContent className="w-56">
        <PromptInputActionMenuLabel>Approval</PromptInputActionMenuLabel>
        <PromptInputActionMenuRadioGroup
          value={executionMode}
          onValueChange={(value) =>
            onExecutionModeChange(value === "yolo" ? "yolo" : "interactive")
          }
        >
          <PromptInputActionMenuRadioItem value="interactive">
            <Hand />
            Ask before writes
          </PromptInputActionMenuRadioItem>
          <PromptInputActionMenuRadioItem value="yolo">
            <Zap />
            Auto-approve
          </PromptInputActionMenuRadioItem>
        </PromptInputActionMenuRadioGroup>
        <PromptInputActionMenuSeparator />
        <PromptInputActionMenuLabel>Memory</PromptInputActionMenuLabel>
        <PromptInputActionMenuRadioGroup
          value={memoryMode}
          onValueChange={(value) => {
            const option = MEMORY_MODES.find((entry) => entry.mode === value);
            if (option) onMemoryModeChange(option.mode);
          }}
        >
          {MEMORY_MODES.map((option) => {
            const locked =
              memoryLocked &&
              (option.mode === "incognito" || memoryMode === "incognito");
            return (
              <PromptInputActionMenuRadioItem
                key={option.mode}
                value={option.mode}
                disabled={locked && option.mode !== memoryMode}
              >
                {option.label}
              </PromptInputActionMenuRadioItem>
            );
          })}
        </PromptInputActionMenuRadioGroup>
        {allowBackground ? (
          <>
            <PromptInputActionMenuSeparator />
            <PromptInputActionMenuCheckboxItem
              checked={background}
              onCheckedChange={(checked) =>
                onBackgroundChange(checked === true)
              }
            >
              Run in background
            </PromptInputActionMenuCheckboxItem>
          </>
        ) : null}
      </PromptInputActionMenuContent>
    </PromptInputActionMenu>
  );
}

function AttachButton() {
  const { openFileDialog } = usePromptInputAttachments();
  return (
    <PromptInputButton
      aria-label="Add files"
      tooltip="Add files"
      onClick={openFileDialog}
      variant="ghost"
    >
      <Plus />
    </PromptInputButton>
  );
}

function ComposerAttachment({
  attachment,
  onRemove,
}: {
  attachment: AgentAttachment;
  onRemove: () => void;
}) {
  return (
    <Attachment
      size="xs"
      state={
        attachment.status === "uploading" ? "uploading" : attachment.status
      }
      className="max-w-52"
    >
      <AttachmentMedia variant={attachment.previewUrl ? "image" : "icon"}>
        {attachment.previewUrl ? (
          <img src={attachment.previewUrl} alt="" />
        ) : (
          <FileText />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{attachment.name}</AttachmentTitle>
        <AttachmentDescription className="tabular-nums">
          {attachment.status === "error"
            ? (attachment.error ?? "Upload failed")
            : formatSize(attachment.size)}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction
          aria-label={`Remove ${attachment.name}`}
          onClick={onRemove}
        >
          <X />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}

export function AgentComposer({
  className,
  autoFocus,
}: {
  className?: string;
  autoFocus?: boolean;
}) {
  const session = useAgentSession();
  const {
    chat,
    settings,
    updateSettings,
    draft,
    setDraft,
    attachments,
    catalog,
  } = session;
  const status: ChatStatus = chat.status;
  const streaming = status === "submitted" || status === "streaming";

  const appendTranscript = useCallback(
    (text: string) => {
      setDraft(draft.trim() ? `${draft.trimEnd()} ${text}` : text);
    },
    [draft, setDraft],
  );
  const dictation = useDictation({ onTranscript: appendTranscript });
  const recording = dictation.status === "recording";
  const transcribing = dictation.status === "transcribing";

  const uploading = attachments.some(
    (attachment) => attachment.status === "uploading",
  );
  const readyAttachments = attachments.filter(
    (attachment) => attachment.status === "done",
  );
  const waiting = session.busy && !streaming;
  const canSend =
    (draft.trim().length > 0 || readyAttachments.length > 0) &&
    settings.model !== null &&
    !session.modelIncompatible &&
    !uploading &&
    !waiting &&
    !recording;

  const memoryLocked = chat.messages.length > 0 || streaming;
  const memoryNote = useMemo(() => {
    const parts: string[] = [];
    if (settings.memoryMode === "incognito") parts.push("Incognito");
    if (settings.memoryMode === "retrieval-off") parts.push("Learning only");
    if (settings.background && session.allowBackground) {
      parts.push("Background");
    }
    if (session.modelIncompatible) parts.push("Incompatible model");
    return parts.join(" · ");
  }, [
    session.allowBackground,
    session.modelIncompatible,
    settings.background,
    settings.memoryMode,
  ]);

  return (
    <div className={cn("@container/composer w-full min-w-0", className)}>
      <PromptInput
        accept={ACCEPTED_TYPES}
        multiple
        maxFileSize={MAX_FILE_SIZE}
        onFilesAdded={session.addFiles}
        onSubmit={() => {
          if (canSend) void session.send();
        }}
      >
        {attachments.length > 0 ? (
          <PromptInputHeader className="px-3 pt-3">
            <AttachmentGroup className="gap-1.5">
              {attachments.map((attachment) => (
                <ComposerAttachment
                  key={attachment.id}
                  attachment={attachment}
                  onRemove={() => session.removeAttachment(attachment.id)}
                />
              ))}
            </AttachmentGroup>
          </PromptInputHeader>
        ) : null}
        <PromptInputBody>
          {recording ? (
            <div
              className="flex min-h-11 items-center gap-2 px-4 pt-3 pb-1"
              role="status"
            >
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-destructive" />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatDuration(dictation.elapsedMs)}
              </span>
              <div
                aria-hidden="true"
                className="flex h-4 min-w-0 flex-1 items-center gap-px overflow-hidden"
              >
                {dictation.levels.map((level, index) => (
                  <span
                    key={index}
                    className="w-0.5 shrink-0 rounded-full bg-foreground/40"
                    style={{ height: `${Math.max(10, level * 100)}%` }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <PromptInputTextarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoFocus={autoFocus}
              placeholder={
                transcribing
                  ? "Transcribing…"
                  : waiting
                    ? session.backgroundRun
                      ? "Working in background"
                      : "Waiting on approval"
                    : "Message"
              }
            />
          )}
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <AttachButton />
            <AgentCapabilitiesMenu
              tools={settings.tools}
              onToolsChange={(tools) => updateSettings({ tools })}
              connectors={session.connectors}
              disabledConnectors={settings.disabledConnectors}
              onConnectorsChange={(disabledConnectors) =>
                updateSettings({ disabledConnectors })
              }
            />
            <AgentRunMenu
              memoryMode={settings.memoryMode}
              memoryLocked={memoryLocked}
              onMemoryModeChange={(mode) => void session.setMemoryMode(mode)}
              executionMode={settings.executionMode}
              onExecutionModeChange={(executionMode) =>
                updateSettings({ executionMode })
              }
              allowBackground={session.allowBackground}
              background={settings.background}
              onBackgroundChange={(background) =>
                updateSettings({ background })
              }
            />
          </PromptInputTools>
          <div className="flex shrink-0 items-center gap-1.5">
            <AgentModelPicker
              model={settings.model}
              onModelChange={(model) => updateSettings({ model })}
              models={catalog.models}
              loading={catalog.loading}
              error={catalog.error}
              stale={catalog.stale}
              onRetry={catalog.retry}
              requiredCapabilities={session.requiredCapabilities}
            />
            {recording ? (
              <>
                <PromptInputButton
                  aria-label="Discard dictation"
                  tooltip="Discard"
                  onClick={dictation.cancel}
                >
                  <X />
                </PromptInputButton>
                <PromptInputButton
                  active
                  aria-label="Finish dictation"
                  onClick={dictation.stop}
                >
                  <Square className="size-3 fill-current" />
                  <span className={PILL_LABEL}>Done</span>
                </PromptInputButton>
              </>
            ) : (
              <PromptInputButton
                aria-label="Dictate"
                disabled={transcribing || !dictation.available}
                onClick={dictation.start}
                variant="ghost"
              >
                {transcribing ? <Spinner className="size-3.5" /> : <Mic />}
                <span className={PILL_LABEL}>Voice</span>
              </PromptInputButton>
            )}
            <PromptInputSubmit
              status={status}
              onStop={() => void chat.stop()}
              hasContent={canSend}
            />
          </div>
        </PromptInputFooter>
      </PromptInput>
      {memoryNote ? (
        <p
          className={cn(
            "mt-1.5 text-center text-[11px] text-muted-foreground",
            session.modelIncompatible && "text-destructive",
          )}
          role="status"
        >
          {memoryNote}
        </p>
      ) : null}
    </div>
  );
}
