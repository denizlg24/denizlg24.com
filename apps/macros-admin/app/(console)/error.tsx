"use client";

import { Button } from "@repo/ui/button";
import { RotateCw } from "lucide-react";
import { useEffect } from "react";

export default function ConsoleError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-col items-start gap-4">
      <div className="flex w-full flex-col gap-1.5 border-b pb-5">
        <h1 className="text-xl font-semibold tracking-tight text-accent-strong sm:text-2xl">
          Something failed
        </h1>
        <p className="font-mono text-xs break-all text-muted-foreground">
          {error.digest ?? error.message}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => retry()}>
        <RotateCw />
        Retry
      </Button>
    </div>
  );
}
