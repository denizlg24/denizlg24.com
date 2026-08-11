"use client";

import type { Deployment } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

/**
 * The three actions the production panel offers.
 *
 * Redeploy and Instant Rollback are the same endpoint aimed at different rows —
 * it rebuilds a deployment's SHA as production, so pointing it at the live one
 * rebuilds the current commit and pointing it at the one before rolls back. It
 * is a rebuild rather than a resurrection because the old image may have been
 * reaped, which is why "instant" is Vercel's word and not used here.
 */
export function ProductionActions({
  production,
  previous,
  paused,
  onDone,
}: {
  production: Deployment | null;
  /** The ready production deployment before the live one, if there is one. */
  previous: Deployment | null;
  /**
   * A paused target refuses every enqueue server-side, so both rebuilds are
   * disabled rather than left to fail. `visit` stays: the hostname is still
   * the project's, it just has nothing behind it.
   */
  paused: boolean;
  onDone: () => Promise<unknown> | void;
}) {
  const [busy, setBusy] = useState(false);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      toast.success(label);
      await onDone();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!production) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button asChild variant="outline" size="sm">
        <a href={production.url} target="_blank" rel="noreferrer noopener">
          visit
          <ArrowUpRight className="size-3" />
        </a>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy || paused}
        onClick={() =>
          void run("Redeploying this commit", () =>
            api.deploy.rollback(production.id),
          )
        }
      >
        redeploy
      </Button>
      {previous && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || paused}
          onClick={() =>
            void run(`Rolling back to ${previous.gitSha.slice(0, 7)}`, () =>
              api.deploy.rollback(previous.id),
            )
          }
        >
          rollback
        </Button>
      )}
    </div>
  );
}
