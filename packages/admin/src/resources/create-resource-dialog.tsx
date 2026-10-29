"use client";

import type { IResource } from "@repo/schemas";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { SectionLabel } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import { useState } from "react";

type ResourceType = IResource["type"];

const RESOURCE_TYPES: { value: ResourceType; label: string }[] = [
  { value: "pi", label: "Raspberry Pi" },
  { value: "vps", label: "VPS" },
  { value: "api", label: "API" },
  { value: "service", label: "Service" },
];

function isResourceType(value: string): value is ResourceType {
  return RESOURCE_TYPES.some((option) => option.value === value);
}

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
  const [isActive, setIsActive] = useState(editingResource?.isActive ?? true);
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
    setIsActive(editingResource?.isActive ?? true);
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
      if (hmacSecret.trim()) agentService.hmacSecret = hmacSecret;

      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        url: url.trim(),
        type,
        isActive,
        agentService,
      });
      if (!editingResource) resetForm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
      title={isEdit ? "Edit resource" : "New resource"}
      onSubmit={handleSubmit}
      submitLabel={isEdit ? "Save" : "Create"}
      submitDisabled={!name.trim() || !url.trim()}
      pending={submitting}
    >
      <FormGrid>
        <FormField label="Name" htmlFor="res-name">
          <Input
            id="res-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="api-server"
            autoFocus
          />
        </FormField>
        <FormField label="Type">
          <Select
            value={type}
            onValueChange={(value) => {
              if (isResourceType(value)) setType(value);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESOURCE_TYPES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="URL" htmlFor="res-url" className="sm:col-span-2">
          <Input
            id="res-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://api.example.com"
            className="font-mono"
          />
        </FormField>
        <FormField
          label="Description"
          htmlFor="res-desc"
          className="sm:col-span-2"
        >
          <Textarea
            id="res-desc"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
          />
        </FormField>
        {isEdit && (
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch
              id="res-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
            <label htmlFor="res-active" className="text-sm text-accent-strong">
              Active
            </label>
          </div>
        )}
      </FormGrid>

      <SectionLabel
        actions={
          <Switch
            checked={agentEnabled}
            onCheckedChange={setAgentEnabled}
            aria-label="Agent service"
          />
        }
      >
        Agent service
      </SectionLabel>
      {agentEnabled && (
        <FormGrid>
          <FormField label="Node ID" htmlFor="res-node">
            <Input
              id="res-node"
              placeholder="pi-zero-1"
              value={agentNodeId}
              onChange={(event) => setAgentNodeId(event.target.value)}
              className="font-mono"
            />
          </FormField>
          <FormField label="HMAC secret" htmlFor="res-hmac">
            <Input
              id="res-hmac"
              type="password"
              placeholder={isEdit ? "Unchanged" : undefined}
              value={hmacSecret}
              onChange={(event) => setHmacSecret(event.target.value)}
              autoComplete="off"
              className="font-mono"
            />
          </FormField>
        </FormGrid>
      )}
    </FormDialog>
  );
}
