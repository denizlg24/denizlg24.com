"use client";

import { PROFILE_COLORS, type ProfileColor } from "@repo/schemas/stream";
import { Check } from "lucide-react";

import { PROFILE_TONES } from "@/components/profile-disc";

export function ColorChoice({
  value,
  onChange,
}: {
  value: ProfileColor;
  onChange: (color: ProfileColor) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-3">
      {PROFILE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          data-nav
          onClick={() => onChange(color)}
          className={`grid size-12 place-items-center rounded-full transition-transform ${PROFILE_TONES[color]} ${value === color ? "scale-110 ring-2 ring-paper ring-offset-4 ring-offset-ink" : "opacity-70 hover:opacity-100"}`}
        >
          {value === color ? (
            <Check className="size-5 text-ink" strokeWidth={2.5} />
          ) : null}
        </button>
      ))}
    </div>
  );
}
