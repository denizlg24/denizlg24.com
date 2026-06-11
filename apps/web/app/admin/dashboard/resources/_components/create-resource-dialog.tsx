"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { LeanResource } from "./resources-manager";

type ResourceType = "pi" | "vps" | "api" | "service";

interface CreateResourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  resource?: LeanResource;
}

export function CreateResourceDialog({
  open,
  onOpenChange,
  onSuccess,
  resource,
}: CreateResourceDialogProps) {
  const isEdit = !!resource;
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [type, setType] = useState<ResourceType>("pi");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [agentNodeId, setAgentNodeId] = useState("");
  const [hmacSecret, setHmacSecret] = useState("");

  useEffect(() => {
    if (open && resource) {
      setName(resource.name);
      setUrl(resource.url);
      setType(resource.type);
      setDescription(resource.description);
      setIsActive(resource.isActive);
      setAgentEnabled(resource.agentService?.enabled ?? false);
      setAgentNodeId(resource.agentService?.nodeId ?? "");
      setHmacSecret("");
    } else if (open && !resource) {
      setName("");
      setUrl("");
      setType("pi");
      setDescription("");
      setIsActive(true);
      setAgentEnabled(false);
      setAgentNodeId("");
      setHmacSecret("");
    }
  }, [open, resource]);

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) {
      toast.error("Name and URL are required.");
      return;
    }

    const agentService: Record<string, unknown> = {
      enabled: agentEnabled,
      nodeId: agentNodeId,
    };

    if (hmacSecret.trim()) {
      agentService.hmacSecret = hmacSecret;
    }

    const payload = {
      name,
      url,
      type,
      description,
      isActive,
      agentService,
    };

    setLoading(true);
    try {
      const res = await fetch(
        isEdit
          ? `/api/admin/resources/${resource._id}`
          : "/api/admin/resources",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save resource");
      }

      toast.success(isEdit ? "Resource updated" : "Resource created");
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save resource",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogTitle>{isEdit ? "Edit Resource" : "New Resource"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update resource configuration."
            : "Add a new infrastructure resource."}
        </DialogDescription>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input
              placeholder="My Raspberry Pi"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>URL</Label>
            <Input
              placeholder="http://raspberrypi.local:8080"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as ResourceType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pi">Raspberry Pi</SelectItem>
                  <SelectItem value="vps">VPS</SelectItem>
                  <SelectItem value="api">API</SelectItem>
                  <SelectItem value="service">Service</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-0.5">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="resActive"
                  checked={isActive}
                  onCheckedChange={(v) => setIsActive(!!v)}
                />
                <Label htmlFor="resActive">Active</Label>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              placeholder="Optional description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="border rounded-md p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="agentEnabled"
                checked={agentEnabled}
                onCheckedChange={(v) => setAgentEnabled(!!v)}
              />
              <Label htmlFor="agentEnabled" className="font-medium">
                Enable Agent Service
              </Label>
            </div>

            {agentEnabled && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Node ID</Label>
                  <Input
                    placeholder="pi-zero-1"
                    value={agentNodeId}
                    onChange={(e) => setAgentNodeId(e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Must match the agent&apos;s configured node_id.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">HMAC Secret</Label>
                  <Input
                    type="password"
                    placeholder={
                      isEdit
                        ? "Leave blank to keep current"
                        : "Shared secret for request signing"
                    }
                    value={hmacSecret}
                    onChange={(e) => setHmacSecret(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Shared secret used to sign requests to the agent service.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {isEdit ? "Saving..." : "Creating..."}
              </>
            ) : isEdit ? (
              "Save Changes"
            ) : (
              "Create Resource"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
