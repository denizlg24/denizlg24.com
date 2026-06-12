"use client";
import { DialogClose } from "@radix-ui/react-dialog";
import { pdf } from "@react-pdf/renderer";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/dialog";
import { useTextareaEditor } from "@repo/ui/hooks/use-textarea-editor";
import { Label } from "@repo/ui/label";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { Separator } from "@repo/ui/separator";
import { Textarea } from "@repo/ui/textarea";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  ChevronDownCircle,
  ChevronUpCircle,
  ClipboardX,
  Download,
  Edit2,
  Eye,
  FileText,
  FolderTree,
  Loader2,
  Save,
  Sparkles,
} from "lucide-react";
import type React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { MarkdownPdfDocument } from "@/components/markdown/markdown-pdf-renderer";
import { ModelSelector } from "@/components/ui/model-selector";
import { useUserSettings } from "@/context/user-context";
import type { denizApi } from "@/lib/api-wrapper";
import type { INote } from "@/lib/data-types";
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

  const [togglePreview, setTogglePreview] = useState(!startInEditMode);
  const [initialContent, setInitialContent] = useState(note.content || "");
  const [content, setContent] = useState(initialContent);
  const [loading, setLoading] = useState(false);

  const [pdfDialogOpen, setPdfDialogOpen] = useState(false);
  const [showHeader, setShowHeader] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);

  const [enhancing, setEnhancing] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [model, setModel] = useState("claude-haiku-4-5");

  const [toolbarOpen, setToolbarOpen] = useState(true);

  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [findReplaceShowReplace, setFindReplaceShowReplace] = useState(false);
  const [findInitialQuery, setFindInitialQuery] = useState("");
  const [findMatches, setFindMatches] = useState<MatchResult[]>([]);
  const [findCurrentIndex, setFindCurrentIndex] = useState(0);

  const closeEnhanceDialogRef = useRef<HTMLButtonElement | null>(null);
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

    const path = await save({
      filters: [{ name: "PDF Files", extensions: ["pdf"] }],
      defaultPath: `${settings.defaultNoteDownloadPath}${note.title || "note"}.pdf`,
    });

    if (!path) return;

    const dir = extractDirectory(path);
    if (dir.trim()) {
      setSettings({ defaultNoteDownloadPath: dir });
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

      const arrayBuffer = await blob.arrayBuffer();
      await writeFile(path, new Uint8Array(arrayBuffer));

      toast.success("PDF exported!", { id: toastId });
    } catch (error) {
      console.error("PDF export error:", error);
      toast.error("Failed to export PDF", { id: toastId });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleAIEnhance = async () => {
    if (!API) return;
    try {
      setEnhancing(true);
      closeEnhanceDialogRef.current?.click();
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

  return (
    <div className="w-full relative flex-1 min-h-0 flex flex-col">
      <div
        className={`fixed left-1/2 -translate-x-1/2 ${
          findReplaceOpen
            ? findReplaceShowReplace
              ? "bottom-24"
              : "bottom-14"
            : "bottom-4"
        } z-90 flex flex-row items-center rounded-full transition-[background-color,border-color,box-shadow,bottom] duration-300 ease-out ${
          toolbarOpen
            ? "px-2 py-1 border shadow bg-surface"
            : "p-0 border-transparent bg-transparent shadow-none"
        }`}
      >
        <div
          className={`flex flex-row items-center gap-1 overflow-hidden transition-[max-width,opacity,margin] duration-300 ease-out ${
            toolbarOpen
              ? "max-w-[600px] opacity-100 mr-1"
              : "max-w-0 opacity-0 mr-0"
          }`}
        >
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setTogglePreview((prev) => !prev)}
          >
            {togglePreview ? <Edit2 /> : <Eye />}
          </Button>
          {!disableAiEnhance && (
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="icon-sm" className="">
                  <Sparkles />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Enhance Note with AI</DialogTitle>

                  <DialogDescription>
                    Use AI to enhance your note by making it more detailed,
                    clear, and well-structured.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col items-start gap-1">
                    <Label htmlFor="model" className="w-32">
                      Model
                    </Label>
                    <ModelSelector model={model} onModelChange={setModel} />
                  </div>
                  <Separator />
                  <div className="flex flex-col items-start gap-1">
                    <Label htmlFor="info" className="w-32">
                      Additional Info
                    </Label>
                    <Textarea
                      value={additionalInfo}
                      onChange={(e) => setAdditionalInfo(e.target.value)}
                      id="info"
                      className="font-mono text-sm h-24 overflow-y-auto rounded-none resize-none"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button
                      ref={closeEnhanceDialogRef}
                      variant="outline"
                      disabled={enhancing}
                    >
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button onClick={handleAIEnhance} disabled={enhancing}>
                    {enhancing ? (
                      <>
                        Enhancing... <Loader2 className="animate-spin" />
                      </>
                    ) : (
                      "Enhance Note"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {onCategorize && (
            <Button
              variant="outline"
              size="icon-sm"
              onClick={handleCategorize}
              disabled={categorizing || loading || content !== initialContent}
              title={
                content !== initialContent
                  ? "Save content before categorizing"
                  : "Categorize note"
              }
            >
              {categorizing ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FolderTree />
              )}
            </Button>
          )}
          <Button
            disabled={content !== initialContent || loading}
            variant={"outline"}
            size={"icon"}
            onClick={async () => {
              const path = await save({
                filters: [
                  {
                    name: "Note Files",
                    extensions: ["md", "txt"],
                  },
                ],
                defaultPath: `${settings.defaultNoteDownloadPath}${note.title || "note"}.md`,
              });
              if (path) {
                const pathWithoutNoteName = extractDirectory(path);
                if (pathWithoutNoteName.trim()) {
                  setSettings({ defaultNoteDownloadPath: pathWithoutNoteName });
                }
                try {
                  await writeTextFile(path, content);
                } catch (error) {
                  console.error("Error saving file:", error);
                }
              }
            }}
          >
            <Download />
          </Button>
          <Dialog open={pdfDialogOpen} onOpenChange={setPdfDialogOpen}>
            <DialogTrigger asChild>
              <Button
                disabled={content !== initialContent || loading || exportingPdf}
                variant={"outline"}
                size={"icon"}
              >
                {exportingPdf ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FileText />
                )}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Export to PDF</DialogTitle>
                <DialogDescription>
                  Configure your PDF export options.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center space-x-2 py-4">
                <Checkbox
                  id="showHeader"
                  checked={showHeader}
                  onCheckedChange={(checked) => setShowHeader(checked === true)}
                />
                <Label htmlFor="showHeader" className="cursor-pointer">
                  Include header with logo, title, and date
                </Label>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setPdfDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleExportPdf}>
                  Export PDF <FileText className="ml-2 h-4 w-4" />
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button
            onClick={handleSave}
            size="icon-sm"
            disabled={(saveDisabled ?? content === initialContent) || loading}
            title={saveLabel}
          >
            {loading ? (
              <Loader2 className="animate-spin" />
            ) : (
              <>
                <Save />
                <span className="sr-only">{saveLabel}</span>
              </>
            )}
          </Button>
          <Button
            onClick={() => {
              setEditorContent(initialContent);
            }}
            disabled={content === initialContent || loading}
            variant="secondary"
            size="icon-sm"
          >
            <ClipboardX />
          </Button>
        </div>
        <Button
          variant={"outline"}
          size={"icon-sm"}
          className="rounded-full"
          onClick={() => setToolbarOpen((prev) => !prev)}
        >
          {toolbarOpen ? <ChevronDownCircle /> : <ChevronUpCircle />}
        </Button>
      </div>
      {!togglePreview && (
        <div className="relative flex-1 min-h-0 flex flex-col">
          {showOverlay && (
            <div
              ref={overlayRef}
              className="absolute inset-0 overflow-y-auto pointer-events-none z-0 editor-overlay"
              aria-hidden="true"
            >
              <div className="font-mono text-sm px-3 pt-2 pb-28 whitespace-pre-wrap wrap-break-word text-transparent">
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
                            className="bg-blue-400/30 text-transparent rounded-sm"
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
                          ? "bg-[#e85d00]/40"
                          : "bg-[#ffeb3b]/25";

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
            className={`font-mono text-sm flex-1 min-h-0 overflow-y-auto rounded-none border-none! outline-none! ring-0! shadow-none! resize-none! relative z-1 px-3 pt-2 pb-28 selection:bg-blue-400/30 selection:text-foreground ${showOverlay ? "bg-transparent! selection:bg-transparent!" : ""}`}
          />
        </div>
      )}
      {togglePreview && (
        <div className="flex-1 min-h-0 overflow-y-auto w-full max-w-full! mx-auto bg-background px-3 py-2">
          <MarkdownRenderer content={content} />
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
