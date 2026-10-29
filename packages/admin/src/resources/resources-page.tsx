"use client";

import type { IResource } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { List } from "@repo/ui/list";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { Stat, StatGroup } from "@repo/ui/stat";
import { StatusDot } from "@repo/ui/status-dot";
import { Activity, Pencil, Plus, Radio } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { CreateResourceDialog } from "./create-resource-dialog";
import { ResourceDetail } from "./resource-detail";
import { ResourceRow } from "./resource-row";
import { getResourceStatus, RESOURCE_STATUS_TONE } from "./status";

interface HealthCheckResult {
  resourceId: string;
  status: "healthy" | "degraded" | "unreachable";
  metrics: {
    cpuUsagePercent: number | null;
    memoryUsagePercent: number | null;
    diskUsagePercent: number | null;
  } | null;
}

export function ResourcesSkeleton() {
  const { slots } = useAdmin();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<Radio />}
        title="Resources"
      >
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-16" />
      </PageHeader>
      <PageBody>
        <StatGroup>
          {["Total", "Up", "Down"].map((label) => (
            <div key={label} className="flex flex-col gap-1">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-6 w-8" />
            </div>
          ))}
        </StatGroup>
        <div className="flex flex-col gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex min-h-12 items-center gap-3 py-2">
              <Skeleton className="size-2 rounded-full" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-2.5 w-56" />
              </div>
              <Skeleton className="hidden h-4 w-44 md:block" />
              <Skeleton className="hidden h-6 w-32 md:block" />
            </div>
          ))}
        </div>
      </PageBody>
    </Page>
  );
}

