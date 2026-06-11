"use client";

import {
  Cloud,
  Cpu,
  MoreVertical,
  Pencil,
  Plus,
  Power,
  Server,
  Trash2,
  Webhook,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DailyUptimeEntry } from "@/lib/resource-agent";
import { CreateResourceDialog } from "./create-resource-dialog";
import type { LeanResource } from "./resources-manager";
import { UptimeBar } from "./uptime-bar";

const TYPE_LABELS: Record<string, string> = {
  pi: "Pi",
  vps: "VPS",
  api: "API",
  service: "Service",
};

const TYPE_ICONS: Record<string, typeof Cpu> = {
  pi: Cpu,
  vps: Server,
  api: Webhook,
  service: Cloud,
};

function getResourceStatus(
  resource: LeanResource,
): "up" | "degraded" | "down" | "unknown" {
  const agent = resource.agentService;
  if (!agent.enabled || agent.lastStatus === null) return "unknown";
  if (agent.lastStatus === "unreachable") return "down";
  if (agent.lastStatus === "degraded") return "degraded";
  return "up";
}

const STATUS_CONFIG = {
  up: {
    label: "Operational",
    border: "border-t-accent",
    dot: "bg-accent",
    text: "text-accent-strong",
  },
  degraded: {
    label: "Degraded",
    border: "border-t-yellow-500",
    dot: "bg-yellow-500",
    text: "text-yellow-600 dark:text-yellow-400",
  },
  down: {
    label: "Down",
    border: "border-t-red-500",
    dot: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
  },
  unknown: {
    label: "Unknown",
    border: "border-t-muted-foreground/40",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
  },
};

function getMetricColor(percent: number | null): string {
  if (percent == null) return "text-muted-foreground";
  if (percent > 90) return "text-red-600 dark:text-red-400";
  if (percent > 70) return "text-yellow-600 dark:text-yellow-400";
  return "text-accent-strong";
}

interface ResourceStatusCardProps {
  resource: LeanResource;
  onRefresh: () => void;
  onDialogChange: (open: boolean) => void;
}

export function ResourceStatusCard({
  resource,
  onRefresh,
  onDialogChange,
}: ResourceStatusCardProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [rebooting, setRebooting] = useState(false);

  const status = getResourceStatus(resource);
  const cfg = STATUS_CONFIG[status];
  const Icon = TYPE_ICONS[resource.type] ?? Cloud;
  const agent = resource.agentService;
  const metrics = agent.lastMetrics;
  const uptime = resource.uptime;
  const emptyHistory: DailyUptimeEntry[] = Array.from(
    { length: 30 },
    (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      return {
        date: d.toISOString().slice(0, 10),
        totalChecks: 0,
        healthyChecks: 0,
        avgResponseTimeMs: null,
        status: "unknown" as const,
      };
    },
  );

  const setDialog = (setter: (v: boolean) => void) => (open: boolean) => {
    setter(open);
    onDialogChange(open);
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/resources/${resource._id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to delete resource");
      }
      toast.success("Resource deleted");
      setDialog(setDeleteOpen)(false);
      onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete resource",
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleReboot = async () => {
    setRebooting(true);
    try {
      const res = await fetch(`/api/admin/resources/${resource._id}/reboot`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Failed to reboot");
      }
      toast.success("Reboot initiated");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to reboot resource",
      );
    } finally {
      setRebooting(false);
    }
  };

  return (
    <>
      <Card className={`border-t-4 ${cfg.border} px-3 pt-2.5 pb-2.5 gap-2!`}>
        <div className="flex items-start justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium text-sm truncate">
              {resource.name}
            </span>
            <Badge
              variant="secondary"
              className="text-[10px] shrink-0 border border-border"
            >
              {TYPE_LABELS[resource.type] ?? resource.type}
            </Badge>
            {resource.capabilities.length > 0 && (
              <Link href={`/admin/dashboard/resources/${resource._id}`}>
                <Badge
                  variant="outline"
                  className="text-[10px] cursor-pointer hover:bg-accent shrink-0"
                >
                  {resource.capabilities.length} capabilit
                  {resource.capabilities.length !== 1 ? "ies" : "y"}
                </Badge>
              </Link>
            )}
            {!resource.isActive && (
              <Badge variant="outline" className="text-[10px] shrink-0">
                Inactive
              </Badge>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                <MoreVertical className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setDialog(setEditOpen)(true)}>
                <Pencil className="w-3.5 h-3.5 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  router.push(`/admin/dashboard/resources/${resource._id}`)
                }
              >
                <Plus className="w-3.5 h-3.5 mr-2" />
                Capabilities
              </DropdownMenuItem>
              {agent.enabled && (
                <DropdownMenuItem onClick={handleReboot} disabled={rebooting}>
                  <Power className="w-3.5 h-3.5 mr-2" />
                  {rebooting ? "Rebooting..." : "Reboot"}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDialog(setDeleteOpen)(true)}
              >
                <Trash2 className="w-3.5 h-3.5 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {resource.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {resource.description}
          </p>
        )}

        {agent.enabled && (
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-md border px-2 py-1.5 text-center">
              <p className="text-[10px] text-muted-foreground leading-none mb-0.5">
                CPU
              </p>
              <p
                className={`text-sm font-semibold leading-tight ${getMetricColor(metrics?.cpuUsagePercent ?? null)}`}
              >
                {metrics?.cpuUsagePercent != null
                  ? `${metrics.cpuUsagePercent}%`
                  : "—"}
              </p>
            </div>
            <div className="rounded-md border px-2 py-1.5 text-center">
              <p className="text-[10px] text-muted-foreground leading-none mb-0.5">
                RAM
              </p>
              <p
                className={`text-sm font-semibold leading-tight ${getMetricColor(metrics?.memoryUsagePercent ?? null)}`}
              >
                {metrics?.memoryUsagePercent != null
                  ? `${metrics.memoryUsagePercent}%`
                  : "—"}
              </p>
            </div>
            <div className="rounded-md border px-2 py-1.5 text-center">
              <p className="text-[10px] text-muted-foreground leading-none mb-0.5">
                Disk
              </p>
              <p
                className={`text-sm font-semibold leading-tight ${getMetricColor(metrics?.diskUsagePercent ?? null)}`}
              >
                {metrics?.diskUsagePercent != null
                  ? `${metrics.diskUsagePercent}%`
                  : "—"}
              </p>
            </div>
          </div>
        )}

        {agent.enabled && (
          <UptimeBar
            dailyHistory={uptime?.dailyHistory ?? emptyHistory}
            lastCheckedAt={agent.lastCheckedAt}
          />
        )}

        <div className="flex items-center justify-between pt-1 border-t">
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono text-muted-foreground hover:text-foreground truncate max-w-[60%]"
          >
            {resource.url}
          </a>
          <div
            className={`flex items-center gap-1.5 text-xs font-medium ${cfg.text}`}
          >
            <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
            {cfg.label}
          </div>
        </div>
      </Card>

      <CreateResourceDialog
        open={editOpen}
        onOpenChange={setDialog(setEditOpen)}
        onSuccess={onRefresh}
        resource={resource}
      />

      <Dialog open={deleteOpen} onOpenChange={setDialog(setDeleteOpen)}>
        <DialogContent>
          <DialogTitle>Delete Resource</DialogTitle>
          <DialogDescription>
            Delete &ldquo;{resource.name}&rdquo; and all its capabilities? This
            cannot be undone.
          </DialogDescription>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialog(setDeleteOpen)(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
