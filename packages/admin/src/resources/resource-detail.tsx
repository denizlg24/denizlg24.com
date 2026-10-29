"use client";

import type { ICapability, IResource } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton, ConfirmDialog } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { PageTitle } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import { Spinner } from "@repo/ui/spinner";
import { Stat, StatGroup } from "@repo/ui/stat";
import { StatusDot } from "@repo/ui/status-dot";
import { ExternalLink, Power, RefreshCw, Server } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { AddCapabilityDialog } from "./add-capability-dialog";
import { CapabilitySection } from "./capability-section";
import { PiCronDashboard } from "./picron/picron-dashboard";
import {
  getResourceStatus,
  RESOURCE_STATUS_TONE,
  RESOURCE_TYPE_LABELS,
  usagePercentTone,
} from "./status";
import { SubResourcesSection } from "./sub-resources-section";
import { UptimeBar } from "./uptime-bar";

function percent(value: number | null | undefined): string {
  return value != null ? `${value}%` : "—";
}

export function ResourceDetail({
  resource,
  onUpdate,
}: {
  resource: IResource;
  onUpdate: (updated: IResource) => void;
}) {
  const { client, platform } = useAdmin();
  const [addCapOpen, setAddCapOpen] = useState(false);
  const [deleteCapTarget, setDeleteCapTarget] = useState<string | null>(null);
  const [selectedCap, setSelectedCap] = useState<ICapability | null>(null);
  const [rebooting, setRebooting] = useState(false);
  const [loadingServices, setLoadingServices] = useState(false);
  const [services, setServices] = useState<Array<{
    name: string;
    status: string;
  }> | null>(null);
  const [restartingService, setRestartingService] = useState<string | null>(
    null,
  );

  const uptimePercent = resource.uptime?.uptimePercentage;
  const agent = resource.agentService;
  const metrics = agent.lastMetrics;
  const lastChecked = agent.lastCheckedAt;

  const handleAddCapability = async (data: {
    type: string;
    label: string;
    baseUrl: string;
    config: Record<string, unknown>;
  }) => {
    try {
      const result = await client.post<ICapability>(
        `resources/${resource._id}/capabilities`,
        data,
      );
      onUpdate({
        ...resource,
        capabilities: [...resource.capabilities, result],
      });
      setAddCapOpen(false);
      toast.success("Capability added");
    } catch {
      toast.error("Failed to add capability");
    }
  };

  const handleToggleCapability = async (capId: string, isActive: boolean) => {
    try {
      await client.patch<ICapability>(
        `resources/${resource._id}/capabilities/${capId}`,
        { isActive },
      );
      onUpdate({
        ...resource,
        capabilities: resource.capabilities.map((c) =>
          c._id === capId ? { ...c, isActive } : c,
        ),
      });
    } catch {
      toast.error("Failed to update capability");
    }
  };

  const handleDeleteCapability = async (capId: string) => {
    try {
      await client.del(`resources/${resource._id}/capabilities/${capId}`);
      onUpdate({
        ...resource,
        capabilities: resource.capabilities.filter((c) => c._id !== capId),
      });
      if (selectedCap?._id === capId) setSelectedCap(null);
      toast.success("Capability removed");
    } catch {
      toast.error("Failed to delete capability");
    }
  };

  const handleReboot = async () => {
    setRebooting(true);
    try {
      await client.post<{ status: string }>(
        `resources/${resource._id}/reboot`,
        {},
      );
      toast.success("Reboot initiated");
    } catch {
      toast.error("Failed to reboot resource");
    } finally {
      setRebooting(false);
    }
  };

  const handleLoadServices = async () => {
    setLoadingServices(true);
    try {
      const result = await client.get<{
        services: Array<{ name: string; status: string }>;
      }>(`resources/${resource._id}/services`);
      setServices(result.services);
    } catch {
      toast.error("Failed to load services");
    } finally {
      setLoadingServices(false);
    }
  };

  const handleRestartService = async (serviceName: string) => {
    setRestartingService(serviceName);
    try {
      await client.post<{ status: string }>(
        `resources/${resource._id}/services`,
        { serviceName },
      );
      toast.success(`Restarting ${serviceName}`);
    } catch {
      toast.error(`Failed to restart ${serviceName}`);
    } finally {
      setRestartingService(null);
    }
  };

  const status = getResourceStatus(resource);
  const history = resource.uptime?.dailyHistory ?? [];
  const deleteCapLabel =
    resource.capabilities.find((c) => c._id === deleteCapTarget)?.label ??
    "capability";
  // The selection is held as a snapshot; read the live row so a toggle shows.
  const liveSelectedCap = selectedCap
    ? (resource.capabilities.find((c) => c._id === selectedCap._id) ?? null)
    : null;

  return (
    <>
      <PageTitle
        title={resource.name}
        meta={
          <>
            <span className="flex items-center gap-1.5">
              <StatusDot tone={RESOURCE_STATUS_TONE[status]} />
              {status}
            </span>
            <Badge variant="outline" className="font-mono">
              {RESOURCE_TYPE_LABELS[resource.type]}
            </Badge>
            {!resource.isActive && <Badge variant="secondary">inactive</Badge>}
          </>
        }
        actions={
          agent.enabled ? (
            <ConfirmButton
              trigger={
                <Button variant="ghost" size="sm" disabled={rebooting}>
                  {rebooting ? <Spinner className="size-3.5" /> : <Power />}
                  Reboot
                </Button>
              }
              title={`Reboot ${resource.name}?`}
              actionLabel="Reboot"
              destructive
              onConfirm={handleReboot}
            />
          ) : undefined
        }
      />

      <Properties>
        <Property label="URL">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs">{resource.url}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Open resource URL"
              className="text-muted-foreground"
              onClick={() => platform.openExternal(resource.url)}
            >
              <ExternalLink />
            </Button>
          </span>
        </Property>
        {resource.description && (
          <Property label="Description">{resource.description}</Property>
        )}
        <Property label="Agent">
          {agent.enabled ? (
            <span className="font-mono text-xs">{agent.nodeId || "—"}</span>
          ) : (
            <span className="text-muted-foreground">off</span>
          )}
        </Property>
        {lastChecked && (
          <Property label="Checked">
            <span className="tabular-nums">
              {new Date(lastChecked).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </Property>
        )}
      </Properties>

      <StatGroup>
        <Stat
          label="Uptime"
          value={uptimePercent != null ? `${uptimePercent.toFixed(1)}%` : "—"}
          tone={uptimePercent != null ? "default" : "muted"}
        />
        {agent.enabled && (
          <>
            <Stat
              label="CPU"
              value={percent(metrics?.cpuUsagePercent)}
              tone={usagePercentTone(metrics?.cpuUsagePercent)}
            />
            <Stat
              label="RAM"
              value={percent(metrics?.memoryUsagePercent)}
              tone={usagePercentTone(metrics?.memoryUsagePercent)}
            />
            <Stat
              label="Disk"
              value={percent(metrics?.diskUsagePercent)}
              tone={usagePercentTone(metrics?.diskUsagePercent)}
            />
          </>
        )}
      </StatGroup>

      {history.length > 0 && (
        <Section title="30 days">
          <div className="flex flex-col gap-1.5">
            <UptimeBar history={history} />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>30d ago</span>
              <span>today</span>
            </div>
          </div>
        </Section>
      )}

      {agent.enabled && (
        <Section
          title="Services"
          count={services ? services.length : undefined}
          actions={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Load services"
              onClick={handleLoadServices}
              disabled={loadingServices}
            >
              {loadingServices ? (
                <Spinner className="size-3.5" />
              ) : (
                <RefreshCw />
              )}
            </Button>
          }
        >
          {services === null ? (
            <EmptyState
              compact
              icon={<Server />}
              label="Not loaded"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleLoadServices}
                  disabled={loadingServices}
                >
                  Load
                </Button>
              }
            />
          ) : services.length === 0 ? (
            <EmptyState compact icon={<Server />} label="No services" />
          ) : (
            <List>
              {services.map((svc) => (
                <ListRow
                  key={svc.name}
                  leading={
                    <StatusDot
                      tone={svc.status === "running" ? "good" : "critical"}
                      label={svc.status}
                    />
                  }
                  title={<span className="font-mono">{svc.name}</span>}
                  meta={<span>{svc.status}</span>}
                  trailing={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground"
                      onClick={() => handleRestartService(svc.name)}
                      disabled={restartingService === svc.name}
                    >
                      {restartingService === svc.name ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <RefreshCw />
                      )}
                      Restart
                    </Button>
                  }
                />
              ))}
            </List>
          )}
        </Section>
      )}

      <SubResourcesSection resourceId={resource._id} />

      <CapabilitySection
        capabilities={resource.capabilities}
        onAdd={() => setAddCapOpen(true)}
        onToggle={handleToggleCapability}
        onDelete={(capId) => setDeleteCapTarget(capId)}
        onSelect={(cap) =>
          setSelectedCap(selectedCap?._id === cap._id ? null : cap)
        }
        selectedId={selectedCap?._id ?? null}
      />

      {liveSelectedCap && liveSelectedCap.type === "picron" && (
        <PiCronDashboard
          key={liveSelectedCap._id}
          resourceId={resource._id}
          capability={liveSelectedCap}
        />
      )}

      <AddCapabilityDialog
        open={addCapOpen}
        onOpenChange={setAddCapOpen}
        onSubmit={handleAddCapability}
      />

      <ConfirmDialog
        open={!!deleteCapTarget}
        onOpenChange={(open) => !open && setDeleteCapTarget(null)}
        title={`Delete ${deleteCapLabel}?`}
        description="Its configuration goes with it."
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteCapTarget) void handleDeleteCapability(deleteCapTarget);
        }}
      />
    </>
  );
}
