"use client";

import type { ProfileColor } from "@repo/schemas/stream";
import { Circle, Hand, LocateFixed, Minus, Plus, Star } from "lucide-react";
import type { ReactNode } from "react";

import { ProfileDisc } from "@/components/profile-disc";

import type { MapKind } from "./region-store";

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-nav
      aria-label={label}
      title={label}
      className="grid size-10 place-items-center rounded-full text-muted transition-colors hover:bg-raised/70 hover:text-paper"
    >
      {children}
    </button>
  );
}

const KINDS: { value: MapKind | null; label: string }[] = [
  { value: "movie", label: "Films" },
  { value: "series", label: "Series" },
  { value: null, label: "Both" },
];

export function MapControls({
  kind,
  onKind,
  onZoomIn,
  onZoomOut,
  onFindUs,
}: {
  kind: MapKind | null;
  onKind: (kind: MapKind | null) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFindUs: () => void;
}) {
  return (
    <div className="absolute right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex flex-col items-end gap-3 md:right-8 md:bottom-8">
      <div className="flex flex-col items-center">
        <IconButton label="Zoom in" onClick={onZoomIn}>
          <Plus className="size-5" strokeWidth={1.5} />
        </IconButton>
        <IconButton label="Zoom out" onClick={onZoomOut}>
          <Minus className="size-5" strokeWidth={1.5} />
        </IconButton>
        <IconButton label="Find us" onClick={onFindUs}>
          <LocateFixed className="size-5" strokeWidth={1.5} />
        </IconButton>
      </div>
      <fieldset className="flex items-center gap-1 text-xs">
        <legend className="sr-only">Show</legend>
        {KINDS.map((option) => {
          const active = option.value === kind;
          return (
            <button
              key={option.label}
              type="button"
              data-nav
              aria-pressed={active}
              onClick={() => onKind(option.value)}
              className={`rounded-full px-2.5 py-1 transition-colors ${active ? "text-amber" : "text-muted hover:text-paper"}`}
            >
              {option.label}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}

export function MapHint() {
  return (
    <p className="pointer-events-none absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-5 z-20 flex items-center gap-2 text-paper/45 text-sm md:bottom-8 md:left-10">
      <Hand className="size-4" strokeWidth={1.75} aria-hidden />
      <span className="pointer-coarse:hidden">
        Drag to explore, scroll to zoom
      </span>
      <span className="hidden pointer-coarse:inline">
        Drag to explore, pinch to zoom
      </span>
    </p>
  );
}

export function AudienceLegend({
  audience,
}: {
  audience: readonly { id: string; name: string; color: ProfileColor }[];
}) {
  return (
    <div className="pointer-events-none absolute top-20 left-5 z-20 space-y-2 text-muted text-sm md:left-10">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {audience.map((profile) => (
          <li key={profile.id} className="flex items-center gap-2">
            <ProfileDisc name={profile.name} color={profile.color} size="xs" />
            <span>{profile.name}</span>
          </li>
        ))}
      </ul>
      <div aria-hidden className="flex gap-4 text-paper/55">
        <span className="flex items-center gap-1.5">
          <Star className="size-3.5 fill-amber text-amber" strokeWidth={0} />
          watched
        </span>
        <span className="flex items-center gap-1.5">
          <Star className="size-3.5 text-amber" strokeWidth={2} />
          saved
        </span>
        <span className="flex items-center gap-1.5">
          <Circle className="size-3.5 text-amber" strokeWidth={2} />
          picked
        </span>
      </div>
    </div>
  );
}
