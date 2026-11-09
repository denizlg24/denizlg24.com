import { Play } from "lucide-react";

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-display text-[1.75rem] leading-none font-black whitespace-nowrap uppercase ${className}`}
    >
      <Play
        className="size-[0.62em] fill-amber text-amber"
        strokeWidth={0}
        aria-hidden
      />
      Stream
    </span>
  );
}
