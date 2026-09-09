"use client";

import { Button } from "@repo/ui/button";
import { Slider } from "@repo/ui/slider";
import { cn } from "@repo/ui/utils";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Highlighter,
  Info,
  ListTree,
  Search,
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
  <div className="flex min-h-80 items-center justify-center text-xs text-muted-foreground">
    Loading PDF…
  </div>
);

const documentError = (
  <div className="flex min-h-80 items-center justify-center text-xs text-destructive">
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
        "flex items-center gap-1 font-mono text-[10px] tabular-nums text-muted-foreground",
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
        className="w-9 bg-transparent text-right tabular-nums outline-none focus:text-foreground"
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
    <div className="border-b bg-muted/20">
      <div className="flex h-9 items-center gap-2 border-b bg-background/80 px-3">
        <FileText className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
          {fileName}
        </span>
        {onHighlightSelection && selection && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px]"
            onClick={() => {
              onHighlightSelection(selection, page);
              window.getSelection()?.removeAllRanges();
              setSelection("");
            }}
          >
            <Highlighter className="size-3" /> Highlight
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={page <= 1}
          onClick={() => turn(-1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <PageJump page={page} numPages={numPages} onPageChange={onPageChange} />
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          disabled={!numPages || page >= numPages}
          onClick={() => turn(1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
      <div
        ref={containerRef}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the reader takes focus so arrow keys turn its pages rather than the shell's
        tabIndex={0}
        onKeyDown={onKey}
        onMouseUp={() => setSelection(selectionText())}
        className="flex max-h-[70vh] min-h-[32rem] justify-center overflow-auto p-3 outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Document
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
        className="flex items-center gap-2 px-3"
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onClose}
          aria-label="Close reader"
        >
          <X className="size-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={() => {
            setPanel((current) => (current === "search" ? null : "search"));
            setChromeVisible(true);
          }}
          aria-label="Search document"
        >
          <Search className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={() => {
            setPanel((current) => (current === "outline" ? null : "outline"));
            setChromeVisible(true);
          }}
          aria-label="Document outline"
        >
          <ListTree className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onOpenDetails}
          aria-label="Reading details"
        >
          <Info className="size-4" />
        </Button>
      </ReaderBar>

      {panel ? (
        <div className="absolute inset-x-2 top-12 bottom-20 z-20 overflow-y-auto rounded-md border bg-background shadow-lg">
          {panel === "search" ? (
            <div>
              <div className="sticky top-0 border-b bg-background p-3">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search"
                  aria-label="Search PDF text"
                  className="h-9 w-full rounded-md border bg-transparent px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
                <p className="mt-1.5 font-mono text-[9px] text-muted-foreground">
                  {navigation.searching
                    ? "Searching…"
                    : `${navigation.matches.length} matches`}
                </p>
              </div>
              <div className="divide-y">
                {navigation.matches.map((match) => (
                  <button
                    key={`${match.page}:${match.index}`}
                    type="button"
                    className="block w-full p-3 text-left"
                    onClick={() => {
                      onPageChange(match.page);
                      setPanel(null);
                    }}
                  >
                    <span className="font-mono text-[9px] text-muted-foreground">
                      p. {match.page}
                    </span>
                    <span className="mt-1 block text-xs leading-5">
                      {match.excerpt}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {navigation.outline.map((entry, index) => (
                <button
                  key={`${entry.title}:${index}`}
                  type="button"
                  disabled={!entry.page}
                  className="block w-full py-3 pr-3 text-left text-xs disabled:opacity-40"
                  style={{ paddingLeft: `${12 + entry.depth * 14}px` }}
                  onClick={() => {
                    if (entry.page) onPageChange(entry.page);
                    setPanel(null);
                  }}
                >
                  {entry.title}
                  {entry.page ? (
                    <span className="ml-2 font-mono text-[9px] text-muted-foreground">
                      {entry.page}
                    </span>
                  ) : null}
                </button>
              ))}
              {navigation.outline.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">
                  —
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <div
        className="relative flex-1 touch-none overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <Document
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
            className="h-7 self-start text-[11px]"
            onClick={() => {
              onHighlightSelection(selection, page);
              window.getSelection()?.removeAllRanges();
              setSelection("");
            }}
          >
            <Highlighter className="size-3" /> Highlight selection
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
        <div className="flex items-center justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
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
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState<PdfSearchResult[]>([]);
  const [outline, setOutline] = useState<ResolvedOutlineEntry[]>([]);
  const textCache = useRef(new Map<number, string>());
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

  useEffect(() => {
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
        // Text extraction is independent per page. Work in bounded parallel
        // batches so large papers do not create hundreds of worker requests at
        // once, while avoiding a page-by-page network/worker waterfall.
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

  const handleDocumentLoad = useCallback(
    (loaded: PDFDocumentProxy) => {
      textCache.current = new Map();
      setDocument(loaded);
      handleLoad(loaded);
    },
    [handleLoad],
  );

  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--titlebar-inset,0px)] z-50 flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onClose}
          aria-label="Close reader"
        >
          <X className="size-4" />
        </Button>
        <FileText className="size-3.5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{title}</p>
          <p className="truncate font-mono text-[9px] text-muted-foreground">
            {fileName}
          </p>
        </div>
        {onHighlightSelection && selection ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => {
              onHighlightSelection(selection, page);
              window.getSelection()?.removeAllRanges();
              setSelection("");
            }}
          >
            <Highlighter className="size-3" /> Highlight
          </Button>
        ) : null}
        <Button
          variant={panel === "search" ? "secondary" : "ghost"}
          size="icon"
          className="size-8"
          onClick={() =>
            setPanel((current) => (current === "search" ? null : "search"))
          }
          aria-label="Search document"
        >
          <Search className="size-4" />
        </Button>
        <Button
          variant={panel === "outline" ? "secondary" : "ghost"}
          size="icon"
          className="size-8"
          onClick={() =>
            setPanel((current) => (current === "outline" ? null : "outline"))
          }
          aria-label="Document outline"
        >
          <ListTree className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onOpenDetails}
          aria-label="Reading details"
        >
          <Info className="size-4" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        {panel ? (
          <aside className="w-80 shrink-0 overflow-y-auto border-r bg-background">
            {panel === "search" ? (
              <div>
                <div className="sticky top-0 border-b bg-background p-3">
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search"
                    aria-label="Search PDF text"
                    className="h-8 w-full rounded-md border bg-transparent px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                  <p className="mt-1.5 font-mono text-[9px] text-muted-foreground">
                    {searching ? "Searching…" : `${matches.length} matches`}
                  </p>
                </div>
                <div className="divide-y">
                  {matches.map((match) => (
                    <button
                      key={`${match.page}:${match.index}`}
                      type="button"
                      className="block w-full p-3 text-left hover:bg-muted/50"
                      onClick={() => onPageChange(match.page)}
                    >
                      <span className="font-mono text-[9px] text-muted-foreground">
                        p. {match.page}
                      </span>
                      <span className="mt-1 block text-[11px] leading-4">
                        {match.excerpt}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="divide-y">
                {outline.map((entry, index) => (
                  <button
                    key={`${entry.title}:${index}`}
                    type="button"
                    disabled={!entry.page}
                    className="block w-full py-2 pr-3 text-left text-xs hover:bg-muted/50 disabled:opacity-40"
                    style={{ paddingLeft: `${12 + entry.depth * 14}px` }}
                    onClick={() => entry.page && onPageChange(entry.page)}
                  >
                    {entry.title}
                    {entry.page ? (
                      <span className="ml-2 font-mono text-[9px] text-muted-foreground">
                        {entry.page}
                      </span>
                    ) : null}
                  </button>
                ))}
                {outline.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    —
                  </p>
                ) : null}
              </div>
            )}
          </aside>
        ) : null}

        <div
          ref={containerRef}
          onMouseUp={() => setSelection(selectionText())}
          className="min-w-0 flex-1 overflow-auto bg-muted/25 p-6 dark:[&_.react-pdf__Page]:[filter:invert(1)_hue-rotate(180deg)]"
        >
          <Document
            file={url}
            onLoadSuccess={handleDocumentLoad}
            loading={documentLoading}
            error={documentError}
          >
            <div className="mx-auto w-fit overflow-hidden shadow-sm">
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

      <footer className="flex h-11 shrink-0 items-center justify-center gap-2 border-t bg-background px-3">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={page <= 1}
          onClick={() => turn(-1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <PageJump page={page} numPages={numPages} onPageChange={onPageChange} />
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          disabled={!numPages || page >= numPages}
          onClick={() => turn(1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </Button>
      </footer>
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
      className={`absolute inset-x-0 ${edge} z-10 bg-background/95 backdrop-blur transition-transform duration-200 ${
        visible ? "translate-y-0" : hidden
      } ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
