"use client";

import { Button } from "@repo/ui/button";
import { PageHeader } from "@repo/ui/page";
import { Slider } from "@repo/ui/slider";
import { Spinner } from "@repo/ui/spinner";
import { SearchField } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Highlighter,
  Info,
  ListTree,
  Pause,
  Search,
  Volume2,
  X,
} from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { useAdminSpeech } from "../tts/use-admin-speech";
import {
  findPdfMatches,
  flattenPdfOutline,
  highlightPdfText,
  type PdfOutlineEntry,
  type PdfSearchResult,
} from "./pdf-reader-utils";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MAX_SCALE = 4;
const CHROME_TIMEOUT_MS = 2600;
const SWIPE_THRESHOLD_PX = 44;
const TAP_SLOP_PX = 12;

interface ReaderProps {
  url: string;
  fileName: string;
  page: number;
  onPageChange: (page: number) => void;
  onTotalPages: (total: number) => void;
  onHighlightSelection?: (text: string, page: number) => void;
}

function SpeakDocumentButton({
  document,
  page,
  onPageChange,
  compact = false,
}: {
  document: PDFDocumentProxy | null;
  page: number;
  onPageChange: (page: number) => void;
  compact?: boolean;
}) {
  const { client } = useAdmin();
  const speech = useAdminSpeech(client);
  useEffect(() => speech.stop(), [document, speech.stop]);
  const start = () => {
    if (!document) return;
    if (speech.state !== "idle") {
      speech.stop();
      return;
    }
    const from = page;
    async function* pages() {
      if (!document) return;
      for (let number = from; number <= document.numPages; number++) {
        const pdfPage = await document.getPage(number);
        const content = await pdfPage.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .trim();
        if (text) {
          if (number !== from) onPageChange(number);
          yield `${text}\n\n`;
        }
      }
    }
    void speech.play(pages()).catch((error: unknown) => {
      toast.error(
        error instanceof Error ? error.message : "Could not read this document",
      );
    });
  };
  return (
    <Button
      type="button"
      variant={speech.state === "idle" ? "ghost" : "secondary"}
      size={compact ? "icon-sm" : "sm"}
      disabled={!document}
      onClick={start}
      aria-label={
        speech.state === "idle" ? "Read from this page aloud" : "Stop reading"
      }
      title={
        speech.state === "idle" ? "Read from this page aloud" : "Stop reading"
      }
    >
      {speech.state === "loading" ? (
        <Spinner className="size-3.5" />
      ) : speech.state === "playing" ? (
        <Pause />
      ) : (
        <Volume2 />
      )}
      {!compact && (speech.state === "idle" ? "Listen" : "Stop")}
    </Button>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * The text layer is the only place a real selection can come from, and pdf.js
 * rebuilds it per page, so the selection is read on demand rather than tracked.
 */
function selectionText(): string {
  return (window.getSelection()?.toString() ?? "").trim();
}

function useDocumentPages(onTotalPages: (total: number) => void) {
  const [numPages, setNumPages] = useState(0);
  const handleLoad = useCallback(
    ({ numPages: count }: { numPages: number }) => {
      setNumPages(count);
      onTotalPages(count);
    },
    [onTotalPages],
  );
  return { numPages, handleLoad };
}

const documentLoading = (
  <div className="flex min-h-80 items-center justify-center">
    <Spinner className="size-4 text-muted-foreground" />
  </div>
);

const documentError = (
  <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">
    PDF unavailable
  </div>
);

/**
 * The page number, editable in place.
 *
 * Both readers had a page indicator; only the inline one let you type into it,
 * so the full-screen reader — the one you use when actually reading — was the
 * one with no way to jump to a page. Same control in both now.
 */
function PageJump({
  page,
  numPages,
  onPageChange,
  className,
  prefix,
}: {
  page: number;
  numPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  prefix?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const parsed = Number(draft);
    setDraft("");
    if (!Number.isFinite(parsed) || parsed < 1) return;
    onPageChange(clamp(Math.trunc(parsed), 1, numPages || parsed));
  };

  return (
    <span
      className={cn(
        "flex items-center gap-1 text-xs tabular-nums text-muted-foreground",
        className,
      )}
    >
      {prefix}
      <input
        type="number"
        min={1}
        max={numPages || undefined}
        value={draft === "" ? page : draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft("");
        }}
        aria-label="Page number"
        className="w-10 rounded bg-transparent px-0.5 text-right tabular-nums outline-none hover:bg-surface focus:bg-surface focus:text-accent-strong [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <span>/ {numPages || "\u2014"}</span>
    </span>
  );
}

export function InlinePdfReader({
  url,
  fileName,
  page,
  onPageChange,
  onTotalPages,
  onHighlightSelection,
}: ReaderProps) {
  const [width, setWidth] = useState(720);
  const [selection, setSelection] = useState("");
  const { numPages, handleLoad } = useDocumentPages(onTotalPages);

  const turn = useCallback(
    (delta: number) => {
      const next = clamp(page + delta, 1, numPages || page + delta);
      if (next !== page) onPageChange(next);
    },
    [numPages, onPageChange, page],
  );

  // The page renders to the width it is given, so the measurement has to track
  // the container rather than the one value it happened to have when it
  // mounted — the sidebar and the window both resize under it.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Bound to the reader rather than the window: the inline reader is one panel
  // among many, and arrow keys elsewhere in the admin shell are not page
  // turns. A focused field or a live text selection still opts out.
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
    ) {
      return;
    }
    if (selectionText()) return;
    if (event.key === "ArrowLeft") turn(-1);
    if (event.key === "ArrowRight") turn(1);
  };

  return (
    <div className="border-b bg-surface/40">
      <div className="flex h-10 items-center gap-2 border-b bg-background px-3">
        <FileText className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {fileName}
        </span>
        {onHighlightSelection && selection && (
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              onHighlightSelection(selection, page);
              window.getSelection()?.removeAllRanges();
              setSelection("");
            }}
          >
            <Highlighter /> Highlight
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page <= 1}
          onClick={() => turn(-1)}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <PageJump page={page} numPages={numPages} onPageChange={onPageChange} />
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!numPages || page >= numPages}
          onClick={() => turn(1)}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
      <div
        ref={containerRef}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the reader takes focus so arrow keys turn its pages rather than the shell's
        tabIndex={0}
        onKeyDown={onKey}
        onMouseUp={() => setSelection(selectionText())}
        className="flex max-h-[70vh] min-h-[32rem] justify-center overflow-auto p-3 outline-none focus-visible:ring-1 focus-visible:ring-ring/40 [&_.react-pdf__Page]:ring-1 [&_.react-pdf__Page]:ring-border"
      >
        <Document
          suspense={false}
          file={url}
          onLoadSuccess={handleLoad}
          loading={documentLoading}
          error={documentError}
        >
          <Page
            pageNumber={page}
            width={clamp(width - 24, 280, 900)}
            renderAnnotationLayer
            renderTextLayer
          />
        </Document>
      </div>
    </div>
  );
}

