"use client";

import { Button } from "@repo/ui/button";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useRootsState, userRootId } from "@/lib/store";

/** The browser always lives under a folder id; "/" resolves the user's root. */
export default function HomePage() {
  const router = useRouter();
  const { roots, error, reload } = useRootsState();
  const rootId = userRootId(roots);

  useEffect(() => {
    if (rootId) router.replace(`/folders/${rootId}`);
  }, [rootId, router]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <div>
          <p className="text-sm font-medium">Can't load your folders</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
    </div>
  );
}
