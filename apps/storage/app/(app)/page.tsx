"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useRoots, userRootId } from "@/lib/store";

/** The browser always lives under a folder id; "/" resolves the user's root. */
export default function HomePage() {
  const router = useRouter();
  const roots = useRoots();
  const rootId = userRootId(roots);

  useEffect(() => {
    if (rootId) router.replace(`/folders/${rootId}`);
  }, [rootId, router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
    </div>
  );
}