interface MobileReaderProps extends ReaderProps {
  title: string;
  onClose: () => void;
  onOpenDetails: () => void;
  footnote?: string;
}

interface DesktopReaderProps extends ReaderProps {
  title: string;
  onClose: () => void;
  onOpenDetails: () => void;
}

function usePdfNavigation(document: PDFDocumentProxy | null, query: string) {
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<PdfSearchResult[]>([]);
  const [outline, setOutline] = useState<ResolvedOutlineEntry[]>([]);
  const textCache = useRef(new Map<number, string>());

  useEffect(() => {
    textCache.current = new Map();
    if (!document) return;
    let cancelled = false;
    void document.getOutline().then(async (nodes) => {
      const flat = flattenPdfOutline(nodes ?? []);
      const resolved = await Promise.all(
        flat.map(async (entry) => ({
          ...entry,
          page: await outlinePage(document, entry.destination).catch(
            () => undefined,
          ),
        })),
      );
      if (!cancelled) setOutline(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [document]);

  useEffect(() => {
    if (!document || !query.trim()) {
      setMatches([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void (async () => {
        const found: PdfSearchResult[] = [];
        for (let start = 1; start <= document.numPages; start += 8) {
          const pageNumbers = Array.from(
            { length: Math.min(8, document.numPages - start + 1) },
            (_, index) => start + index,
          );
          const texts = await Promise.all(
            pageNumbers.map(async (pageNumber) => {
              const cached = textCache.current.get(pageNumber);
              if (cached !== undefined) return cached;
              const pdfPage = await document.getPage(pageNumber);
              const content = await pdfPage.getTextContent();
              const text = content.items
                .map((item) => ("str" in item ? item.str : ""))
                .join(" ");
              textCache.current.set(pageNumber, text);
              return text;
            }),
          );
          if (cancelled) return;
          for (const [index, text] of texts.entries()) {
            found.push(
              ...findPdfMatches(text, query, pageNumbers[index] ?? start),
            );
          }
        }
        if (cancelled) return;
        startTransition(() => {
          setMatches(found);
          setSearching(false);
        });
      })().catch(() => {
        if (!cancelled) setSearching(false);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [document, query]);

  return { searching, matches, outline };
}

/**
 * A paged, full-screen reader. It sits in a fixed overlay so the admin sidebar
 * and header are out of the way entirely rather than competing for a phone
 * viewport.
 */
export function MobilePdfReader({
  url,
  title,
  page,
  onPageChange,
  onTotalPages,
  onClose,
  onOpenDetails,
  onHighlightSelection,
  footnote,
}: MobileReaderProps) {
  const { numPages, handleLoad } = useDocumentPages(onTotalPages);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState({ width: 380, height: 640 });
  const [selection, setSelection] = useState("");
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [panel, setPanel] = useState<"search" | "outline" | null>(null);
  const [query, setQuery] = useState("");
  const navigation = usePdfNavigation(document, query);

  const gesture = useRef<{
    startX: number;
    startY: number;
    startOffset: { x: number; y: number };
    pinchDistance: number;
    pinchScale: number;
    moved: boolean;
  } | null>(null);

  const zoomed = scale > 1.01;

  useEffect(() => {
    const measure = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (!chromeVisible || panel) return;
    const timer = window.setTimeout(
      () => setChromeVisible(false),
      CHROME_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [chromeVisible, panel]);

  // The overlay covers the document, so the page behind it must not scroll
  // under the reader while a gesture is in flight.
  useEffect(() => {
    const previous = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    return () => {
      window.document.body.style.overflow = previous;
    };
  }, []);

  const turn = useCallback(
    (delta: number) => {
      const next = clamp(page + delta, 1, numPages || page + delta);
      if (next !== page) {
        onPageChange(next);
        setScale(1);
        setOffset({ x: 0, y: 0 });
      }
    },
    [numPages, onPageChange, page],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      ) {
        return;
      }
      if (event.key === "ArrowLeft") turn(-1);
      if (event.key === "ArrowRight") turn(1);
      if (event.key === "Escape") {
        if (panel) setPanel(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, panel, turn]);

  const pageWidth = useMemo(
    () => Math.round(viewport.width * scale),
    [scale, viewport.width],
  );

  const visiblePages = useMemo(
    () =>
      [page - 1, page, page + 1].filter(
        (candidate) => candidate >= 1 && (!numPages || candidate <= numPages),
      ),
    [numPages, page],
  );

  const handleTouchStart = (event: React.TouchEvent) => {
    if (event.touches.length === 2) {
      const [a, b] = [event.touches[0], event.touches[1]];
      if (!a || !b) return;
      gesture.current = {
        startX: 0,
        startY: 0,
        startOffset: offset,
        pinchDistance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        pinchScale: scale,
        moved: true,
      };
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    gesture.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startOffset: offset,
      pinchDistance: 0,
      pinchScale: scale,
      moved: false,
    };
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    const state = gesture.current;
    if (!state) return;

    if (event.touches.length === 2 && state.pinchDistance > 0) {
      const [a, b] = [event.touches[0], event.touches[1]];
      if (!a || !b) return;
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const next = clamp(
        (state.pinchScale * distance) / state.pinchDistance,
        1,
        MAX_SCALE,
      );
      setScale(next);
      if (next <= 1.01) setOffset({ x: 0, y: 0 });
      return;
    }

    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) {
      state.moved = true;
    }
    // Panning only makes sense once the page is larger than the viewport;
    // otherwise the same drag is the page-turn swipe.
    if (zoomed) {
      setOffset({
        x: state.startOffset.x + dx,
        y: state.startOffset.y + dy,
      });
    }
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    const state = gesture.current;
    gesture.current = null;
    if (!state || zoomed) return;

    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - state.startX;

    if (state.moved && Math.abs(dx) >= SWIPE_THRESHOLD_PX) {
      turn(dx < 0 ? 1 : -1);
      return;
    }
    if (state.moved) return;

    const selected = selectionText();
    if (selected) {
      setSelection(selected);
      setChromeVisible(true);
      return;
    }

    const third = viewport.width / 3;
    if (touch.clientX < third) turn(-1);
    else if (touch.clientX > third * 2) turn(1);
    else setChromeVisible((visible) => !visible);
  };

  const percent = numPages ? Math.round((page / numPages) * 100) : 0;

  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--titlebar-inset,0px)] z-50 flex flex-col bg-background">
      <ReaderBar
        visible={chromeVisible}
        position="top"
        className="flex h-11 items-center gap-1 px-3"
      >
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close reader"
        >
          <X />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-accent-strong">
          {title}
        </span>
        <SpeakDocumentButton
          document={document}
          page={page}
          onPageChange={onPageChange}
          compact
        />
        <Button
          variant={panel === "search" ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={() => {
            setPanel((current) => (current === "search" ? null : "search"));
            setChromeVisible(true);
          }}
          aria-label="Search document"
        >
          <Search />
        </Button>
        <Button
          variant={panel === "outline" ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={() => {
            setPanel((current) => (current === "outline" ? null : "outline"));
            setChromeVisible(true);
          }}
          aria-label="Document outline"
        >
          <ListTree />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenDetails}
          aria-label="Reading details"
        >
          <Info />
        </Button>
      </ReaderBar>

      {panel ? (
        <div className="absolute inset-x-2 top-12 bottom-20 z-20 overflow-y-auto rounded-lg border bg-popover shadow-lg">
          <NavigationPanel
            panel={panel}
            query={query}
            onQueryChange={setQuery}
            searching={navigation.searching}
            matches={navigation.matches}
            outline={navigation.outline}
            onNavigate={(target) => {
              onPageChange(target);
              setPanel(null);
            }}
          />
        </div>
      ) : null}

      <div
        className="relative flex-1 touch-none overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <Document
          suspense={false}
          file={url}
          onLoadSuccess={(loaded) => {
            setDocument(loaded);
            handleLoad(loaded);
          }}
          loading={documentLoading}
          error={documentError}
        >
          {visiblePages.map((candidate) => (
            <div
              key={candidate}
              className="absolute inset-0 flex items-center justify-center transition-transform duration-200 ease-out dark:[filter:invert(1)_hue-rotate(180deg)]"
              style={{
                transform: `translateX(${(candidate - page) * 100}%) translate(${offset.x}px, ${offset.y}px)`,
              }}
            >
              <Page
                pageNumber={candidate}
                width={pageWidth}
                renderAnnotationLayer={false}
                renderTextLayer
                customTextRenderer={({ str }) => highlightPdfText(str, query)}
              />
            </div>
          ))}
        </Document>
      </div>

      <ReaderBar
        visible={chromeVisible}
        position="bottom"
        className="flex flex-col gap-1.5 px-4 py-2"
      >
        {onHighlightSelection && selection && (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              onHighlightSelection(selection, page);
              window.getSelection()?.removeAllRanges();
              setSelection("");
            }}
          >
            <Highlighter /> Highlight
          </Button>
        )}
        <Slider
          value={[page]}
          min={1}
          max={Math.max(numPages, 1)}
          step={1}
          disabled={!numPages}
          onValueChange={([next]) => {
            if (next && next !== page) turn(next - page);
          }}
        />
        <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
          <span className="flex items-center gap-1">
            <PageJump
              page={page}
              numPages={numPages}
              onPageChange={onPageChange}
              prefix="p."
            />
            <span>· {percent}%</span>
          </span>
          {footnote && <span>{footnote}</span>}
        </div>
      </ReaderBar>
    </div>
  );
}

type ResolvedOutlineEntry = PdfOutlineEntry & { page?: number };

async function outlinePage(
  document: PDFDocumentProxy,
  destination: PdfOutlineEntry["destination"],
): Promise<number | undefined> {
  const resolved =
    typeof destination === "string"
      ? await document.getDestination(destination)
      : destination;
  const target = resolved?.[0];
  if (typeof target === "number") return target + 1;
  if (!target || typeof target !== "object") return undefined;
  return (await document.getPageIndex(target)) + 1;
}

/**
 * Mouse-and-keyboard reading mode. Its page stays a centred paper-width column
 * instead of expanding to the monitor, and its chrome is deliberately stable.
 */
export function DesktopPdfReader({
  url,
  fileName,
  title,
  page,
  onPageChange,
  onTotalPages,
  onClose,
  onOpenDetails,
  onHighlightSelection,
}: DesktopReaderProps) {
  const { numPages, handleLoad } = useDocumentPages(onTotalPages);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(900);
  const [selection, setSelection] = useState("");
  const [panel, setPanel] = useState<"search" | "outline" | null>(null);
  const [query, setQuery] = useState("");
  const { searching, matches, outline } = usePdfNavigation(document, query);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const turn = useCallback(
    (delta: number) => {
      const next = clamp(page + delta, 1, numPages || page + delta);
      if (next !== page) onPageChange(next);
    },
    [numPages, onPageChange, page],
  );

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const previous = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    return () => {
      window.document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")
      ) {
        return;
      }
      if (event.key === "Escape") onClose();
      if (selectionText()) return;
      if (event.key === "ArrowLeft" || event.key === "PageUp") turn(-1);
      if (event.key === "ArrowRight" || event.key === "PageDown") turn(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, turn]);

  const handleDocumentLoad = useCallback(
    (loaded: PDFDocumentProxy) => {
      setDocument(loaded);
      handleLoad(loaded);
    },
    [handleLoad],
  );

  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--titlebar-inset,0px)] z-50 flex flex-col bg-background">
      <PageHeader
        leading={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close reader"
          >
            <X />
          </Button>
        }
        icon={<FileText />}
        title={title}
      >
        <span className="mr-2 hidden max-w-60 truncate text-xs text-muted-foreground lg:inline">
          {fileName}
        </span>
        {onHighlightSelection && selection ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onHighlightSelection(selection, page);
              window.getSelection()?.removeAllRanges();
              setSelection("");
            }}
          >
            <Highlighter /> Highlight
          </Button>
        ) : null}
        <SpeakDocumentButton
          document={document}
          page={page}
          onPageChange={onPageChange}
        />
        <Button
          variant={panel === "search" ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={() =>
            setPanel((current) => (current === "search" ? null : "search"))
          }
          aria-label="Search document"
        >
          <Search />
        </Button>
        <Button
          variant={panel === "outline" ? "secondary" : "ghost"}
          size="icon-sm"
          onClick={() =>
            setPanel((current) => (current === "outline" ? null : "outline"))
          }
          aria-label="Document outline"
        >
          <ListTree />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenDetails}
          aria-label="Reading details"
        >
          <Info />
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        {panel ? (
          <aside className="w-80 shrink-0 overflow-y-auto border-r bg-background">
            <NavigationPanel
              panel={panel}
              query={query}
              onQueryChange={setQuery}
              searching={searching}
              matches={matches}
              outline={outline}
              onNavigate={onPageChange}
            />
          </aside>
        ) : null}

        <div
          ref={containerRef}
          onMouseUp={() => setSelection(selectionText())}
          className="min-w-0 flex-1 overflow-auto bg-surface/40 p-6 dark:[&_.react-pdf__Page]:[filter:invert(1)_hue-rotate(180deg)]"
        >
          <Document
            suspense={false}
            file={url}
            onLoadSuccess={handleDocumentLoad}
            loading={documentLoading}
            error={documentError}
          >
            <div className="mx-auto w-fit overflow-hidden ring-1 ring-border">
              <Page
                pageNumber={page}
                width={clamp(width - 64, 320, 900)}
                renderAnnotationLayer
                renderTextLayer
                customTextRenderer={({ str }) => highlightPdfText(str, query)}
              />
            </div>
          </Document>
        </div>
      </div>

      <footer className="flex h-11 shrink-0 items-center justify-center gap-1 border-t bg-background px-3">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={page <= 1}
          onClick={() => turn(-1)}
          aria-label="Previous page"
        >
          <ChevronLeft />
        </Button>
        <PageJump page={page} numPages={numPages} onPageChange={onPageChange} />
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!numPages || page >= numPages}
          onClick={() => turn(1)}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </footer>
    </div>
  );
}

