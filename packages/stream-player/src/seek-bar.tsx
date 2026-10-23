import { type PointerEvent, useRef, useState } from "react";
import { cx, disabledLook, focusRing } from "./styles";
import { clamp, formatTime, type Range, spokenTime } from "./time";

export interface SeekBarProps {
  currentTime: number;
  duration: number;
  buffered: readonly Range[];
  disabled: boolean;
  onSeek: (seconds: number) => void;
  onScrubChange: (scrubbing: boolean) => void;
}

export function SeekBar({
  currentTime,
  duration,
  buffered,
  disabled,
  onSeek,
  onScrubChange,
}: SeekBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);

  const played = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
  const position = scrub ?? played;
  const tip = scrub ?? hover ?? (focused ? played : null);

  const fractionAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrub(fractionAt(event.clientX));
    onScrubChange(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0) return;
    const fraction = fractionAt(event.clientX);
    if (scrub !== null) setScrub(fraction);
    if (event.pointerType === "mouse") setHover(fraction);
  };

  const endScrub = (commit: boolean) => {
    if (scrub === null) return;
    if (commit) onSeek(scrub * duration);
    setScrub(null);
    onScrubChange(false);
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${spokenTime(currentTime)} of ${spokenTime(duration)}`}
      aria-disabled={disabled || undefined}
      data-player-nav=""
      data-player-role="seek"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endScrub(true)}
      onPointerCancel={() => endScrub(false)}
      onPointerLeave={() => setHover(null)}
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      className={cx(
        "group/seek relative flex h-8 flex-1 cursor-pointer touch-none items-center rounded-full lg:h-10",
        focusRing,
        disabledLook,
      )}
    >
      <div
        ref={trackRef}
        className="relative h-1 w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-hover/seek:h-1.5 group-focus-visible/seek:h-2 group-aria-disabled/seek:h-1 lg:h-1.5 lg:group-focus-visible/seek:h-2.5"
      >
        {duration > 0 &&
          buffered.map(([start, end]) => (
            <div
              key={`${start}-${end}`}
              className="absolute inset-y-0 bg-white/35"
              style={{
                left: `${(start / duration) * 100}%`,
                width: `${((end - start) / duration) * 100}%`,
              }}
            />
          ))}
        <div
          className="absolute inset-y-0 left-0 bg-white"
          style={{ width: `${position * 100}%` }}
        />
      </div>
      {duration > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 scale-0 rounded-full bg-white transition-transform group-hover/seek:scale-100 group-focus-visible/seek:scale-125 lg:size-4"
          style={{ left: `${position * 100}%` }}
        />
      )}
      {tip !== null && duration > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded bg-black/80 px-2 py-1 font-medium text-sm tabular-nums lg:text-lg"
          style={{ left: `${tip * 100}%` }}
        >
          {formatTime(tip * duration, duration)}
        </div>
      )}
    </div>
  );
}
