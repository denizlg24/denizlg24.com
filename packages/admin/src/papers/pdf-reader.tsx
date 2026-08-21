"use client";

import { Button } from "@repo/ui/button";
import { Slider } from "@repo/ui/slider";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Highlighter,
  Info,
  X,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";
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
  const [pageDraft, setPageDraft] = useState("");
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

  const commitPageDraft = () => {
    const parsed = Number(pageDraft);
    setPageDraft("");
    if (!Number.isFinite(parsed) || parsed < 1) return;
    onPageChange(clamp(Math.trunc(parsed), 1, numPages || parsed));
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
        <div className="flex items-center gap-1 font-mono text-[10px] tabular-nums text-muted-foreground">
          <input
            type="number"
            min={1}
            max={numPages || undefined}
            value={pageDraft === "" ? page : pageDraft}
            onChange={(event) => setPageDraft(event.target.value)}
            onBlur={commitPageDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") setPageDraft("");
            }}
            aria-label="Page number"
            className="w-9 bg-transparent text-right tabular-nums outline-none focus:text-foreground"
          />
          <span>/ {numPages || "—"}</span>
        </div>
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
    if (!chromeVisible) return;
    const timer = window.setTimeout(
      () => setChromeVisible(false),
      CHROME_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [chromeVisible]);

  // The overlay covers the document, so the page behind it must not scroll
  // under the reader while a gesture is in flight.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
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
      if (event.key === "ArrowLeft") turn(-1);
      if (event.key === "ArrowRight") turn(1);
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, turn]);

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
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
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
          onClick={onOpenDetails}
          aria-label="Reading details"
        >
          <Info className="size-4" />
        </Button>
      </ReaderBar>

      <div
        className="relative flex-1 touch-none overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <Document
          file={url}
          onLoadSuccess={handleLoad}
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
          <span>
            p. {page} / {numPages || "—"} · {percent}%
          </span>
          {footnote && <span>{footnote}</span>}
        </div>
      </ReaderBar>
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