/** Search results or the outline, shared by both full-screen readers. */
function NavigationPanel({
  panel,
  query,
  onQueryChange,
  searching,
  matches,
  outline,
  onNavigate,
}: {
  panel: "search" | "outline";
  query: string;
  onQueryChange: (query: string) => void;
  searching: boolean;
  matches: PdfSearchResult[];
  outline: ResolvedOutlineEntry[];
  onNavigate: (page: number) => void;
}) {
  if (panel === "search") {
    return (
      <div>
        <div className="sticky top-0 flex flex-col gap-1.5 border-b bg-inherit p-2">
          <SearchField
            value={query}
            onChange={onQueryChange}
            autoFocus
            className="w-full"
          />
          <span className="flex items-center gap-1.5 px-1 text-xs tabular-nums text-muted-foreground">
            {searching ? (
              <Spinner className="size-3" />
            ) : (
              `${matches.length} matches`
            )}
          </span>
        </div>
        <div className="flex flex-col p-1">
          {matches.map((match) => (
            <button
              key={`${match.page}:${match.index}`}
              type="button"
              className="flex flex-col gap-0.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-surface/70"
              onClick={() => onNavigate(match.page)}
            >
              <span className="text-xs tabular-nums text-muted-foreground">
                p. {match.page}
              </span>
              <span className="text-xs leading-5 text-accent-strong">
                {match.excerpt}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (outline.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        No outline
      </div>
    );
  }
  return (
    <div className="flex flex-col p-1">
      {outline.map((entry, index) => (
        <button
          key={`${entry.title}:${index}`}
          type="button"
          disabled={!entry.page}
          className="flex items-baseline gap-2 rounded-md py-1.5 pr-2 text-left text-xs text-accent-strong transition-colors hover:bg-surface/70 disabled:opacity-40"
          style={{ paddingLeft: `${8 + entry.depth * 14}px` }}
          onClick={() => entry.page && onNavigate(entry.page)}
        >
          <span className="min-w-0 flex-1">{entry.title}</span>
          {entry.page ? (
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {entry.page}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function ReaderBar({
  visible,
  position,
  className,
  children,
}: {
  visible: boolean;
  position: "top" | "bottom";
  className?: string;
  children: ReactNode;
}) {
  const hidden = position === "top" ? "-translate-y-full" : "translate-y-full";
  const edge = position === "top" ? "top-0 border-b" : "bottom-0 border-t";
  return (
    <div
      className={cn(
        "absolute inset-x-0 z-10 bg-background/95 backdrop-blur transition-transform duration-200",
        edge,
        visible ? "translate-y-0" : hidden,
        className,
      )}
    >
      {children}
    </div>
  );
}
