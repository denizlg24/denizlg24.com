"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  NotebookText,
  Printer,
} from "lucide-react";
import type { Deck, Slide } from "@/lib/reports/types";
import { editionDate } from "@/lib/reports/format";
import { ChartView, type ChartSize } from "./chart";
import { DocTable } from "./doc-table";
import { disclaimer } from "./brand";
import { useHash } from "@/components/shell/hooks";

const canvas = { width: 1280, height: 720 };

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="slide-bullets">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function SlideBody({
  slide,
  deck,
  index,
  total,
  chartSize,
}: {
  slide: Slide;
  deck: Deck;
  index: number;
  total: number;
  chartSize: ChartSize;
}) {
  const date = editionDate(deck.date);
  if (slide.layout === "title")
    return (
      <div className="slide-title-layout">
        <div className="slide-title-main">
          <h1>{slide.title}</h1>
          {slide.subtitle ? (
            <p className="slide-lede">{slide.subtitle}</p>
          ) : null}
        </div>
        <p className="slide-title-meta">
          {deck.author ? <span>{deck.author}</span> : null}
          <time dateTime={deck.date}>{date}</time>
        </p>
      </div>
    );
  if (slide.layout === "section")
    return (
      <div className="slide-section-layout">
        <h2>{slide.title}</h2>
        {slide.subtitle ? <p className="slide-lede">{slide.subtitle}</p> : null}
      </div>
    );
  if (slide.layout === "quote")
    return (
      <figure className="slide-quote-layout">
        <blockquote>{slide.title}</blockquote>
        {slide.subtitle ? <figcaption>{slide.subtitle}</figcaption> : null}
      </figure>
    );
  const head = (
    <header className="slide-head">
      <h2>{slide.title}</h2>
      {slide.subtitle ? <p>{slide.subtitle}</p> : null}
    </header>
  );
  if (slide.layout === "chart" || slide.layout === "chart-bullets")
    return (
      <div className="slide-content" data-layout={slide.layout}>
        {head}
        <div className="slide-split">
          {slide.chart ? (
            <div className="slide-chart">
              <ChartView chart={slide.chart} size={chartSize} />
            </div>
          ) : null}
          {slide.layout === "chart-bullets" && slide.bullets?.length ? (
            <Bullets items={slide.bullets} />
          ) : null}
        </div>
      </div>
    );
  if (slide.layout === "table")
    return (
      <div className="slide-content" data-layout="table">
        {head}
        {slide.table ? <DocTable table={slide.table} /> : null}
        {slide.bullets?.length ? <Bullets items={slide.bullets} /> : null}
      </div>
    );
  return (
    <div className="slide-content" data-layout="bullets">
      {head}
      {slide.bullets?.length ? <Bullets items={slide.bullets} /> : null}
      {slide.chart ? (
        <div className="slide-chart">
          <ChartView chart={slide.chart} size={chartSize} />
        </div>
      ) : null}
      {slide.table ? <DocTable table={slide.table} /> : null}
      <span className="sr-only">
        Slide {index + 1} of {total}
      </span>
    </div>
  );
}

function SlideFrame({
  slide,
  deck,
  index,
  total,
  active,
  chartSize,
}: {
  slide: Slide;
  deck: Deck;
  index: number;
  total: number;
  active: boolean;
  chartSize: ChartSize;
}) {
  const last = index === total - 1;
  return (
    <section
      className="slide"
      data-layout={slide.layout}
      data-active={active || undefined}
      aria-hidden={!active}
      aria-roledescription="slide"
      aria-label={`Slide ${index + 1} of ${total}: ${slide.title}`}
      inert={!active}
    >
      <header className="slide-chrome">
        <span className="slide-brand">
          <span className="slide-brand-mark" aria-hidden />
          Stockwatcher
        </span>
        <span className="slide-deck-title">{deck.title}</span>
      </header>
      <div className="slide-body">
        <SlideBody
          slide={slide}
          deck={deck}
          index={index}
          total={total}
          chartSize={chartSize}
        />
      </div>
      {last && deck.sources?.length ? (
        <p className="slide-sources">Sources: {deck.sources.join(" · ")}</p>
      ) : null}
      <footer className="slide-foot">
        <span>
          {last
            ? disclaimer
            : slide.layout === "title"
              ? ""
              : editionDate(deck.date)}
        </span>
        <span className="slide-number">
          {index + 1}
          <span aria-hidden> / </span>
          {total}
        </span>
      </footer>
    </section>
  );
}

