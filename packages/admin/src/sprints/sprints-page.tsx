"use client";

import type { Sprint, SprintListItem, SprintStatus } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListGroupLabel, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { GitPullRequest, Plus, RefreshCw, Route } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { SprintDialog } from "./sprint-dialog";
import {
  errorMessage,
  formatAbsolute,
  RUN_STATUS_TONE,
  SPRINT_STATUS_BADGE,
} from "./sprint-meta";

export const SPRINT_ICON = <Route />;

const GROUPS: { label: string; statuses: SprintStatus[] }[] = [
  { label: "Active", statuses: ["active"] },
  { label: "Draft", statuses: ["draft"] },
  { label: "Done", statuses: ["completed", "cancelled"] },
];

export function SprintsSkeleton() {
  const { slots } = useAdmin();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={SPRINT_ICON}
        title="Sprints"
      />
      <PageBody>
        <div className="flex flex-col gap-1">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 py-2">
              <Skeleton className="size-4" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-1/5" />
              </div>
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </PageBody>
    </Page>
  );
}

function SprintRow({
  sprint,
  onOpen,
}: {
  sprint: SprintListItem;
  onOpen: () => void;
}) {
  return (
    <ListRow
      onClick={onOpen}
      leading={
        sprint.lastRunStatus ? (
          <StatusDot
            tone={RUN_STATUS_TONE[sprint.lastRunStatus]}
            label={sprint.lastRunStatus}
            className={cn(
              sprint.lastRunStatus === "running" && "animate-pulse",
            )}
          />
        ) : (
          <StatusDot tone="muted" />
        )
      }
      title={sprint.title}
      description={
        <span className="font-mono">
          {sprint.repo}
          <span className="text-muted-foreground/60">@{sprint.branch}</span>
        </span>
      }
      meta={
        <>
          <span>
            {sprint.slotCount} {sprint.slotCount === 1 ? "slot" : "slots"}
          </span>
          <span className="hidden w-36 text-right sm:inline">
            {sprint.nextSlotAt ? formatAbsolute(sprint.nextSlotAt) : "—"}
          </span>
          <Badge
            variant={SPRINT_STATUS_BADGE[sprint.status]}
            className="capitalize"
          >
            {sprint.status}
          </Badge>
        </>
      }
      trailing={
        sprint.prUrl ? (
          <Button size="icon-sm" variant="ghost" asChild>
            <a
              href={sprint.prUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`PR #${sprint.prNumber ?? ""}`}
            >
              <GitPullRequest />
            </a>
          </Button>
        ) : (
          <span className="size-7" />
        )
      }
    />
  );
}

export function SprintsPage() {
  const { client, routes, slots } = useAdmin();
  const router = useRouter();
  const [sprints, setSprints] = useState<SprintListItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await client.get<{ sprints: SprintListItem[] }>("sprints");
      setSprints(result.sprints);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load sprints"));
      setSprints((current) => current ?? []);
    } finally {
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        sprints: (sprints ?? [])
          .filter((sprint) => group.statuses.includes(sprint.status))
          .sort((left, right) =>
            (left.nextSlotAt ?? left.updatedAt).localeCompare(
              right.nextSlotAt ?? right.updatedAt,
            ),
          ),
      })).filter((group) => group.sprints.length > 0),
    [sprints],
  );

  if (!sprints) return <SprintsSkeleton />;

  const open = (sprint: Pick<Sprint, "id">) =>
    router.push(routes.sprints.sprint(sprint.id));

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={SPRINT_ICON}
        title="Sprints"
      >
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh"
          disabled={refreshing}
          onClick={() => void load()}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus /> New sprint
        </Button>
      </PageHeader>
      <PageBody>
        {groups.length === 0 ? (
          <EmptyState icon={SPRINT_ICON} label="No sprints" />
        ) : (
          <List>
            {groups.map((group) => (
              <Fragment key={group.label}>
                <ListGroupLabel className="flex items-center">
                  {group.label}
                  <span className="ml-auto tabular-nums">
                    {group.sprints.length}
                  </span>
                </ListGroupLabel>
                {group.sprints.map((sprint) => (
                  <SprintRow
                    key={sprint.id}
                    sprint={sprint}
                    onOpen={() => open(sprint)}
                  />
                ))}
              </Fragment>
            ))}
          </List>
        )}
      </PageBody>
      {creating ? (
        <SprintDialog
          open
          sprint={null}
          onOpenChange={setCreating}
          onSaved={open}
        />
      ) : null}
    </Page>
  );
}
