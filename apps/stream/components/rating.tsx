import { Star } from "lucide-react";

export function Rating({
  value,
  className = "",
}: {
  value: number | null;
  className?: string;
}) {
  if (!value) return null;
  return (
    <span
      className={`relative inline-flex items-center gap-1 text-amber ${className}`}
    >
      <Star className="size-[0.9em] fill-current" strokeWidth={0} aria-hidden />
      <span className="sr-only">Rated </span>
      {value.toFixed(1)}
      <span className="sr-only"> out of 10</span>
    </span>
  );
}
