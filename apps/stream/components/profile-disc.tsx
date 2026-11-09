import type { ProfileColor } from "@repo/schemas/stream";

export const PROFILE_TONES: Record<ProfileColor, string> = {
  ember: "bg-ember",
  tide: "bg-tide",
  moss: "bg-moss",
  dusk: "bg-dusk",
  sand: "bg-sand",
  rose: "bg-rose",
};

const SIZES = {
  xs: "size-7 rounded-[4px] text-sm",
  sm: "size-8 rounded-[4px] text-base",
  md: "size-14 rounded-md text-2xl",
  lg: "size-[clamp(5.5rem,11vw,10rem)] rounded-md text-[clamp(2.5rem,5vw,4.5rem)]",
} as const;

/** A profile's avatar: its initial on its colour, square like a tile. */
export function ProfileDisc({
  name,
  color,
  size = "sm",
  className = "",
}: {
  name: string;
  color: ProfileColor;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center font-display text-ink ${PROFILE_TONES[color]} ${SIZES[size]} ${className}`}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}
