"use client";

import type { IResource } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { ListRow } from "@repo/ui/list";
import { StatusDot } from "@repo/ui/status-dot";
import { RowActions } from "@repo/ui/toolbar";
import { Activity, Pencil, Trash2 } from "lucide-react";
import {
  getResourceStatus,
  RESOURCE_STATUS_TONE,
  RESOURCE_TYPE_LABELS,
} from "./status";
import { UptimeBar } from "./uptime-bar";

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex w-14 flex-col items-end">
      <span className="text-sm text-accent-strong tabular-nums">{value}</span>
      <span className="text-[11px] uppercase tracking-[0.08em]">{label}</span>
    </span>
  );
}

export function ResourceRow({
  resource,
  onSelect,
  onEdit,
  onDelete,
  onHealthCheck,
}: {
  resource: IResource;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onHealthCheck: () => void;
}) {
  const uptimePercent = resource.uptime?.uptimePercentage;
  const status = getResourceStatus(resource);
  const metrics = resource.agentService.lastMetrics;
  const history = resource.uptime?.dailyHistory ?? [];

  return (
    <ListRow
      onClick={onSelect}
      className="py-2.5"
      leading={<StatusDot tone={RESOURCE_STATUS_TONE[status]} label={status} />}
      title={
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{resource.name}</span>
          <Badge variant="outline" className="font-mono">
            {RESOURCE_TYPE_LABELS[resource.type]}
          </Badge>
          {!resource.isActive && <Badge variant="secondary">inactive</Badge>}
        </span>
      }
      description={<span className="font-mono">{resource.url}</span>}
      meta={
        <span className="hidden items-center gap-5 md:flex">
          {history.length > 0 && (
            <span className="w-44" onClick={(event) => event.stopPropagation()}>
              <UptimeBar history={history} />
            </span>
          )}
          {uptimePercent != null && (
            <Figure value={`${uptimePercent.toFixed(1)}%`} label="uptime" />
          )}
          {metrics?.cpuUsagePercent != null && (
            <Figure value={`${metrics.cpuUsagePercent}%`} label="cpu" />
          )}
          <Figure value={String(resource.capabilities.length)} label="caps" />
        </span>
      }
      trailing={
        // Menu items portal out, but React still bubbles their clicks to the row.
        <span onClick={(event) => event.stopPropagation()}>
          <RowActions>
            <DropdownMenuItem onClick={onHealthCheck}>
              <Activity /> Health check
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onEdit}>
              <Pencil /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </RowActions>
        </span>
      }
    />
  );
}
