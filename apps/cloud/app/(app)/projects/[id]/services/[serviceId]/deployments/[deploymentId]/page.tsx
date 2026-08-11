"use client";

import {
  DeploymentBadges,
  deploymentLabel,
  deploymentTone,
  isDeploymentLive,
  isDeploymentRetryable,
} from "@repo/cloud-ui/deploy-status";
import { formatBytes, formatRelative } from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { projectServiceHref } from "@/lib/project-routes";
import { BuildLog } from "../../_components/build-log";
import { RuntimeLog } from "../../_components/runtime-log";
import { useTarget } from "../../_components/target-context";

const LIVE_POLL_MS = 3_000;

export default function DeploymentPage() {
  const { target } = useTarget();
  const router = useRouter();
  const params = useParams<{ deploymentId: string }>();
  const deploymentId = params.deploymentId;
  const [busy, setBusy] = useState(false);

  const fetchDeployment = useCallback(
    () => api.deploy.deployment(deploymentId),
    [deploymentId],
  );
  const { data, error, loading, reload } = usePoll(
    fetchDeployment,
    LIVE_POLL_MS,
  );

  const act = useCallback(
    async (label: string, run: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await run();
        toast.success(label);
        await reload();
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  async function retry() {
    setBusy(true);
    try {
      const created = await api.deploy.retry(deploymentId);
      toast.success("Retry queued");
      router.push(
        projectServiceHref(
          target.projectId,
          target.id,
          `deployments/${created.id}`,
        ),
      );
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data && loading) return <Skeleton className="h-64 w-full" />;
  if (!data) return null;

  const live = isDeploymentLive(data.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href={projectServiceHref(target.projectId, target.id, "deployments")}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Deployments
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="flex items-center gap-2 text-sm">
            <StatusDot tone={deploymentTone(data.status)} label={data.status} />
            {deploymentLabel(data.status, data.phase)}
          </span>
          <DeploymentBadges kind={data.kind} status={data.status} />
          <span className="font-mono text-sm">{data.gitSha.slice(0, 7)}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {data.gitMessage ?? data.gitRef}
          </span>
          {data.status === "ready" && (
            <Button asChild variant="outline" size="sm">
              <a href={data.url} target="_blank" rel="noreferrer noopener">
                Visit
                <ArrowUpRight className="size-3" />
              </a>
            </Button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y py-4 text-xs sm:grid-cols-3 lg:grid-cols-4">
        <Fact label="hostname" value={data.hostname} />
        <Fact label="branch" value={data.gitRef} />
        <Fact label="triggered by" value={data.triggeredBy} />
        <Fact
          label="build time"
          value={
            data.buildDurationMs === null
              ? "—"
              : `${Math.round(data.buildDurationMs / 1000)}s`
          }
        />
        <Fact
          label="image size"
          value={
            data.imageSizeBytes === null
              ? "—"
              : formatBytes(data.imageSizeBytes)
          }
        />
        <Fact
          label="port"
          value={data.port === null ? "—" : String(data.port)}
        />
        <Fact label="created" value={formatRelative(data.createdAt)} />
        <Fact
          label="ready"
          value={data.readyAt === null ? "—" : formatRelative(data.readyAt)}
        />
        <Fact label="image" value={data.imageTag ?? "—"} mono />
      </dl>

      {/* The failure text lives in the build log accordion, beside the output
          that produced it. Repeating it here put the conclusion above the
          evidence and pushed the log itself below the fold. */}

      <div className="flex flex-wrap gap-2">
        {isDeploymentRetryable(data.status) && (
          // Same commit, same kind, same pull request — see the retry route.
          // Unlike every other action here this produces a different row, so
          // it navigates rather than reloading one that will never change.
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void retry()}
          >
            Retry
          </Button>
        )}
        {live && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void act("Cancelled", () => api.deploy.cancel(data.id))
            }
          >
            Cancel
          </Button>
        )}
        {data.status === "ready" && data.kind === "preview" && (
          // Promote does not rebuild — the image is already live and healthy,
          // so this only changes which names route.
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void act("Promoted", async () => {
                const result = await api.deploy.promote(data.id);
                // The row says production and Caddy may not. A second promote
                // is idempotent; silence is not.
                if (result.warning) toast.warning(result.warning);
              })
            }
          >
            Promote
          </Button>
        )}
        {data.status === "ready" && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void act("Restarted", () => api.deploy.restart(data.id))
            }
          >
            Restart
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void act("Rollback queued", () => api.deploy.rollback(data.id))
          }
        >
          Rollback to this
        </Button>
        {/* Its own trigger, alongside the other actions. The build log stays
            inline below because it is a record of this deployment; runtime
            output is a live tail that belongs in a panel over the page. */}
        <RuntimeLog deployment={data} />
      </div>

      <BuildLog deployment={data} />
    </div>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "truncate font-mono" : "truncate"}>{value}</dd>
    </div>
  );
}
