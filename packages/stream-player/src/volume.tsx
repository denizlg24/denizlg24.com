import { Volume1, Volume2, VolumeX } from "lucide-react";
import { type PointerEvent, useRef } from "react";
import { ControlButton } from "./control-button";
import { cx, disabledLook, focusRing, iconSize } from "./styles";
import { clamp } from "./time";

export interface VolumeControlProps {
  volume: number;
  muted: boolean;
  disabled: boolean;
  onVolume: (volume: number) => void;
  onToggleMute: () => void;
}

export function VolumeControl({
  volume,
  muted,
  disabled,
  onVolume,
  onToggleMute,
}: VolumeControlProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const level = muted ? 0 : volume;
  const Icon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2;
  const percent = Math.round(level * 100);

  const setFrom = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    onVolume(clamp((clientX - rect.left) / rect.width, 0, 1));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setFrom(event.clientX);
  };

  return (
    <div className="group/volume flex items-center">
      <ControlButton
        label={level === 0 ? "Unmute" : "Mute"}
        disabled={disabled}
        onClick={onToggleMute}
      >
        <Icon className={iconSize} />
      </ControlButton>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
        aria-disabled={disabled || undefined}
        data-player-nav=""
        data-player-role="volume"
        onPointerDown={onPointerDown}
        onPointerMove={(event) => {
          if (draggingRef.current) setFrom(event.clientX);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
        className={cx(
          "ml-1 hidden h-8 w-24 cursor-pointer touch-none items-center rounded-full px-1 sm:flex lg:h-10 lg:w-32",
          focusRing,
          disabledLook,
        )}
      >
        <div
          ref={trackRef}
          className="relative h-1 w-full rounded-full bg-white/25 lg:h-1.5"
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white"
            style={{ width: `${percent}%` }}
          />
          <div
            aria-hidden="true"
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white lg:size-3.5"
            style={{ left: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
