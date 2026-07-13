"use client";

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
import { Label } from "@repo/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Spinner } from "@repo/ui/spinner";
import { Switch } from "@repo/ui/switch";
import {
  ArrowUp,
  FileText,
  Image,
  Paperclip,
  Settings,
  Square,
  X,
} from "lucide-react";
import type * as React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ModelSelector } from "@/components/ui/model-selector";
import type { ModelCatalogState } from "@/hooks/use-model-catalog";
import type { IChatAttachment } from "@/lib/data-types";

const ACCEPTED_TYPES =
  "image/jpeg,image/png,image/gif,image/webp,application/pdf";
const MAX_FILE_SIZE = 20 * 1024 * 1024;

function fileToAttachment(file: File): IChatAttachment | null {
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  if (!isImage && !isPdf) return null;
  if (file.size > MAX_FILE_SIZE) return null;

  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    type: isImage ? "image" : "pdf",
    previewUrl: isImage ? URL.createObjectURL(file) : undefined,
    status: "pending",
  };
}

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentState(
  status: IChatAttachment["status"],
): React.ComponentProps<typeof Attachment>["state"] {
  switch (status) {
    case "pending":
      return "idle";
    case "uploading":
      return "uploading";
    case "error":
      return "error";
    default:
      return "done";
  }
}

function getAttachmentDescription(att: IChatAttachment): string {
  if (att.status === "uploading") return "Uploading";
  if (att.status === "error") return att.error ?? "Upload failed";
  if (att.status === "done") return "Ready";
  return formatAttachmentSize(att.file.size);
}

