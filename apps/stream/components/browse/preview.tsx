"use client";

import {
  type Progress,
  type TitleSummary,
  tmdbImage,
} from "@repo/schemas/stream";
import { ChevronDown, Play } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { MyListButton } from "@/components/my-list";
import {
  Dotted,
  MetaRow,
  ProgressBar,
  playHref,
  progressShare,
  timeLeft,
} from "@/components/title/meta";

const OPEN_DELAY_MS = 400;
const CLOSE_MS = 180;

let closeOpenCard: (() => void) | null = null;

interface Placement {
  left: number;
  top: number;
  width: number;
  origin: string;
  scale: number;
}

function place(rect: DOMRect): Placement {
  const viewport = document.documentElement.clientWidth;
  const edge = 8;
  const width = Math.min(
    viewport - 2 * edge,
    Math.max(rect.width * 1.5, 18 * 16),
    30 * 16,
  );
  const imageHeight = (width * 9) / 16;
  const left = Math.min(
    Math.max(rect.left + rect.width / 2 - width / 2, edge),
    viewport - width - edge,
  );
  const top = Math.max(rect.top + rect.height / 2 - imageHeight / 2, 72);
  return {
    left: left + window.scrollX,
    top: top + window.scrollY,
    width,
    origin: `${rect.left + rect.width / 2 - left}px ${rect.top + rect.height / 2 - top}px`,
    scale: rect.width / width,
  };
}

function PreviewCard({
  title,
  progress,
  placement,
  shown,
  onLeave,
}: {
  title: TitleSummary;
  progress?: Progress;
  placement: Placement;
  shown: boolean;
  onLeave: () => void;
}) {
  const image =
    tmdbImage(title.backdropPath, "w780") ??
    tmdbImage(title.posterPath, "w500");
  const logo = tmdbImage(title.logoPath ?? null, "w500");
  const left = progress ? timeLeft(progress) : null;
  return (
    <div
      onPointerLeave={onLeave}
      style={{
        left: placement.left,
        top: placement.top,
        width: placement.width,
        transformOrigin: placement.origin,
        transform: shown ? "none" : `scale(${placement.scale})`,
        opacity: shown ? 1 : 0,
      }}
      className="absolute z-50 overflow-hidden rounded-md bg-raised shadow-[0_12px_40px_rgb(0_0_0/0.7)] transition-[transform,opacity] duration-200 ease-out"
    >
      <Link
        href={`/title/${title.id}`}
        tabIndex={-1}
        className="relative block aspect-video bg-lift"
      >
        {image ? (
          <img
            src={image}
            alt=""
            className={`size-full object-cover ${title.backdropPath ? "" : "object-top"}`}
          />
        ) : null}
        <div className="absolute inset-0 bg-[linear-gradient(0deg,rgb(21_20_18/0.85),transparent_55%)]" />
        <div className="absolute inset-x-3 bottom-2.5">
          {logo ? (
            <img
              src={logo}
              alt={title.title}
              className="max-h-12 max-w-[60%] object-contain object-left-bottom drop-shadow-lg"
            />
          ) : (
            <p className="line-clamp-2 font-display text-2xl leading-none">
              {title.title}
            </p>
          )}
        </div>
      </Link>
      <div className="space-y-2.5 p-3.5 pt-3 text-[0.8rem]">
        <div className="flex items-center gap-2">
          <Link
            href={playHref(title.id, progress)}
            aria-label={`Play ${title.title}`}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-paper text-ink transition-colors hover:bg-paper/80"
          >
            <Play
              className="size-4 translate-x-px fill-current"
              strokeWidth={0}
            />
          </Link>
          <MyListButton titleId={title.id} size="sm" />
          <Link
            href={`/title/${title.id}`}
            aria-label={`More about ${title.title}`}
            title="More info"
            className="ml-auto grid size-8 shrink-0 place-items-center rounded-full border-2 border-paper/60 text-paper transition-colors hover:border-paper"
          >
            <ChevronDown className="size-4" strokeWidth={2.5} />
          </Link>
        </div>
        {progress ? (
          <div className="flex items-center gap-2.5">
            <ProgressBar share={progressShare(progress)} className="flex-1" />
            {left ? (
              <span className="shrink-0 text-paper/70">{left}</span>
            ) : null}
          </div>
        ) : null}
        <MetaRow title={title} className="text-paper/80" />
        {title.overview ? (
          <p className="line-clamp-3 leading-snug text-paper/75">
            {title.overview}
          </p>
        ) : null}
        {title.genres.length > 0 ? (
          <Dotted items={title.genres.slice(0, 3)} className="text-paper/90" />
        ) : null}
      </div>
    </div>
  );
}

/**
 * Netflix's hover card: after a short pause over a tile, a larger card with
 * Play, My List and the facts grows out of it. Mouse only — touch taps the
 * tile, and a remote opens the details modal with OK.
 */
export function Previewable({
  title,
  progress,
  className = "",
  children,
}: {
  title: TitleSummary;
  progress?: Progress;
  className?: string;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [shown, setShown] = useState(false);
  const pathname = usePathname();

  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setShown(false);
    timer.current = window.setTimeout(() => setPlacement(null), CLOSE_MS);
  }, []);

  useEffect(() => {
    void pathname;
    window.clearTimeout(timer.current);
    setShown(false);
    setPlacement(null);
  }, [pathname]);

  useEffect(() => {
    if (!placement) return;
    const frame = requestAnimationFrame(() => setShown(true));
    const dismiss = () => close();
    window.addEventListener("scroll", dismiss, {
      capture: true,
      passive: true,
    });
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", dismiss, { capture: true });
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [placement, close]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const enter = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse" || placement) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect || !anchor.current?.matches(":hover")) return;
      closeOpenCard?.();
      closeOpenCard = close;
      setPlacement(place(rect));
    }, OPEN_DELAY_MS);
  };

  const leave = () => {
    if (!placement) window.clearTimeout(timer.current);
  };

  return (
    <div
      ref={anchor}
      onPointerEnter={enter}
      onPointerLeave={leave}
      className={className}
    >
      {children}
      {placement
        ? createPortal(
            <PreviewCard
              title={title}
              progress={progress}
              placement={placement}
              shown={shown}
              onLeave={close}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
