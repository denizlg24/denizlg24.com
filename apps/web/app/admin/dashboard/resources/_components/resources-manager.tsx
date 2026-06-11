"use client";

import { Loader2, Plus, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import type { ResourceUptimeData } from "@/lib/resource-agent";
import type { IAgentService, ILeanCapability } from "@/models/Resource";
import { CreateResourceDialog } from "./create-resource-dialog";
import { ResourceStatusCard } from "./resource-status-card";
import { StatusSummary } from "./status-summary";

export interface LeanResource {
  _id: string;
  name: string;
  description: string;
  url: string;
  type: "pi" | "vps" | "api" | "service";
  isActive: boolean;
  agentService: IAgentService;
  capabilities: ILeanCapability[];
  uptime: ResourceUptimeData | null;
  createdAt: string;
  updatedAt: string;
}

interface ResourcesManagerProps {
  initialResources: LeanResource[];
}

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store" }).then((r) => r.json());

export function ResourcesManager({ initialResources }: ResourcesManagerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [anyDialogOpen, setAnyDialogOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { data, mutate } = useSWR("/api/admin/resources", fetcher, {
    fallbackData: { resources: initialResources },
    refreshInterval: anyDialogOpen || createOpen ? 0 : 60_000,
    revalidateOnFocus: false,
  });

  const resources: LeanResource[] = data?.resources ?? initialResources;

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/resources/health-check", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Health check failed");
      toast.success("Health checks completed");
      await mutate();
    } catch {
      toast.error("Failed to run health checks");
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);

  const onDialogChange = useCallback((open: boolean) => {
    setAnyDialogOpen(open);
  }, []);

  return (
    <div className="space-y-4 pb-8">
      <div className="flex sm:flex-row flex-col sm:items-center items-start gap-2 justify-between">
        {resources.length > 0 && <StatusSummary resources={resources} />}
        <div className="flex flex-row items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
            )}
            Refresh All
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add Resource
          </Button>
        </div>
      </div>

      {resources.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg font-medium mb-1">No resources configured</p>
          <p className="text-sm mb-4">
            Add a Raspberry Pi, VPS, or service to get started.
          </p>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Resource
          </Button>
        </div>
      )}

      {resources.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {resources.map((resource) => (
            <ResourceStatusCard
              key={resource._id}
              resource={resource}
              onRefresh={() => mutate()}
              onDialogChange={onDialogChange}
            />
          ))}
        </div>
      )}

      <CreateResourceDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          onDialogChange(open);
        }}
        onSuccess={() => mutate()}
      />
    </div>
  );
}