function slideFromHash(hash: string, total: number) {
  const n = Number(hash);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, total) - 1 : 0;
}

export function DeckViewer({
  deck,
  toolbar,
}: {
  deck: Deck;
  toolbar?: ReactNode;
}) {
  const total = deck.slides.length;
  const index = slideFromHash(useHash(), total);
  const [notes, setNotes] = useState(false);
  const [full, setFull] = useState(false);
  const [scale, setScale] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(total - 1, next));
      window.location.replace(`#${clamped + 1}`);
    },
    [total],
  );

  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const measure = () => {
      const style = window.getComputedStyle(node);
      const width =
        node.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const height =
        node.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      const isNarrow = window.innerWidth < 760;
      setNarrow(isNarrow);
      setScale(
        Math.max(0.1, Math.min(width / canvas.width, height / canvas.height)),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input, textarea, select, [contenteditable]")
      )
        return;
      const key = event.key;
      if (key === "ArrowRight" || key === "PageDown" || key === " ") {
        event.preventDefault();
        go(index + 1);
      } else if (key === "ArrowLeft" || key === "PageUp") {
        event.preventDefault();
        go(index - 1);
      } else if (key === "Home") {
        event.preventDefault();
        go(0);
      } else if (key === "End") {
        event.preventDefault();
        go(total - 1);
      } else if (key === "n" || key === "N") {
        setNotes((open) => !open);
      } else if (key === "f" || key === "F") {
        void toggleFullscreen();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const onChange = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setFull(false);
    }
  }

  const slide = deck.slides[index];

  return (
    <div
      ref={root}
      className={`deck theme-${deck.theme}`}
      data-mode={narrow ? "narrow" : "wide"}
      data-notes={notes || undefined}
    >
      {toolbar}
      <div
        className="deck-stage"
        ref={stage}
        onTouchStart={(event) => {
          touch.current = event.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          const start = touch.current;
          const end = event.changedTouches[0]?.clientX;
          touch.current = null;
          if (start == null || end == null || Math.abs(end - start) < 48)
            return;
          go(index + (end < start ? 1 : -1));
        }}
      >
        <div
          className="deck-frame"
          style={
            narrow
              ? undefined
              : {
                  width: canvas.width * scale,
                  height: canvas.height * scale,
                  visibility: scale ? "visible" : "hidden",
                }
          }
        >
          <div
            className="deck-canvas"
            style={narrow ? undefined : { transform: `scale(${scale})` }}
            aria-live="polite"
          >
            {deck.slides.map((item, i) => (
              <SlideFrame
                key={i}
                slide={item}
                deck={deck}
                index={i}
                total={total}
                active={i === index}
                chartSize={narrow ? "slide-compact" : "slide"}
              />
            ))}
          </div>
        </div>
      </div>
      {notes ? (
        <aside className="deck-notes" aria-label="Presenter notes">
          <p className="deck-notes-label">Notes · slide {index + 1}</p>
          <p>{slide.notes?.trim() || "No notes for this slide."}</p>
        </aside>
      ) : null}
      <nav className="deck-bar" aria-label="Slide controls">
        <div className="deck-progress" aria-hidden>
          <span style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>
        <div className="deck-controls">
          <button
            type="button"
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label="Previous slide"
          >
            <ChevronLeft aria-hidden />
          </button>
          <span className="deck-count" aria-live="polite">
            <strong>{index + 1}</strong> / {total}
          </span>
          <button
            type="button"
            onClick={() => go(index + 1)}
            disabled={index === total - 1}
            aria-label="Next slide"
          >
            <ChevronRight aria-hidden />
          </button>
          <span className="deck-bar-title">{slide.title}</span>
          <button
            type="button"
            onClick={() => setNotes(!notes)}
            aria-pressed={notes}
            title="Presenter notes (N)"
          >
            <NotebookText aria-hidden />
            <span>Notes</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            title="Print or save as PDF"
          >
            <Printer aria-hidden />
            <span>PDF</span>
          </button>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            aria-label={full ? "Exit full screen" : "Full screen"}
            title="Full screen (F)"
          >
            {full ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
          </button>
        </div>
      </nav>
    </div>
  );
}
