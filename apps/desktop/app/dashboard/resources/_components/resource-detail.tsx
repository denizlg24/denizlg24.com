"use client";

import { ExternalLink, Loader2, Power, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { denizApi } from "@/lib/api-wrapper";
import type { ICapability, IResource } from "@/lib/data-types";
import { AddCapabilityDialog } from "./add-capability-dialog";
import { CapabilitySection } from "./capability-section";
import { PiCronDashboard } from "./picron/picron-dashboard";
import { SubResourcesSection } from "./sub-resources-section";
import { UptimeBar } from "./uptime-bar";

function getMetricColor(percent: number | null): string {
  if (percent == null) return "text-muted-foreground";
  if (percent > 90) return "text-red-600 dark:text-red-400";
  if (percent > 70) return "text-yellow-600 dark:text-yellow-400";
  return "text-accent-foreground";
}

export function ResourceDetail({
  resource,
  API,
  onUpdate,
}: {
  resource: IResource;
  API: denizApi;
  onUpdate: (updated: IResource) => void;
}) {
  const [addCapOpen, setAddCapOpen] = useState(false);
  const [deleteCapTarget, setDeleteCapTarget] = useState<string | null>(null);
  const [selectedCap, setSelectedCap] = useState<ICapability | null>(null);
  const [deleting, setDeleting] = useState(false);
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
    const result = await API.POST<ICapability>({
      endpoint: `resources/${resource._id}/capabilities`,
      body: data,
    });
    if ("code" in result) {
      toast.error("Failed to add capability");
      return;
    }
    onUpdate({ ...resource, capabilities: [...resource.capabilities, result] });
    setAddCapOpen(false);
    toast.success("Capability added");
  };

  const handleToggleCapability = async (capId: string, isActive: boolean) => {
    const result = await API.PATCH<ICapability>({
      endpoint: `resources/${resource._id}/capabilities/${capId}`,
      body: { isActive },
    });
    if ("code" in result) {
      toast.error("Failed to update capability");
      return;
    }
    onUpdate({
      ...resource,
      capabilities: resource.capabilities.map((c) =>
        c._id === capId ? { ...c, isActive } : c,
      ),
    });
  };

  const handleDeleteCapability = async () => {
    if (!deleteCapTarget) return;
    setDeleting(true);
    const result = await API.DELETE<{ status: string }>({
      endpoint: `resources/${resource._id}/capabilities/${deleteCapTarget}`,
    });
    setDeleting(false);
    if ("code" in result) {
      toast.error("Failed to delete capability");
      return;
    }
    onUpdate({
      ...resource,
      capabilities: resource.capabilities.filter(
        (c) => c._id !== deleteCapTarget,
      ),
    });
    if (selectedCap?._id === deleteCapTarget) setSelectedCap(null);
    setDeleteCapTarget(null);
    toast.success("Capability removed");
  };

  const handleReboot = async () => {
    setRebooting(true);
    const result = await API.POST<{ status: string }>({
      endpoint: `resources/${resource._id}/reboot`,
      body: {},
    });
    setRebooting(false);
    if ("code" in result) {
      toast.error("Failed to reboot resource");
      return;
    }
    toast.success("Reboot initiated");
  };

  const handleLoadServices = async () => {
    setLoadingServices(true);
    const result = await API.GET<{
      services: Array<{ name: string; status: string }>;
    }>({
      endpoint: `resources/${resource._id}/services`,
    });
    setLoadingServices(false);
    if ("code" in result) {
      toast.error("Failed to load services");
      return;
    }
    setServices(result.services);
  };

  const handleRestartService = async (serviceName: string) => {
    setRestartingService(serviceName);
    const result = await API.POST<{ status: string }>({
      endpoint: `resources/${resource._id}/services`,
      body: { serviceName },
    });
    setRestartingService(null);
    if ("code" in result) {
      toast.error(`Failed to restart ${serviceName}`);
      return;
    }
    toast.success(`Restarting ${serviceName}`);
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-6 py-6">
        <div className="flex items-start gap-6 mb-2">
          <div className="flex-1">
            <p className="text-xs text-muted-foreground/70 font-mono truncate mb-1 flex items-center gap-1.5">
              {resource.url}
              <a
                href={resource.url}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground/70 hover:text-muted-foreground transition-colors"
              >
                <ExternalLink className="size-3" />
              </a>
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              {resource.description}
            </p>
          </div>

          <div className="flex items-center gap-5 shrink-0">
            {uptimePercent != null && (
              <div className="text-right">
                <p className="text-2xl font-mono font-semibold tabular-nums tracking-tight">
                  {uptimePercent.toFixed(1)}
                  <span className="text-sm text-muted-foreground/60">%</span>
                </p>
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
                  uptime
                </p>
              </div>
            )}
          </div>
        </div>

        {agent.enabled && (
          <div className="flex items-center gap-6 mb-8 text-sm font-mono">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                cpu
              </span>
              <span
                className={`font-semibold tabular-nums ${getMetricColor(metrics?.cpuUsagePercent ?? null)}`}
              >
                {metrics?.cpuUsagePercent != null
                  ? `${metrics.cpuUsagePercent}%`
                  : "\u2014"}
              </span>
            </div>
            <span className="text-muted-foreground/30">|</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                ram
              </span>
              <span
                className={`font-semibold tabular-nums ${getMetricColor(metrics?.memoryUsagePercent ?? null)}`}
              >
                {metrics?.memoryUsagePercent != null
                  ? `${metrics.memoryUsagePercent}%`
                  : "\u2014"}
              </span>
            </div>
            <span className="text-muted-foreground/30">|</span>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                disk
              </span>
              <span
                className={`font-semibold tabular-nums ${getMetricColor(metrics?.diskUsagePercent ?? null)}`}
              >
                {metrics?.diskUsagePercent != null
                  ? `${metrics.diskUsagePercent}%`
                  : "\u2014"}
              </span>
            </div>
          </div>
        )}

        {resource.uptime && resource.uptime.dailyHistory.length > 0 && (
          <div className="mb-8">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              30-day uptime
            </p>
            <UptimeBar history={resource.uptime.dailyHistory} />
            <div className="flex justify-between mt-1.5">
              <span className="text-[11px] text-muted-foreground/70 font-mono">
                30d ago
              </span>
              <span className="text-[11px] text-muted-foreground/70 font-mono">
                today
              </span>
            </div>
          </div>
        )}

        {agent.enabled && (
          <div className="flex items-center gap-4 text-xs text-muted-foreground/60 mb-8 pb-8 border-b border-border/30">
            <span className="font-mono">node: {agent.nodeId || "unset"}</span>
            <span className="text-muted-foreground/60">&middot;</span>
            <span className="font-mono">
              status: {agent.lastStatus ?? "unknown"}
            </span>
            {lastChecked && (
              <>
                <span className="text-muted-foreground/60">&middot;</span>
                <span>
                  checked{" "}
                  {new Date(lastChecked).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </>
            )}
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1 text-muted-foreground"
              onClick={handleLoadServices}
              disabled={loadingServices}
            >
              {loadingServices ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              Services
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1 text-destructive hover:text-destructive"
              onClick={handleReboot}
              disabled={rebooting}
            >
              {rebooting ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Power className="size-3" />
              )}
              Reboot
            </Button>
          </div>
        )}

        {services && (
          <div className="mb-8">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Services
            </p>
            <div className="flex flex-col gap-1">
              {services.map((svc) => (
                <div
                  key={svc.name}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border/50"
                >
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${svc.status === "running" ? "bg-accent" : "bg-red-500"}`}
                  />
                  <span className="text-sm font-mono flex-1">{svc.name}</span>
                  <span className="text-[10px] text-muted-foreground font-mono uppercase">
                    {svc.status}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs gap-1 text-muted-foreground"
                    onClick={() => handleRestartService(svc.name)}
                    disabled={restartingService === svc.name}
                  >
                    {restartingService === svc.name ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3" />
                    )}
                    Restart
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-8">
          <SubResourcesSection resourceId={resource._id} API={API} />
        </div>

        <div className="mb-8">
          <CapabilitySection
            capabilities={resource.capabilities}
            onAdd={() => setAddCapOpen(true)}
            onToggle={handleToggleCapability}
            onDelete={(capId) => setDeleteCapTarget(capId)}
            onSelect={(cap) =>
              setSelectedCap(selectedCap?._id === cap._id ? null : cap)
            }
          />
        </div>

        {selectedCap && selectedCap.type === "picron" && (
          <div className="border-t border-border/30 pt-6">
            <PiCronDashboard
              API={API}
              resourceId={resource._id}
              capability={selectedCap}
            />
          </div>
        )}
      </div>

      <AddCapabilityDialog
        open={addCapOpen}
        onOpenChange={setAddCapOpen}
        onSubmit={handleAddCapability}
      />

      <Dialog
        open={!!deleteCapTarget}
        onOpenChange={(o) => !o && setDeleteCapTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Capability</DialogTitle>
            <DialogDescription>
              This will remove the capability and all associated configuration.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteCapTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCapability}
              disabled={deleting}
            >
              {deleting ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
