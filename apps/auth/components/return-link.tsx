"use client";

import { ArrowLeft } from "lucide-react";
import { hostOf } from "@/components/account-parts";
import { useReturnLink } from "@/lib/return-link";

/** "Back to {app}" over the page, when an app sent the visitor here. */
export function ReturnLinkLine() {
  const link = useReturnLink();
  if (!link) return null;
  return (
    <a
      href={link.url}
      className="-mb-3 inline-flex w-fit max-w-full items-center gap-2 rounded-sm text-sm text-muted-foreground outline-none transition-colors hover:text-accent-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">
        Back to <span className="text-accent-strong">{link.name}</span>
      </span>
      <span className="hidden truncate font-mono text-xs sm:inline">
        {hostOf(link.url)}
      </span>
    </a>
  );
}
