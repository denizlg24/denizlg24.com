"use client";

import { useRef } from "react";

/**
 * A tuner band: ticks along a track and a glowing needle. It is an ARIA
 * slider, so ←/→ turn it, and it claims those keys from the spatial nav.
 * `range` adds a second needle; the one nearer the pointer moves.
 */
export function Dial({
  label,
  options,
  value,
  onChange,
  range,
}: {
  label: string;
  options: string[];
  value: number;
  onChange: (index: number) => void;
  range?: { value: number; onChange: (index: number) => void };
}) {
  const track = useRef<HTMLDivElement>(null);
  const last = options.length - 1;
  const position = (index: number) => `${(index / last) * 100}%`;

  const indexAt = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return value;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * last);
  };

  const setFromPointer = (clientX: number) => {
    const index = indexAt(clientX);
    if (range && Math.abs(index - range.value) < Math.abs(index - value)) {
      range.onChange(Math.max(index, value));
    } else {
      onChange(range ? Math.min(index, range.value) : index);
    }
  };

  const needle = (index: number, own: boolean) => (
    <span
      aria-hidden
      className={`absolute top-1/2 h-9 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-200 ease-out ${own ? "bg-amber shadow-[0_0_14px_3px_rgba(242,181,74,0.55)]" : "bg-amber/70"}`}
      style={{ left: position(index) }}
    />
  );

  const thumb = (
    index: number,
    set: (next: number) => void,
    min: number,
    max: number,
    name: string,
  ) => (
    <div
      role="slider"
      tabIndex={0}
      data-nav
      data-nav-own="left right"
      aria-label={name}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={index}
      aria-valuetext={options[index]}
      onKeyDown={(event) => {
        const next = {
          ArrowLeft: Math.max(min, index - 1),
          ArrowRight: Math.min(max, index + 1),
          Home: min,
          End: max,
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        set(next);
      }}
      className="absolute inset-y-0 w-8 -translate-x-1/2 rounded-md focus-visible:outline-offset-0"
      style={{ left: position(index) }}
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[0.95rem] font-bold text-paper/70">{label}</span>
        <span className="font-display text-3xl text-paper">
          {range
            ? value === 0 && range.value === last
              ? "Any"
              : `${options[value]} – ${options[range.value]}`
            : options[value]}
        </span>
      </div>
      <div
        ref={track}
        className="relative h-12 cursor-pointer touch-none select-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setFromPointer(event.clientX);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) setFromPointer(event.clientX);
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-px bg-hairline" />
        {range ? (
          <div
            className="absolute top-1/2 h-px bg-amber/50"
            style={{
              left: position(value),
              width: `${((range.value - value) / last) * 100}%`,
            }}
          />
        ) : null}
        {options.map((option, index) => {
          const major =
            options.length <= 8 || index % 2 === 0 || index === last;
          return (
            <span
              key={option}
              aria-hidden
              className={`absolute top-1/2 w-px -translate-x-1/2 bg-paper/25 ${major ? "h-4 -translate-y-1/2" : "h-2 -translate-y-1/2"}`}
              style={{ left: position(index) }}
            />
          );
        })}
        {needle(value, true)}
        {range ? needle(range.value, true) : null}
        {thumb(
          value,
          onChange,
          0,
          range ? range.value : last,
          range ? `${label} from` : label,
        )}
        {range
          ? thumb(range.value, range.onChange, value, last, `${label} to`)
          : null}
      </div>
      <div aria-hidden className="relative h-4 text-xs text-paper/40">
        {options.map((option, index) =>
          options.length <= 8 || index % 3 === 0 || index === last ? (
            <span
              key={option}
              className="absolute -translate-x-1/2 whitespace-nowrap first:translate-x-0 last:-translate-x-full"
              style={{ left: position(index) }}
            >
              {option}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
