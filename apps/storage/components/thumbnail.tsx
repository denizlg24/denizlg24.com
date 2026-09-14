"use client";

import { cn } from "@repo/ui/utils";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

/**
 * A file shown as itself. Asks the server for the WebP and falls back to the
 * kind's glyph when it answers 404 (a codec vips cannot decode, a corrupt
 * file) or 503 (the generator is saturated; the next scroll asks again). The
 * URL carries the file's version, so the browser cache never goes stale.
 */
export function Thumbnail({
  src,
  alt,
  fallback: Fallback,
  className,
  iconClassName,
  sizes,
}: {
  src: string | null;
  alt: string;
  fallback: LucideIcon;
  className?: string;
  iconClassName?: string;
  sizes?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = src !== null && failed !== src;
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-lg bg-muted/40",
        className,
      )}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt}
          sizes={sizes}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-contain"
          onError={() => setFailed(src)}
        />
      ) : (
        <Fallback
          className={cn("text-muted-foreground", iconClassName)}
          strokeWidth={1.5}
        />
      )}
    </div>
  );
}
