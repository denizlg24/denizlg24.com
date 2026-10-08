import { cn } from "@repo/ui/utils";
import Image from "next/image";

export function Wordmark({
  className,
  size = "default",
}: {
  className?: string;
  size?: "default" | "large";
}) {
  const large = size === "large";
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image
        src="/icon.png"
        alt=""
        width={large ? 40 : 22}
        height={large ? 40 : 22}
        unoptimized
        className="shrink-0 rounded-[22.5%] shadow-[0_0_0_0.5px_rgb(0_0_0/0.12)] dark:shadow-[0_0_0_0.5px_rgb(255_255_255/0.16)]"
      />
      <span
        className={cn(
          "flex items-baseline gap-1.5 whitespace-nowrap tracking-tight",
          large ? "text-xl" : "text-sm",
        )}
      >
        <span className="font-semibold text-accent-strong">Macros</span>
        <span className="text-muted-foreground">moderation</span>
      </span>
    </span>
  );
}
