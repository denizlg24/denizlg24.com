"use client";

import { Button } from "@repo/ui/button";
import { Spinner } from "@repo/ui/spinner";
import { RotateCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RefreshButton({ label = "Retry" }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      {pending ? <Spinner className="size-3.5" /> : <RotateCw />}
      {label}
    </Button>
  );
}
