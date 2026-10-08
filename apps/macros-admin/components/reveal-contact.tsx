"use client";

import { Button } from "@repo/ui/button";
import { CopyButton } from "@repo/ui/copy-button";
import { Spinner } from "@repo/ui/spinner";
import { Mail } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { revealContactAction } from "@/lib/actions";

export function RevealContact({ userId }: { userId: string }) {
  const [email, setEmail] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (email) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1">
          <a
            href={`mailto:${email}`}
            title={email}
            className="min-w-0 truncate rounded-sm font-mono text-sm text-accent-strong underline decoration-border underline-offset-4 outline-none hover:decoration-accent-strong focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {email}
          </a>
          <CopyButton value={email} label="Copy email" />
        </div>
        <p className="text-xs text-muted-foreground">Reveal logged.</p>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-fit"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await revealContactAction(userId);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          setEmail(result.data.email);
        })
      }
    >
      {pending ? <Spinner className="size-3.5" /> : <Mail />}
      Reveal email
    </Button>
  );
}
