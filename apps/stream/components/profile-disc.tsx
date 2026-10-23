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
  xs: "size-7 text-xs",
  sm: "size-9 text-sm",
  md: "size-14 text-xl",
  lg: "size-28 text-5xl md:size-36 md:text-6xl",
} as const;

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
      className={`inline-grid shrink-0 place-items-center rounded-full font-display text-ink ${PROFILE_TONES[color]} ${SIZES[size]} ${className}`}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}
