import { Button } from "@repo/ui/button";
import Link from "next/link";

import { Wordmark } from "@/components/wordmark";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 pb-24">
      <Wordmark size="large" />
      <div className="flex flex-col items-center gap-3">
        <h1 className="text-base font-medium text-accent-strong">
          Not found <span className="font-mono text-muted-foreground">404</span>
        </h1>
        <Button asChild variant="outline" size="sm">
          <Link href="/">Overview</Link>
        </Button>
      </div>
    </main>
  );
}
