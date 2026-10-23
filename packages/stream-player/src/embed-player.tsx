"use client";

import {
  type EmbedProgress,
  embedPlayerUrl,
  parseEmbedProgress,
} from "@repo/schemas/stream";
import { ArrowLeft, Check, RotateCw, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { StreamPlayerProps } from "./stream-player";
import { formatTime } from "./time";
import { UpNext } from "./up-next";

export function EmbedPlayer({
  playback,
  title,
  subtitle,
  onBack,
  onNext,
  onViewing,
  onProgress,
  autoPlay = true,
  nextCountdownS = 10,
}: StreamPlayerProps) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<EmbedProgress | null>(null);
  const [completed, setCompleted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const started = useRef(false);
  const restored = useRef(false);
  const lastSent = useRef(0);
  const latest = useRef({ onProgress, progress, completed });
  latest.current = { onProgress, progress, completed };
  const url = embedPlayerUrl(playback.embed!.url, autoPlay);

  useEffect(() => {
    const origin = new URL(url).origin;
    const receive = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        event.origin !== origin
      )
        return;
      const update = parseEmbedProgress(event.data, playback.embed!.url);
      if (!update) return;
      if (!restored.current) {
        restored.current = true;
        const resume = playback.resume;
        if (
          resume &&
          !resume.completed &&
          resume.positionS >= 30 &&
          resume.positionS < update.duration - 10
        ) {
          iframe.current?.contentWindow?.postMessage(
            { player: true, action: `seek${Math.floor(resume.positionS)}` },
            origin,
          );
          return;
        }
      }
      setProgress(update);
      if (update.status === "completed") setCompleted(true);
      else if (
        (update.status === "playing" || update.status === "seeked") &&
        update.position < update.duration - 2
      ) {
        setCompleted(false);
        setDismissed(false);
      }
      const now = Date.now();
      if (update.status !== "playing" || now - lastSent.current >= 10_000) {
        lastSent.current = now;
        latest.current.onProgress?.(update.position, update.duration);
      }
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      const value = latest.current.progress;
      if (value && !latest.current.completed)
        latest.current.onProgress?.(value.position, value.duration);
    };
  }, [url, playback.embed, playback.resume]);

  const save = async () => {
    if (!onViewing) return;
    setSaving(true);
    try {
      if (await onViewing(true)) {
        setCompleted(true);
        setDismissed(false);
        setError("");
      } else setError("Couldn't mark this watched. Try again.");
    } catch {
      setError("Couldn't mark this watched. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-black text-paper">
      <header className="flex shrink-0 items-center gap-4 px-4 py-3">
        <button
          type="button"
          data-nav
          onClick={onBack}
          aria-label="Back to title"
          className="rounded-full p-3 hover:bg-paper/10"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold">{title}</h1>
          {subtitle ? (
            <p className="truncate text-sm text-paper/70">{subtitle}</p>
          ) : null}
        </div>
        <button
          type="button"
          data-nav
          onClick={() => {
            restored.current = false;
            setAttempt((value) => value + 1);
          }}
          className="flex items-center gap-2 rounded-full px-3 py-2 hover:bg-paper/10"
        >
          <RotateCw className="size-4" />
          <span>Reload player</span>
        </button>
      </header>
      {/* Keep popup and top-navigation restrictions even when a provider rejects them. */}
      <iframe
        ref={iframe}
        key={`${url}:${attempt}`}
        src={url}
        title={subtitle ? `${title}: ${subtitle}` : title}
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        sandbox="allow-scripts allow-same-origin allow-presentation"
        referrerPolicy="strict-origin-when-cross-origin"
        className="min-h-0 w-full flex-1 border-0"
        onLoad={() => {
          if (!started.current) {
            started.current = true;
            void onViewing?.(false)
              .then((ok) => {
                if (!ok)
                  setError(
                    "Your progress couldn't be saved. Try reloading the player.",
                  );
              })
              .catch(() =>
                setError(
                  "Your progress couldn't be saved. Try reloading the player.",
                ),
              );
          }
        }}
      />
      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 px-4 py-2 text-sm">
        {progress ? (
          <span className="mr-auto text-paper/70 tabular-nums">
            {formatTime(progress.position)} / {formatTime(progress.duration)}
          </span>
        ) : null}
        {error ? (
          <p role="alert" className="mr-auto">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          data-nav
          disabled={saving || completed}
          onClick={() => void save()}
          className="flex items-center gap-2 rounded-full px-4 py-2 hover:bg-paper/10 disabled:opacity-50"
        >
          <Check className="size-4" />
          {completed ? "Watched" : "Mark watched"}
        </button>
        {playback.next && onNext ? (
          <button
            type="button"
            data-nav
            disabled={saving}
            onClick={() => onNext(playback.next!)}
            className="flex items-center gap-2 rounded-full px-4 py-2 hover:bg-paper/10 disabled:opacity-50"
          >
            <SkipForward className="size-4" />
            Next episode
          </button>
        ) : null}
      </footer>
      {completed && !dismissed && playback.next && onNext ? (
        <UpNext
          episode={playback.next}
          seconds={nextCountdownS}
          onPlay={() => onNext(playback.next!)}
          onCancel={() => setDismissed(true)}
          className="absolute right-4 bottom-20 z-30 flex max-w-[calc(100%-2rem)] flex-col items-end gap-3 rounded-xl bg-ink/95 p-5 text-right sm:right-8 sm:max-w-sm"
        />
      ) : null}
    </div>
  );
}
