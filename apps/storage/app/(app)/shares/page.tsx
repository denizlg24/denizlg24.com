"use client";

import { Link2 } from "lucide-react";

export default function SharesPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-4 pb-3 pt-3 md:px-6">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
          Shared links
        </h1>
        <p className="text-sm text-muted-foreground">
          Every link you have created, and a way to stop sharing.
        </p>
      </div>
      <div className="flex flex-col items-center gap-3 px-4 py-20 text-center">
        <Link2 className="size-10 text-muted-foreground/70" strokeWidth={1.5} />
        <p className="text-base font-medium">No links yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Share a file from its menu and the link will be listed here.
        </p>
      </div>
    </div>
  );
}
