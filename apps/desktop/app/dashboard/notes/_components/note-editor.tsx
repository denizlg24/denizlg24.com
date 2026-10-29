"use client";
import { pdf } from "@react-pdf/renderer";
import { useAdminSpeech } from "@repo/admin/tts/use-admin-speech";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { FormDialog, FormField } from "@repo/ui/form-dialog";
import { useTextareaEditor } from "@repo/ui/hooks/use-textarea-editor";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { ModelSelector } from "@repo/ui/model-selector";
import { Textarea } from "@repo/ui/textarea";
import { FilterTabs, ToolbarSpacer } from "@repo/ui/toolbar";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  Download,
  FileText,
  FolderTree,
  Loader2,
  Save,
  Sparkles,
  Square,
  Undo2,
  Volume2,
} from "lucide-react";
import type React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { MarkdownPdfDocument } from "@/components/markdown/markdown-pdf-renderer";
import { useUserSettings } from "@/context/user-context";
import { pickDefaultModel, useModelCatalog } from "@/hooks/use-model-catalog";
import { createDesktopAdminClient } from "@/lib/admin-client";
import type { denizApi } from "@/lib/api-wrapper";
import type { INote } from "@/lib/data-types";
import { isTauri } from "@/lib/platform";
import { saveFile } from "@/lib/platform-fs";
import { extractDirectory } from "@/lib/user-settings";
import { FindReplaceBar, type MatchResult } from "./find-replace-bar";

