"use client";

import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ILeanCapability } from "@/models/Resource";
import { AddCapabilityDialog } from "./add-capability-dialog";
import { CapabilitySection } from "./capability-section";

interface ResourceData {
  _id: string;
  name: string;
  url: string;
  capabilities: ILeanCapability[];
}

interface ResourceCapabilitiesProps {
  resource: ResourceData;
}

export function ResourceCapabilities({
  resource: initial,
}: ResourceCapabilitiesProps) {
  const [resource, setResource] = useState(initial);
  const [addCapOpen, setAddCapOpen] = useState(false);

  const fetchResource = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/resources/${initial._id}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      setResource({
        _id: data._id ?? data.resource?._id ?? initial._id,
        name: data.name ?? data.resource?.name ?? initial.name,
        url: data.url ?? data.resource?.url ?? initial.url,
        capabilities: (
          data.capabilities ??
          data.resource?.capabilities ??
          []
        ).map((c: ILeanCapability) => ({
          _id: c._id.toString(),
          type: c.type,
          label: c.label,
          baseUrl: c.baseUrl,
          config: c.config,
          isActive: c.isActive,
        })),
      });
    } catch (error) {
      console.error("Failed to fetch resource:", error);
    }
  }, [initial._id, initial.name, initial.url]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Capabilities</h2>
        <Button size="sm" onClick={() => setAddCapOpen(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add Capability
        </Button>
      </div>

      {resource.capabilities.length === 0 && (
        <div className="text-center py-12 text-muted-foreground border rounded-lg">
          <p className="text-sm font-medium mb-1">No capabilities</p>
          <p className="text-xs mb-3">
            Add a capability like PiCron to get started.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddCapOpen(true)}
          >
            <Plus className="w-3 h-3 mr-1" />
            Add Capability
          </Button>
        </div>
      )}

      {resource.capabilities.length > 0 && (
        <div className="space-y-3">
          {resource.capabilities.map((cap) => (
            <CapabilitySection
              key={cap._id}
              resourceId={resource._id}
              capability={cap}
              onRefresh={fetchResource}
            />
          ))}
        </div>
      )}

      <AddCapabilityDialog
        open={addCapOpen}
        onOpenChange={setAddCapOpen}
        onSuccess={fetchResource}
        resourceId={resource._id}
      />
    </div>
  );
}
