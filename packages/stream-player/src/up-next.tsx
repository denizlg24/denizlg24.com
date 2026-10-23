import type { Episode } from "@repo/schemas/stream";
import { Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { episodeLabel } from "./labels";
import { cx, focusRing } from "./styles";

export interface UpNextProps {
  episode: Episode;
  seconds: number;
  onPlay: () => void;
  onCancel: () => void;
}

export function UpNext({ episode, seconds, onPlay, onCancel }: UpNextProps) {
  const [remaining, setRemaining] = useState(seconds);
  const playRef = useRef<HTMLButtonElement>(null);
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;

  useEffect(() => {
    playRef.current?.focus({ preventScroll: true });
    const timer = setInterval(() => {
      setRemaining((value) => value - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (remaining <= 0) onPlayRef.current();
  }, [remaining]);

  const progress = seconds > 0 ? 1 - Math.max(remaining, 0) / seconds : 1;

  return (
    <section
      aria-label="Up next"
      className="absolute right-4 bottom-32 z-30 flex max-w-sm flex-col items-end gap-3 text-right sm:right-8 sm:bottom-36 lg:right-12 lg:bottom-48 lg:max-w-xl"
    >
      <p className="font-bold text-white/65 text-sm lg:text-lg">Up next</p>
      <p className="text-balance font-semibold text-white text-xl drop-shadow-md lg:text-4xl">
        {episodeLabel(episode)}
      </p>
      <p className="text-sm text-white/70 tabular-nums lg:text-xl">
        Starts in {Math.max(remaining, 0)} s
      </p>
      <div className="h-0.5 w-40 overflow-hidden rounded-full bg-white/20 lg:w-64">
        <div
          className="h-full bg-white transition-[width] duration-1000 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="mt-1 flex items-center gap-3">
        <button
          type="button"
          data-player-nav=""
          data-player-role="control"
          onClick={onCancel}
          className={cx(
            "rounded-full px-5 py-2.5 font-medium text-base text-white/80 hover:text-white lg:px-7 lg:py-3.5 lg:text-xl",
            focusRing,
          )}
        >
          Cancel
        </button>
        <button
          ref={playRef}
          type="button"
          data-player-nav=""
          data-player-role="control"
          onClick={onPlay}
          className={cx(
            "inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 font-medium text-base text-black hover:bg-white/90 lg:px-7 lg:py-3.5 lg:text-xl",
            focusRing,
          )}
        >
          <Play className="size-5 fill-black lg:size-6" />
          Play now
        </button>
      </div>
    </section>
  );
}
