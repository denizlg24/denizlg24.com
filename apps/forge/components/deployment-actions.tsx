"use client";

import { isDeploymentLive } from "@repo/cloud-ui/deploy-status";
import type { DeploymentKind, DeploymentStatus } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { TypedConfirmDialog } from "@repo/ui/typed-confirm-dialog";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";

export interface DeploymentActionTarget {
  id: string;
  status: DeploymentStatus;
  kind: DeploymentKind;
}

/**
 * Every action a single deployment offers, gated on the state the API will
 * accept it in. Showing a button that always 409s is worse than hiding it: the
 * useful fact is that this run cannot be retried, not that the attempt failed.
 */
export function DeploymentActions({
  deployment,
  onDone,
  showDelete = false,
}: {
  deployment: DeploymentActionTarget;
  onDone: () => Promise<unknown> | void;
  /** Only where a removed row does not leave the page showing a 404 of itself. */
  showDelete?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const live = isDeploymentLive(deployment.status);

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

  return (
    <div className="flex flex-wrap items-center gap-1">
      {live && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run("Cancelled", () => api.deploy.cancel(deployment.id))
          }
        >
          cancel
        </Button>
      )}
      {/* A ready preview takes over the production names without rebuilding.
          Production is already there, so promoting it is a no-op. */}
      {!live &&
        deployment.status === "ready" &&
        deployment.kind !== "production" && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run("Promoted", async () => {
                const { warning } = await api.deploy.promote(deployment.id);
                // A 202 with a warning means the row says production and the
                // agent never confirmed the route change — silently reporting
                // success would hide a half-promoted deployment.
                if (warning) toast.warning(warning);
              })
            }
          >
            promote
          </Button>
        )}
      {!live && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run("Rebuilding this commit", () =>
              api.deploy.rollback(deployment.id),
            )
          }
        >
          rollback
        </Button>
      )}
      {!live && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            void run("Retrying", () => api.deploy.retry(deployment.id))
          }
        >
          retry
        </Button>
      )}
      {showDelete && !live && (
        <TypedConfirmDialog
          title="Delete deployment"
          keyword={deployment.id.slice(0, 8)}
          actionLabel="Delete"
          onConfirm={() =>
            run("Deleted", () => api.deploy.remove(deployment.id))
          }
          trigger={
            <Button variant="ghost" size="sm" disabled={busy}>
              delete
            </Button>
          }
        />
      )}
    </div>
  );
}