export function ResourcesPage() {
  const { client, slots } = useAdmin();

  const [resources, setResources] = useState<IResource[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(
    null,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<IResource | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<IResource | null>(null);
  const [healthChecking, setHealthChecking] = useState(false);

  useEffect(() => {
    if (!initialLoading) return;
    let active = true;
    client
      .get<{ resources: IResource[] }>("resources")
      .then((result) => {
        if (active) setResources(result.resources ?? []);
      })
      .catch(() => {
        if (active) toast.error("Failed to load resources");
      })
      .finally(() => {
        if (active) setInitialLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, initialLoading]);

  const handleCreate = async (data: Record<string, unknown>) => {
    try {
      const result = await client.post<IResource>("resources", data);
      setResources((prev) => [...prev, { ...result, uptime: null }]);
      setCreateOpen(false);
      toast.success("Resource created");
    } catch {
      toast.error("Failed to create resource");
    }
  };

  const handleUpdate = async (data: Record<string, unknown>) => {
    if (!editingResource) return;
    try {
      const result = await client.patch<IResource>(
        `resources/${editingResource._id}`,
        data,
      );
      setResources((prev) =>
        prev.map((r) =>
          r._id === editingResource._id
            ? { ...r, ...result, uptime: r.uptime }
            : r,
        ),
      );
      setEditingResource(null);
      toast.success("Resource updated");
    } catch {
      toast.error("Failed to update resource");
    }
  };

  const handleDelete = async (target: IResource) => {
    try {
      await client.del(`resources/${target._id}`);
      setResources((prev) => prev.filter((r) => r._id !== target._id));
      if (selectedResourceId === target._id) setSelectedResourceId(null);
      toast.success("Resource deleted");
    } catch {
      toast.error("Failed to delete resource");
    }
  };

  const applyHealthResults = (results: HealthCheckResult[]) => {
    setResources((prev) =>
      prev.map((r) => {
        const check = results.find((c) => c.resourceId === r._id);
        if (!check) return r;
        return {
          ...r,
          agentService: {
            ...r.agentService,
            lastStatus: check.status,
            lastMetrics: check.metrics,
            lastCheckedAt: new Date().toISOString(),
          },
        };
      }),
    );
  };

  const handleHealthCheckAll = async () => {
    setHealthChecking(true);
    try {
      const result = await client.post<{ results: HealthCheckResult[] }>(
        "resources/health-check",
        { force: true },
      );
      applyHealthResults(result.results);
      const healthy = result.results.filter(
        (r) => r.status === "healthy",
      ).length;
      toast.success(
        `Health check complete: ${healthy}/${result.results.length} healthy`,
      );
    } catch {
      toast.error("Health check failed");
    } finally {
      setHealthChecking(false);
    }
  };

  const handleSingleHealthCheck = async (resource: IResource) => {
    setHealthChecking(true);
    try {
      const result = await client.post<{ results: HealthCheckResult[] }>(
        "resources/health-check",
        { force: true },
      );
      applyHealthResults(result.results);
      const check = result.results.find((c) => c.resourceId === resource._id);
      if (check) {
        toast.success(
          check.status === "healthy"
            ? `${resource.name} is healthy`
            : `${resource.name} is ${check.status}`,
        );
      }
    } catch {
      toast.error("Health check failed");
    } finally {
      setHealthChecking(false);
    }
  };

  const handleResourceUpdate = (updated: IResource) => {
    setResources((prev) =>
      prev.map((r) => (r._id === updated._id ? updated : r)),
    );
  };

  const selectedResource = useMemo(
    () => resources.find((r) => r._id === selectedResourceId),
    [resources, selectedResourceId],
  );

  if (initialLoading) {
    return <ResourcesSkeleton />;
  }

  const healthyCount = resources.filter(
    (r) => getResourceStatus(r) === "up",
  ).length;
  const degradedCount = resources.filter(
    (r) => getResourceStatus(r) === "degraded",
  ).length;
  const unhealthyCount = resources.filter(
    (r) => getResourceStatus(r) === "down",
  ).length;

  const healthCheckButton = (onClick: () => void, label: string) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={healthChecking || resources.length === 0}
    >
      {healthChecking ? <Spinner className="size-3.5" /> : <Activity />}
      {label}
    </Button>
  );

  return (
    <Page>
      {selectedResource ? (
        <PageHeader
          leading={slots?.sidebarTrigger}
          crumbs={[
            { label: "Resources", onClick: () => setSelectedResourceId(null) },
          ]}
          icon={
            <StatusDot
              tone={RESOURCE_STATUS_TONE[getResourceStatus(selectedResource)]}
            />
          }
          title={selectedResource.name}
        >
          {healthCheckButton(
            () => handleSingleHealthCheck(selectedResource),
            "Check",
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Edit resource"
            onClick={() => setEditingResource(selectedResource)}
          >
            <Pencil />
          </Button>
        </PageHeader>
      ) : (
        <PageHeader
          leading={slots?.sidebarTrigger}
          icon={<Radio />}
          title="Resources"
        >
          {healthCheckButton(handleHealthCheckAll, "Check all")}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> New
          </Button>
        </PageHeader>
      )}

      {selectedResource ? (
        <PageBody>
          <ResourceDetail
            key={selectedResource._id}
            resource={selectedResource}
            onUpdate={handleResourceUpdate}
          />
        </PageBody>
      ) : resources.length === 0 ? (
        <PageBody>
          <EmptyState
            icon={<Radio />}
            label="No resources"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(true)}
              >
                <Plus /> Add
              </Button>
            }
          />
        </PageBody>
      ) : (
        <PageBody>
          <StatGroup>
            <Stat label="Total" value={resources.length} />
            <Stat
              label="Up"
              value={healthyCount}
              tone={healthyCount > 0 ? "good" : "muted"}
            />
            <Stat
              label="Degraded"
              value={degradedCount}
              tone={degradedCount > 0 ? "warning" : "muted"}
            />
            <Stat
              label="Down"
              value={unhealthyCount}
              tone={unhealthyCount > 0 ? "critical" : "muted"}
            />
          </StatGroup>
          <List divided>
            {resources.map((resource) => (
              <ResourceRow
                key={resource._id}
                resource={resource}
                onSelect={() => setSelectedResourceId(resource._id)}
                onEdit={() => setEditingResource(resource)}
                onDelete={() => setDeleteTarget(resource)}
                onHealthCheck={() => handleSingleHealthCheck(resource)}
              />
            ))}
          </List>
        </PageBody>
      )}

      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
      />

      <CreateResourceDialog
        open={!!editingResource}
        onOpenChange={(o) => !o && setEditingResource(null)}
        onSubmit={handleUpdate}
        editingResource={editingResource}
        key={editingResource?._id ?? "edit-dialog"}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? "resource"}?`}
        description="Capabilities and monitoring history go with it."
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
        }}
      />
    </Page>
  );
}
