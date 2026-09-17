"use client";

import { Button } from "@repo/ui/button";
import Link from "next/link";
import { useEffect } from "react";
import { Shell } from "@/components/shell";
import { PageIntro } from "@/components/shell-frame";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Shell>
      <PageIntro
        title="Something went wrong"
        description="The page hit an error it couldn't recover from. Trying again usually fixes it."
      />
      <p className="max-w-prose break-words font-mono text-xs text-muted-foreground">
        {error.message}
        {error.digest ? ` · ${error.digest}` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Go to Account</Link>
        </Button>
      </div>
    </Shell>
  );
}
