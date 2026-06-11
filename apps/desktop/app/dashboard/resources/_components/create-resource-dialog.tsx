"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
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
import type { IResource } from "@/lib/data-types";

type ResourceType = IResource["type"];

const RESOURCE_TYPES: { value: ResourceType; label: string }[] = [
  { value: "pi", label: "Raspberry Pi" },
  { value: "vps", label: "VPS" },
  { value: "api", label: "API" },
  { value: "service", label: "Service" },
];

export function CreateResourceDialog({
  open,
  onOpenChange,
  onSubmit,
  editingResource,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    name: string;
    description: string;
    url: string;
    type: ResourceType;
    isActive: boolean;
    agentService: Record<string, unknown>;
  }) => Promise<void>;
  editingResource?: IResource | null;
}) {
  const isEdit = !!editingResource;
  const [name, setName] = useState(editingResource?.name ?? "");
  const [description, setDescription] = useState(
    editingResource?.description ?? "",
  );
  const [url, setUrl] = useState(editingResource?.url ?? "");
  const [type, setType] = useState<ResourceType>(
    editingResource?.type ?? "api",
  );
  const [agentEnabled, setAgentEnabled] = useState(
    editingResource?.agentService?.enabled ?? false,
  );
  const [agentNodeId, setAgentNodeId] = useState(
    editingResource?.agentService?.nodeId ?? "",
  );
  const [hmacSecret, setHmacSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setName(editingResource?.name ?? "");
    setDescription(editingResource?.description ?? "");
    setUrl(editingResource?.url ?? "");
    setType(editingResource?.type ?? "api");
    setAgentEnabled(editingResource?.agentService?.enabled ?? false);
    setAgentNodeId(editingResource?.agentService?.nodeId ?? "");
    setHmacSecret("");
  };

  const handleSubmit = async () => {
    if (!name.trim() || !url.trim()) return;
    setSubmitting(true);
    try {
      const agentService: Record<string, unknown> = {
        enabled: agentEnabled,
        nodeId: agentNodeId,
      };

      if (hmacSecret.trim()) {
        agentService.hmacSecret = hmacSecret;
      }

      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        url: url.trim(),
        type,
        isActive: true,
        agentService,
      });
      if (!editingResource) resetForm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) resetForm();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editingResource ? "Edit Resource" : "New Resource"}
          </DialogTitle>
          <DialogDescription>
            {editingResource
              ? "Update resource configuration."
              : "Register a new resource to monitor."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex-1 flex flex-col gap-1.5">
              <Label htmlFor="res-name">Name</Label>
              <Input
                id="res-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My API Server"
              />
            </div>
            <div className="w-32 flex flex-col gap-1.5">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as ResourceType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RESOURCE_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="res-url">URL</Label>
            <Input
              id="res-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com"
              className="font-mono text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="res-desc">
              Description{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              id="res-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this resource do?"
              rows={2}
              className="resize-none"
            />
          </div>

          <div className="border-t pt-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Agent Service
              </Label>
              <button
                type="button"
                onClick={() => setAgentEnabled(!agentEnabled)}
                className={`relative w-8 h-4.5 rounded-full transition-colors ${agentEnabled ? "bg-accent" : "bg-muted-foreground/30"}`}
              >
                <span
                  className={`absolute top-0.5 size-3.5 rounded-full bg-white transition-transform ${agentEnabled ? "left-4.25" : "left-0.5"}`}
                />
              </button>
            </div>
            {agentEnabled && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <Label className="text-[10px] text-muted-foreground">
                    Node ID
                  </Label>
                  <Input
                    placeholder="pi-zero-1"
                    value={agentNodeId}
                    onChange={(e) => setAgentNodeId(e.target.value)}
                    className="font-mono text-xs h-8"
                  />
                  <p className="text-[10px] text-muted-foreground/60">
                    Must match the agent&apos;s configured node_id.
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[10px] text-muted-foreground">
                    HMAC Secret
                  </Label>
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
                    className="font-mono text-xs h-8"
                  />
                  <p className="text-[10px] text-muted-foreground/60">
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
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || !url.trim()}
          >
            {submitting
              ? editingResource
                ? "Saving..."
                : "Creating..."
              : editingResource
                ? "Save Changes"
                : "Create Resource"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
