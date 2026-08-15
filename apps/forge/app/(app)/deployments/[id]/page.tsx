"use client";

import {
  DeploymentBadges,
  deploymentLabel,
  deploymentTone,
  isDeploymentLive,
} from "@repo/cloud-ui/deploy-status";
import { ErrorBlock } from "@repo/cloud-ui/error-block";
import {
  formatBytes,
  formatDateTime,
  formatDurationMs,
  formatRelative,
} from "@repo/cloud-ui/format";
import { usePoll } from "@repo/cloud-ui/use-poll";
import type { DeploymentStatus } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { TypedConfirmDialog } from "@repo/ui/typed-confirm-dialog";
import { ArrowLeft, ExternalLink, RotateCw } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DeploymentActions } from "@/components/deployment-actions";
import { LogStream } from "@/components/log-stream";
import { PageHeading } from "@/components/page-heading";
import { PreviewShare } from "@/components/preview-share";
import { RequestExplorer } from "@/components/request-explorer";
import { api, errorMessage } from "@/lib/api";

export default function DeploymentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const fetchDeployment = useMemo(() => () => api.forge.deployment(id), [id]);
  const [restarting, setRestarting] = useState(false);
  const [live, setLive] = useState(true);
  const { data, error, reload } = usePoll(
    fetchDeployment,
    live ? 10_000 : null,
  );
  // A deployment that reached a terminal state never changes again.
  useEffect(() => {
    if (data) setLive(isDeploymentLive(data.status));
  }, [data]);

  const containerId = data?.containerId ?? "";
  const buildSubscribe = useMemo(
    () => (onLine: (line: string) => void, signal: AbortSignal) =>
      api.forge.streamBuildLogs(id, onLine, signal),
    [id],
  );
  const runtimeSubscribe = useMemo(
    () => (onLine: (line: string) => void, signal: AbortSignal) =>
      api.forge.streamLogs(containerId, onLine, signal),
    [containerId],
  );

  const restart = async () => {
    setRestarting(true);
    try {
      await api.forge.restart(id);
      toast.success("Deployment restarted");
      await reload();
    } catch (restartError) {
      toast.error(errorMessage(restartError));
    } finally {
      setRestarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title={data ? data.projectSlug : "deployment"}
        detail={data ? `${data.targetName} · ${id.slice(0, 8)}` : undefined}
      >
        <Button variant="ghost" size="sm" asChild>
          <Link href="/deployments">
            <ArrowLeft className="size-3.5" />
            deployments
          </Link>
        </Button>
      </PageHeading>

      {!data && !error ? <Skeleton className="h-64" /> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {data ? (
        <div className="flex flex-col gap-8">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="inline-flex items-center gap-1.5 text-sm">
              <StatusDot
                tone={deploymentTone(data.status)}
                label={data.status}
              />
              {deploymentLabel(data.status, data.phase)}
            </span>
            <DeploymentBadges kind={data.kind} status={data.status} />
            <span className="text-xs text-muted-foreground">
              {formatRelative(data.createdAt)}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {data.kind === "preview" && data.status === "ready" ? (
                <PreviewShare deploymentId={data.id} hostname={data.hostname} />
              ) : null}
              {data.status === "ready" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={restarting}
                  onClick={() => void restart()}
                >
                  <RotateCw
                    className={`size-3.5 ${restarting ? "animate-spin" : ""}`}
                  />
                  restart
                </Button>
              ) : null}
              {/* No delete here: it lives in the danger section at the
                  bottom, which navigates away rather than leaving this page
                  rendering a 404 of the deployment it is showing. */}
              <DeploymentActions
                deployment={{
                  id: data.id,
                  kind: data.kind,
                  status: data.status,
                }}
                onDone={reload}
              />
            </div>
          </div>

          {data.error ? (
            <ErrorBlock
              message={data.error}
              maxHeightClass="max-h-48"
              className="border-l-2 border-destructive/50 py-1 pl-3"
            />
          ) : null}

          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="commit">
              <span className="font-mono">{data.gitSha.slice(0, 12)}</span>
              {/* A commit body can be a changelog. Three lines here, the whole
                  thing on hover — `wrap-anywhere` so a bare URL in the subject
                  breaks instead of widening the grid column. */}
              <span
                className="block wrap-anywhere text-[11px] text-muted-foreground line-clamp-3"
                title={data.gitMessage ?? data.gitRef}
              >
                {data.gitMessage ?? data.gitRef}
              </span>
            </Field>
            <Field label="ref">
              <span className="block wrap-anywhere font-mono">
                {data.gitRef}
              </span>
            </Field>
            <Field label="host">
              <a
                className="inline-flex items-baseline gap-1 wrap-anywhere hover:underline"
                href={`https://${data.hostname}`}
                target="_blank"
                rel="noreferrer"
              >
                {data.hostname}
                <ExternalLink className="size-3" />
              </a>
              {data.port === null ? null : (
                <span className="block text-[11px] text-muted-foreground">
                  :{data.port}
                </span>
              )}
            </Field>
            <Field label="image">
              <span className="font-mono break-all">
                {data.imageTag ?? "—"}
              </span>
            </Field>
            <Field label="image size">
              {data.imageSizeBytes === null
                ? "—"
                : formatBytes(data.imageSizeBytes)}
            </Field>
            <Field label="build">
              {formatDurationMs(data.buildDurationMs)}
            </Field>
            <Field label="container">
              <span className="font-mono">
                {data.containerId?.slice(0, 12) ?? "—"}
              </span>
            </Field>
          </dl>

          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
            <Field label="created">{formatDateTime(data.createdAt)}</Field>
            <Field label="started">{formatDateTime(data.startedAt)}</Field>
            <Field label="ready">{formatDateTime(data.readyAt)}</Field>
            <Field label="stopped">{formatDateTime(data.stoppedAt)}</Field>
          </dl>

          {/* Inline rather than behind a link to a shared logs page: the build
              log, the container's output and the requests it served are three
              views of this one deployment, and which deployment you are looking
              at is the thing a separate page kept losing. */}
          <Tabs
            defaultValue="build"
            className="flex min-h-0 flex-col gap-3 border-t pt-4"
          >
            <TabsList variant="line">
              <TabsTrigger value="build">build log</TabsTrigger>
              <TabsTrigger value="runtime" disabled={!data.containerId}>
                runtime log
              </TabsTrigger>
              <TabsTrigger value="requests">requests</TabsTrigger>
            </TabsList>
            <TabsContent value="build" className="flex min-h-0 flex-col">
              <LogStream
                subscribe={buildSubscribe}
                resetKey={`build-${id}`}
                emptyLabel="no build output"
              />
            </TabsContent>
            <TabsContent value="runtime" className="flex min-h-0 flex-col">
              {data.containerId ? (
                <LogStream
                  subscribe={runtimeSubscribe}
                  resetKey={`runtime-${data.containerId}`}
                />
              ) : null}
            </TabsContent>
            <TabsContent
              value="requests"
              className="flex max-h-96 min-h-0 flex-col"
            >
              <RequestExplorer deploymentId={id} />
            </TabsContent>
          </Tabs>

          <DangerSection status={data.status} id={id} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Delete, at the bottom and behind a typed confirmation — the same placement
 * and the same reasoning as a project's own danger section: a destructive
 * action beside `Visit` in the header is one misclick from the link the owner
 * actually wanted.
 *
 * Navigating away is what makes it safe to offer here at all. Deleting the row
 * this page is rendering would otherwise leave it showing a 404 of itself,
 * which is why the header action row still has no delete.
 *
 * Hidden while the deployment is in flight. The row is what the agent reports
 * against, so removing one mid-build leaves a build running against a
 * deployment that no longer exists — cancel is the action for that, and it is
 * already in the header.
 */
function DangerSection({
  status,
  id,
}: {
  status: DeploymentStatus;
  id: string;
}) {
  const router = useRouter();
  if (isDeploymentLive(status)) return null;

  return (
    <section className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
      <p className="text-xs text-muted-foreground">
        Removes the container, its DNS record and its build history.
      </p>
      <TypedConfirmDialog
        title="Delete deployment"
        keyword={id.slice(0, 8)}
        actionLabel="Delete"
        // Uncaught on purpose. TypedConfirmDialog reports the failure and keeps
        // itself open with the typed keyword intact; catching here would close
        // it and clear the input as though the deployment had been deleted.
        onConfirm={async () => {
          await api.deploy.remove(id);
          toast.success("Deployment deleted");
          // Replace, not push: the route behind us renders a deployment that no
          // longer exists, and Back is the obvious thing to press next.
          router.replace("/deployments");
        }}
        trigger={
          <Button variant="destructive" size="sm">
            Delete
          </Button>
        }
      />
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-t pt-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-xs tabular-nums">{children}</dd>
    </div>
  );
}