export const NoteEditor = ({
  note,
  API,
  onUpdated,
  onContentChange,
  onSaveContent,
  saveLabel = "Save",
  saveDisabled,
  disableAiEnhance = false,
  onCategorize,
  startInEditMode = false,
  autoFocusEditor = false,
}: {
  note: INote;
  API: denizApi | null;
  onUpdated?: (note: INote) => void;
  onContentChange?: (content: string) => void;
  onSaveContent?: (content: string) => Promise<void>;
  saveLabel?: string;
  saveDisabled?: boolean;
  disableAiEnhance?: boolean;
  onCategorize?: () => Promise<void>;
  startInEditMode?: boolean;
  autoFocusEditor?: boolean;
}) => {
  const { settings, setSettings } = useUserSettings();
  const speechClient = useMemo(() => createDesktopAdminClient(), []);
  const speech = useAdminSpeech(speechClient, { narrate: true });
  useEffect(() => speech.stop(), [note._id, speech.stop]);

  const [togglePreview, setTogglePreview] = useState(!startInEditMode);
  const [initialContent, setInitialContent] = useState(note.content || "");
  const [content, setContent] = useState(initialContent);
  const [loading, setLoading] = useState(false);

  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [enhanceOpen, setEnhanceOpen] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [additionalInfo, setAdditionalInfo] = useState("");
  // Picked from the live catalog once it loads; no hardcoded default model.
  const [model, setModel] = useState<string | null>(null);
  const modelCatalog = useModelCatalog(API);

  useEffect(() => {
    if (model || !modelCatalog.models?.length) return;
    const defaultModel = pickDefaultModel(modelCatalog.models, []);
    if (defaultModel) setModel(defaultModel);
  }, [model, modelCatalog.models]);

  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplaceShowReplace, setFindReplaceShowReplace] = useState(false);
  const [findInitialQuery, setFindInitialQuery] = useState("");
  const [findMatches, setFindMatches] = useState<MatchResult[]>([]);
  const [findCurrentIndex, setFindCurrentIndex] = useState(0);

  const contentTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const {
    onKeyDown: editorOnKeyDown,
    multiSelections,
    clearMultiSelections,
  } = useTextareaEditor(contentTextareaRef, content, setContent);

  useEffect(() => {
    setInitialContent(note.content || "");
    setContent(note.content || "");
  }, [note.content]);

  useEffect(() => {
    setTogglePreview(!startInEditMode);
  }, [startInEditMode]);

  const setEditorContent = useCallback(
    (nextContent: string) => {
      setContent(nextContent);
      onContentChange?.(nextContent);
    },
    [onContentChange],
  );

  const openFind = useCallback((withReplace: boolean) => {
    const textarea = contentTextareaRef.current;
    let initial = "";
    if (textarea) {
      const sel = textarea.value.slice(
        textarea.selectionStart,
        textarea.selectionEnd,
      );
      if (sel && !sel.includes("\n")) initial = sel;
    }
    setFindInitialQuery(initial);
    setFindReplaceShowReplace(withReplace);
    setFindReplaceOpen(true);
  }, []);

  const handleMatchesChange = useCallback(
    (matches: MatchResult[], currentIndex: number) => {
      setFindMatches(matches);
      setFindCurrentIndex(currentIndex);
    },
    [],
  );

  const showOverlay =
    (findReplaceOpen && findMatches.length > 0) || multiSelections.length > 0;

  useLayoutEffect(() => {
    if (showOverlay && overlayRef.current && contentTextareaRef.current) {
      overlayRef.current.scrollTop = contentTextareaRef.current.scrollTop;
    }
  }, [showOverlay]);

  useEffect(() => {
    if (!showOverlay || multiSelections.length === 0) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.classList.remove("cursors-hidden");
    const interval = setInterval(() => {
      overlay.classList.toggle("cursors-hidden");
    }, 530);
    return () => {
      clearInterval(interval);
      overlay.classList.remove("cursors-hidden");
    };
  }, [showOverlay, multiSelections]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "f" || e.key === "h") &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey
      ) {
        e.preventDefault();
        openFind(e.key === "h");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openFind]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        (e.key === "f" || e.key === "h") &&
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey
      ) {
        e.preventDefault();
        openFind(e.key === "h");
        return;
      }
      editorOnKeyDown(e);
    },
    [editorOnKeyDown, openFind],
  );

  const handleSave = async () => {
    if (onSaveContent) {
      try {
        setLoading(true);
        await onSaveContent(content);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!API) return;
    try {
      setLoading(true);
      const result = await API.PUT<{ note: INote }>({
        endpoint: `notes/${note._id}`,
        body: { content },
      });
      if ("code" in result) {
        return;
      }
      setInitialContent(result.note.content || "");
      setContent(result.note.content || "");
      onUpdated?.(result.note);
    } catch (error) {
      console.error("Error saving note content:", error);
    } finally {
      setLoading(false);
      setTogglePreview(true);
    }
  };

  const handleCategorize = async () => {
    if (!onCategorize) return;
    try {
      setCategorizing(true);
      await onCategorize();
    } finally {
      setCategorizing(false);
    }
  };

  const handleExportPdf = async () => {
    setPdfDialogOpen(false);

    let savePath: string | null = null;
    if (isTauri()) {
      savePath = await save({
        filters: [{ name: "PDF Files", extensions: ["pdf"] }],
        defaultPath: `${settings.defaultNoteDownloadPath}${note.title || "note"}.pdf`,
      });
      if (!savePath) return;

      const dir = extractDirectory(savePath);
      if (dir.trim()) {
        setSettings({ defaultNoteDownloadPath: dir });
      }
    }

    setExportingPdf(true);
    const toastId = toast.loading("Generating PDF...");

    try {
      const blob = await pdf(
        <MarkdownPdfDocument
          content={content}
          title={note.title}
          showHeader={showHeader}
        />,
      ).toBlob();

      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (savePath) {
        await writeFile(savePath, bytes);
      } else {
        await saveFile(`${note.title || "note"}.pdf`, bytes, {
          mimeType: "application/pdf",
        });
      }

      toast.success("PDF exported!", { id: toastId });
    } catch (error) {
      console.error("PDF export error:", error);
      toast.error("Failed to export PDF", { id: toastId });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleDownloadMarkdown = async () => {
    if (!isTauri()) {
      await saveFile(`${note.title || "note"}.md`, content, {
        mimeType: "text/markdown",
      });
      return;
    }
    const path = await save({
      filters: [{ name: "Note Files", extensions: ["md", "txt"] }],
      defaultPath: `${settings.defaultNoteDownloadPath}${note.title || "note"}.md`,
    });
    if (!path) return;
    const directory = extractDirectory(path);
    if (directory.trim()) {
      setSettings({ defaultNoteDownloadPath: directory });
    }
    try {
      await writeTextFile(path, content);
    } catch (error) {
      console.error("Error saving file:", error);
      toast.error("Failed to save file");
    }
  };

  const handleAIEnhance = async () => {
    if (!API || !model) return;
    try {
      setEnhancing(true);
      setEnhanceOpen(false);
      setTogglePreview(true);

      const result = await API.POST_STREAM({
        endpoint: `notes/${note._id}/enhance`,
        body: {
          ...(additionalInfo ? { additionalInfo } : {}),
          model,
          content,
        },
      });

      if ("code" in result) {
        setEnhancing(false);
        return;
      }

      const reader = result.body?.getReader();
      if (!reader) {
        setEnhancing(false);
        return;
      }

      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6);
          try {
            const event = JSON.parse(json);
            if (event.type === "delta") {
              accumulated += event.text;
              setEditorContent(accumulated);
            } else if (event.type === "done") {
              const { inputTokens, outputTokens, costUsd } = event.usage;
              toast.success(
                `Enhanced — ${inputTokens + outputTokens} tokens ($${costUsd.toFixed(4)})`,
              );
            } else if (event.type === "error") {
              toast.error(event.error ?? "Stream error");
            }
          } catch {}
        }
      }
    } catch (error) {
      console.error("Error enhancing note:", error);
    } finally {
      setEnhancing(false);
    }
  };

  const contentDirty = content !== initialContent;

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b bg-background py-1.5">
        <FilterTabs
          value={togglePreview ? "preview" : "edit"}
          onChange={(value) => setTogglePreview(value === "preview")}
          options={[
            { value: "preview", label: "Preview" },
            { value: "edit", label: "Edit" },
          ]}
        />
        <ToolbarSpacer />
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!content.trim()}
          onClick={() => {
            if (speech.state !== "idle") {
              speech.stop();
            } else {
              void speech
                .play(`${note.title}. ${content}`)
                .catch((error: unknown) => {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Could not read this note",
                  );
                });
            }
          }}
          aria-label={speech.state === "idle" ? "Read aloud" : "Stop reading"}
          title={speech.state === "idle" ? "Read aloud" : "Stop reading"}
        >
          {speech.state === "loading" ? (
            <Loader2 className="animate-spin" />
          ) : speech.state === "idle" ? (
            <Volume2 />
          ) : (
            <Square />
          )}
        </Button>
        {!disableAiEnhance && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setEnhanceOpen(true)}
            disabled={enhancing}
            aria-label="Enhance"
            title="Enhance"
          >
            {enhancing ? <Loader2 className="animate-spin" /> : <Sparkles />}
          </Button>
        )}
        {onCategorize && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleCategorize}
            disabled={categorizing || loading || contentDirty}
            aria-label="Categorize"
            title="Categorize"
          >
            {categorizing ? (
              <Loader2 className="animate-spin" />
            ) : (
              <FolderTree />
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={contentDirty || loading}
          aria-label="Download markdown"
          title="Download markdown"
          onClick={handleDownloadMarkdown}
        >
          <Download />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={contentDirty || loading || exportingPdf}
          aria-label="Export PDF"
          title="Export PDF"
          onClick={() => setPdfDialogOpen(true)}
        >
          {exportingPdf ? <Loader2 className="animate-spin" /> : <FileText />}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditorContent(initialContent)}
          disabled={!contentDirty || loading}
        >
          <Undo2 />
          Discard
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={(saveDisabled ?? !contentDirty) || loading}
        >
          {loading ? <Loader2 className="animate-spin" /> : <Save />}
          {saveLabel}
        </Button>
      </div>

      {!disableAiEnhance && (
        <FormDialog
          open={enhanceOpen}
          onOpenChange={setEnhanceOpen}
          title="Enhance note"
          onSubmit={handleAIEnhance}
          submitLabel="Enhance"
          submitDisabled={!model}
          pending={enhancing}
        >
          <FormField label="Model">
            <ModelSelector
              model={model}
              onModelChange={setModel}
              models={modelCatalog.models}
              loading={modelCatalog.loading}
              error={modelCatalog.error}
              stale={modelCatalog.stale}
              onRetry={modelCatalog.retry}
            />
          </FormField>
          <FormField label="Instructions" htmlFor="enhance-info">
            <Textarea
              id="enhance-info"
              value={additionalInfo}
              onChange={(e) => setAdditionalInfo(e.target.value)}
              className="min-h-40 resize-y font-mono text-sm"
            />
          </FormField>
        </FormDialog>
      )}

      <FormDialog
        open={pdfDialogOpen}
        onOpenChange={setPdfDialogOpen}
        title="Export PDF"
        onSubmit={handleExportPdf}
        submitLabel="Export"
      >
        <label
          htmlFor="pdf-show-header"
          className="flex cursor-pointer items-center gap-2 text-sm"
        >
          <Checkbox
            id="pdf-show-header"
            checked={showHeader}
            onCheckedChange={(checked) => setShowHeader(checked === true)}
          />
          Header with logo, title and date
        </label>
      </FormDialog>

      {!togglePreview && (
        <div className="relative flex h-[70vh] min-h-80 flex-col">
          {showOverlay && (
            <div
              ref={overlayRef}
              className="absolute inset-0 overflow-y-auto pointer-events-none z-0 editor-overlay"
              aria-hidden="true"
            >
              <div className="font-mono text-sm px-0 pt-3 pb-10 whitespace-pre-wrap wrap-break-word text-transparent">
                {(() => {
                  const regions: Array<{
                    start: number;
                    end: number;
                    type: "find" | "findCurrent" | "multiSelect";
                  }> = [];

                  if (findReplaceOpen && findMatches.length > 0) {
                    findMatches.forEach((m, i) => {
                      regions.push({
                        start: m.start,
                        end: m.end,
                        type: i === findCurrentIndex ? "findCurrent" : "find",
                      });
                    });
                  } else {
                    multiSelections.forEach((s) => {
                      regions.push({
                        start: s.start,
                        end: s.end,
                        type: "multiSelect",
                      });
                    });
                  }

                  const sorted = [...regions].sort((a, b) => a.start - b.start);
                  const parts: React.ReactNode[] = [];
                  let lastEnd = 0;

                  sorted.forEach((region, i) => {
                    if (region.start > lastEnd) {
                      parts.push(
                        <span key={`t-${i}`}>
                          {content.slice(lastEnd, region.start)}
                        </span>,
                      );
                    }

                    if (region.type === "multiSelect") {
                      if (region.start === region.end) {
                        parts.push(
                          <span key={`c-${i}`} className="editor-cursor" />,
                        );
                      } else {
                        parts.push(
                          <mark
                            key={`m-${i}`}
                            className="bg-status-info/30 text-transparent rounded-sm"
                          >
                            {content.slice(region.start, region.end)}
                          </mark>,
                        );
                        parts.push(
                          <span key={`c-${i}`} className="editor-cursor" />,
                        );
                      }
                    } else {
                      const bgClass =
                        region.type === "findCurrent"
                          ? "bg-status-serious/45"
                          : "bg-status-warning/30";

                      parts.push(
                        <mark
                          key={`m-${i}`}
                          className={`${bgClass} text-transparent rounded-sm`}
                          data-find-current={
                            region.type === "findCurrent" ? "" : undefined
                          }
                        >
                          {content.slice(region.start, region.end) || "\u200B"}
                        </mark>,
                      );
                    }

                    lastEnd = Math.max(lastEnd, region.end);
                  });

                  if (lastEnd < content.length) {
                    parts.push(
                      <span key={`t-last`}>{content.slice(lastEnd)}</span>,
                    );
                  }
                  parts.push("\n");
                  return parts;
                })()}
              </div>
            </div>
          )}
          <Textarea
            ref={contentTextareaRef}
            autoFocus={autoFocusEditor && !togglePreview}
            value={content}
            onChange={(e) => setEditorContent(e.target.value)}
            onKeyDown={onKeyDown}
            onMouseDown={clearMultiSelections}
            onScroll={(e) => {
              if (overlayRef.current) {
                overlayRef.current.scrollTop = e.currentTarget.scrollTop;
              }
            }}
            id="content"
            className={`font-mono text-sm flex-1 min-h-0 overflow-y-auto rounded-none border-none! outline-none! ring-0! shadow-none! resize-none! relative z-1 px-0 pt-3 pb-10 selection:bg-status-info/30 selection:text-foreground ${showOverlay ? "bg-transparent! selection:bg-transparent!" : ""}`}
          />
        </div>
      )}
      {togglePreview && (
        <div className="w-full py-4">
          {content.trim() ? (
            <MarkdownRenderer content={content} />
          ) : (
            <span className="text-sm text-muted-foreground">Empty</span>
          )}
        </div>
      )}

      {findReplaceOpen && (
        <FindReplaceBar
          textareaRef={contentTextareaRef}
          content={content}
          setContent={setContent}
          showReplace={findReplaceShowReplace}
          onClose={() => {
            setFindReplaceOpen(false);
            setFindMatches([]);
            setFindCurrentIndex(0);
          }}
          initialQuery={findInitialQuery}
          onMatchesChange={handleMatchesChange}
        />
      )}
    </div>
  );
};
