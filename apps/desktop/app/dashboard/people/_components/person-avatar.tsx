import Image from "next/image";
import { cn } from "@/lib/utils";

export function personInitials(name: string | undefined) {
  if (!name) return "?";
  const words = name.trim().split(/\s+/);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

const SIZES = {
  xs: { box: "size-5 text-[9px]", px: 20 },
  sm: { box: "size-6 text-[10px]", px: 24 },
  lg: { box: "size-16 text-lg", px: 64 },
} as const;

export function PersonAvatar({
  photo,
  name,
  size = "sm",
  className,
}: {
  photo?: string;
  name?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { box, px } = SIZES[size];
  if (photo) {
    return (
      <Image
        src={photo}
        alt=""
        width={px}
        height={px}
        className={cn("shrink-0 rounded-full object-cover", box, className)}
        unoptimized
      />
    );
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-surface font-medium text-muted-foreground",
        box,
        className,
      )}
    >
      {personInitials(name)}
    </span>
  );
}