export function ChatInput({
  value,
  onChange,
  onSend,
  model,
  onModelChange,
  modelCatalog,
  requiredCapabilities,
  modelIncompatible,
  disabled,
  streaming,
  onAbort,
  docked,
  modelLabel,
  toolsEnabled,
  onToolsEnabledChange,
  webSearchEnabled,
  onWebSearchEnabledChange,
  attachments,
  onAttachmentsChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  model: string | null;
  onModelChange: (model: string) => void;
  modelCatalog: ModelCatalogState;
  requiredCapabilities?: string[];
  modelIncompatible?: boolean;
  disabled?: boolean;
  streaming?: boolean;
  onAbort?: () => void;
  docked?: boolean;
  modelLabel?: string;
  toolsEnabled?: boolean;
  onToolsEnabledChange?: (enabled: boolean) => void;
  webSearchEnabled?: boolean;
  onWebSearchEnabledChange?: (enabled: boolean) => void;
  attachments?: IChatAttachment[];
  onAttachmentsChange?: (attachments: IChatAttachment[]) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [multiLine, setMultiLine] = useState(false);
  const [dragging, setDragging] = useState(false);

  const hasAttachments = (attachments?.length ?? 0) > 0;
  // Sends are blocked while no model is selected or the selected model does
  // not support the enabled features (the selector explains why).
  const canSend =
    (value.trim() || hasAttachments) && !!model && !modelIncompatible;

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      if (!onAttachmentsChange) return;
      const current = attachments ?? [];
      const newAtts: IChatAttachment[] = [];
      for (const file of Array.from(files)) {
        const att = fileToAttachment(file);
        if (att) newAtts.push(att);
      }
      if (newAtts.length > 0) {
        onAttachmentsChange([...current, ...newAtts]);
      }
    },
    [attachments, onAttachmentsChange],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      if (!onAttachmentsChange || !attachments) return;
      const att = attachments.find((a) => a.id === id);
      if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
      onAttachmentsChange(attachments.filter((a) => a.id !== id));
    },
    [attachments, onAttachmentsChange],
  );

  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const styles = getComputedStyle(ta);
    const singleLineHeight =
      parseFloat(styles.lineHeight) +
      parseFloat(styles.paddingTop) +
      parseFloat(styles.paddingBottom);
    const max = docked ? 120 : 200;
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
    ta.style.overflowY = ta.scrollHeight > max ? "auto" : "hidden";
    setMultiLine(ta.scrollHeight > singleLineHeight + 2);
  }, [docked]);

  useLayoutEffect(() => {
    resize();
  }, [resize, value]);

  useEffect(() => {
    if (!docked) textareaRef.current?.focus();
  }, [docked]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && canSend) onSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      addFiles(e.target.files);
      e.target.value = "";
    }
  };

  return (
    <div
      className={
        docked
          ? "w-full max-w-3xl mx-auto px-3 pb-3 sm:px-4 sm:pb-4"
          : "w-full max-w-2xl"
      }
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPTED_TYPES}
        onChange={handleFileChange}
        className="hidden"
      />
      <div
        className={`relative border bg-popover shadow-lg flex flex-col ${hasAttachments || multiLine ? "rounded-lg" : "rounded-full"} ${dragging ? "ring-2 ring-foreground/20" : ""}`}
      >
        {hasAttachments && (
          <AttachmentGroup className="px-3 pt-3 pb-0">
            {attachments?.map((att) => (
              <Attachment
                key={att.id}
                state={getAttachmentState(att.status)}
                size="sm"
                className="max-w-56"
              >
                <AttachmentMedia
                  variant={
                    att.type === "image" && att.previewUrl ? "image" : "icon"
                  }
                >
                  {att.status === "uploading" ? (
                    <Spinner className="size-3.5 text-muted-foreground/60" />
                  ) : att.status === "error" ? (
                    <X />
                  ) : att.type === "image" && att.previewUrl ? (
                    <img src={att.previewUrl} alt={att.name} />
                  ) : att.type === "image" ? (
                    <Image />
                  ) : (
                    <FileText />
                  )}
                </AttachmentMedia>
                <AttachmentContent>
                  <AttachmentTitle>{att.name}</AttachmentTitle>
                  <AttachmentDescription>
                    {getAttachmentDescription(att)}
                  </AttachmentDescription>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    aria-label={`Remove ${att.name}`}
                    onClick={() => removeAttachment(att.id)}
                  >
                    <X />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </AttachmentGroup>
        )}
        <div className="flex items-end">
          <Popover>
            <PopoverTrigger asChild>
              <button className="shrink-0 ml-2 mb-2 flex items-center justify-center w-7 h-7 rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-surface transition-colors">
                <Settings className="w-4 h-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64">
              <div className="flex flex-col gap-4">
                <ModelSelector
                  model={model}
                  onModelChange={onModelChange}
                  models={modelCatalog.models}
                  loading={modelCatalog.loading}
                  error={modelCatalog.error}
                  stale={modelCatalog.stale}
                  onRetry={modelCatalog.retry}
                  requiredCapabilities={requiredCapabilities}
                />
                {onToolsEnabledChange && (
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="tools-toggle"
                      className="text-sm text-muted-foreground"
                    >
                      Tools
                    </Label>
                    <Switch
                      id="tools-toggle"
                      checked={toolsEnabled ?? true}
                      onCheckedChange={onToolsEnabledChange}
                    />
                  </div>
                )}
                {onWebSearchEnabledChange && (
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="web-search-toggle"
                      className="text-sm text-muted-foreground"
                    >
                      Web search
                    </Label>
                    <Switch
                      id="web-search-toggle"
                      checked={webSearchEnabled ?? false}
                      onCheckedChange={onWebSearchEnabledChange}
                    />
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
          {onAttachmentsChange && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="shrink-0 mb-2 flex items-center justify-center w-7 h-7 rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-surface transition-colors disabled:opacity-30"
            >
              <Paperclip className="w-4 h-4" />
            </button>
          )}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            disabled={disabled}
            placeholder="Ask anything..."
            rows={1}
            className="min-w-0 flex-1 resize-none bg-transparent px-2 py-3 text-sm outline-none placeholder:text-muted-foreground/60 max-h-50 disabled:opacity-50 scrollbar-none sm:px-3"
            style={{ lineHeight: "1.5" }}
          />
          {docked && modelLabel && (
            <span className="hidden text-[11px] text-muted-foreground/50 pr-2 pb-3 whitespace-nowrap select-none sm:inline">
              {modelLabel}
            </span>
          )}
          {streaming ? (
            <button
              type="button"
              onClick={onAbort}
              className="shrink-0 mr-2 mb-2 flex items-center justify-center w-7 h-7 rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
              aria-label="Stop response"
              title="Stop response"
            >
              <Square className="w-3 h-3 fill-current" />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={disabled || !canSend}
              className="shrink-0 mr-2 mb-2 flex items-center justify-center w-7 h-7 rounded-full bg-foreground text-background transition-opacity disabled:opacity-30 hover:opacity-80"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
