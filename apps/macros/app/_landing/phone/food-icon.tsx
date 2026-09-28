"use client";

import { cn } from "@repo/ui/utils";
import { CookingPot } from "lucide-react";
import { useEffect, useRef, useState } from "react";

function GlyphTile({ size }: { size: number }) {
  return (
    <span
      className="flex flex-none items-center justify-center rounded-[8px] bg-ios-tertiary-fill text-ios-secondary"
      style={{ width: size, height: size }}
    >
      <CookingPot size={size * 0.5} strokeWidth={2} />
    </span>
  );
}

/**
 * The app's food icon: the illustrated PNG, held by a placeholder tile of the
 * same size until it has loaded, the recipe glyph when there is none or it
 * fails. Without scripting the picture is simply shown.
 */
export function IosFoodIcon({
  iconKey,
  size = 36,
  eager = false,
}: {
  iconKey: string | null;
  size?: number;
  /** For icons on screen at first paint, which should not wait for layout. */
  eager?: boolean;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );

  // A picture that arrived before hydration fired its load event before React
  // was listening, so the element is asked directly.
  useEffect(() => {
    const element = image.current;
    if (element?.complete) {
      setStatus(element.naturalWidth > 0 ? "loaded" : "failed");
    }
  }, []);

  if (!iconKey || status === "failed") return <GlyphTile size={size} />;

  const loaded = status === "loaded";
  return (
    <span
      className="relative block flex-none overflow-hidden"
      style={{ width: size, height: size }}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 rounded-[8px] bg-ios-tertiary-fill transition-opacity duration-200 noscript:hidden",
          loaded && "opacity-0",
        )}
      />
      <img
        ref={image}
        src={`/food-icons/${iconKey}.png`}
        alt=""
        width={size}
        height={size}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setStatus("loaded")}
        onError={() => setStatus("failed")}
        className={cn(
          "relative size-full scale-[1.3] object-contain transition-opacity duration-200 noscript:opacity-100",
          !loaded && "opacity-0",
        )}
      />
    </span>
  );
}
