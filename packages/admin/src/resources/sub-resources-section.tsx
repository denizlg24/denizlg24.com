"use client";

import type { ISubResource, SubResourceCheck } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { Switch } from "@repo/ui/switch";
import { RowActions } from "@repo/ui/toolbar";
import { Globe, Network, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { UptimeBar } from "./uptime-bar";

interface CheckFormState {
  type: "http" | "tcp";
  url: string;
  expectStatus: string;
  expectJsonPath: string;
  expectEquals: string;
  host: string;
  port: string;
}

interface FormState {
  name: string;
  description: string;
  isPublic: boolean;
  isActive: boolean;
  check: CheckFormState;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  isPublic: true,
  isActive: true,
  check: {
    type: "http",
    url: "",
    expectStatus: "",
    expectJsonPath: "",
    expectEquals: "",
    host: "",
    port: "",
  },
};

function formToPayload(form: FormState) {
  const check: SubResourceCheck =
    form.check.type === "http"
      ? {
          type: "http",
          url: form.check.url.trim(),
          expectStatus: form.check.expectStatus.trim()
            ? Number(form.check.expectStatus)
            : null,
          expectJsonPath: form.check.expectJsonPath.trim() || null,
          expectEquals: form.check.expectEquals.trim() || null,
        }
      : {
          type: "tcp",
          host: form.check.host.trim(),
          port: Number(form.check.port),
        };

  return {
    name: form.name.trim(),
    description: form.description.trim(),
    isPublic: form.isPublic,
    isActive: form.isActive,
    check,
  };
}

function subToForm(sub: ISubResource): FormState {
  return {
    name: sub.name,
    description: sub.description,
    isPublic: sub.isPublic,
    isActive: sub.isActive,
    check:
      sub.check.type === "http"
        ? {
            ...EMPTY_FORM.check,
            type: "http",
            url: sub.check.url,
            expectStatus: sub.check.expectStatus?.toString() ?? "",
            expectJsonPath: sub.check.expectJsonPath ?? "",
            expectEquals: sub.check.expectEquals ?? "",
          }
        : {
            ...EMPTY_FORM.check,
            type: "tcp",
            host: sub.check.host,
            port: sub.check.port.toString(),
          },
  };
}

function checkSummary(check: SubResourceCheck): string {
  if (check.type === "http") return check.url;
  return `${check.host}:${check.port}`;
}

function subTone(sub: ISubResource): StatusTone {
  if (!sub.isActive) return "muted";
  if (sub.lastStatus === "healthy") return "good";
  if (sub.lastStatus === "unhealthy") return "critical";
  return "muted";
}

function isCheckType(value: string): value is CheckFormState["type"] {
  return value === "http" || value === "tcp";
}

function checkIsComplete(check: CheckFormState): boolean {
  if (check.type === "http") {
    if (!check.url.trim()) return false;
    const status = check.expectStatus.trim();
    return status === "" || Number.isInteger(Number(status));
  }
  const port = Number(check.port);
  return (
    check.host.trim() !== "" &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535
  );
}

export function SubResourcesSection({ resourceId }: { resourceId: string }) {
  const { client } = useAdmin();
  const [subs, setSubs] = useState<ISubResource[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ISubResource | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ISubResource | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await client.get<{ subResources: ISubResource[] }>(
        `resources/${resourceId}/sub-resources`,
      );
      setSubs(result.subResources);
    } catch {
      setSubs([]);
      toast.error("Failed to load sub-resources");
    }
  }, [client, resourceId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (sub: ISubResource) => {
    setEditing(sub);
    setForm(subToForm(sub));
    setDialogOpen(true);
  };

  const save = async () => {
    setSaving(true);
    const payload = formToPayload(form);
    try {
      if (editing) {
        await client.patch<{ subResource: ISubResource }>(
          `resources/${resourceId}/sub-resources/${editing._id}`,
          payload,
        );
      } else {
        await client.post<{ subResource: ISubResource }>(
          `resources/${resourceId}/sub-resources`,
          payload,
        );
      }
      toast.success(editing ? "Sub-resource updated" : "Sub-resource created");
      setDialogOpen(false);
      await refresh();
    } catch {
      toast.error("Failed to save sub-resource");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (target: ISubResource) => {
    try {
      await client.del(`resources/${resourceId}/sub-resources/${target._id}`);
      setSubs((prev) =>
        prev ? prev.filter((s) => s._id !== target._id) : prev,
      );
      toast.success("Sub-resource removed");
    } catch {
      toast.error("Failed to delete sub-resource");
    }
  };

  const setCheck = (patch: Partial<CheckFormState>) =>
    setForm((f) => ({ ...f, check: { ...f.check, ...patch } }));

  const total = subs?.length ?? 0;
  const upCount =
    subs?.filter((s) => s.isActive && s.lastStatus === "healthy").length ?? 0;
  const downCount =
    subs?.filter((s) => s.isActive && s.lastStatus === "unhealthy").length ?? 0;

  return (
    <Section
      title="Sub-resources"
      count={total > 0 ? total : undefined}
      actions={
        <>
          {upCount > 0 && (
            <span className="text-xs tabular-nums text-status-good">
              {upCount} up
            </span>
          )}
          {downCount > 0 && (
            <span className="text-xs tabular-nums text-status-critical">
              {downCount} down
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Add sub-resource"
            onClick={openCreate}
          >
            <Plus />
          </Button>
        </>
      }
    >
      {subs === null ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : subs.length === 0 ? (
        <EmptyState compact icon={<Network />} label="No sub-resources" />
      ) : (
        <List>
          {subs.map((sub) => (
            <ListRow
              key={sub._id}
              leading={
                <StatusDot
                  tone={subTone(sub)}
                  label={sub.lastStatus ?? "unchecked"}
                />
              }
              title={
                <span className="flex items-center gap-2">
                  {sub.check.type === "http" ? (
                    <Globe className="size-3 shrink-0 text-muted-foreground" />
                  ) : (
                    <Network className="size-3 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{sub.name}</span>
                </span>
              }
              description={
                <span className="font-mono">{checkSummary(sub.check)}</span>
              }
              meta={
                <>
                  {sub.lastResponseTimeMs != null && (
                    <span>{sub.lastResponseTimeMs} ms</span>
                  )}
                  <span className="hidden sm:inline">
                    {sub.lastStatus ?? "unchecked"}
                  </span>
                </>
              }
              trailing={
                <RowActions>
                  <DropdownMenuItem onClick={() => openEdit(sub)}>
                    <Pencil /> Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteTarget(sub)}
                  >
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </RowActions>
              }
            >
              {sub.uptime && sub.uptime.dailyHistory.length > 0 && (
                <span className="hidden w-44 shrink-0 md:block">
                  <UptimeBar history={sub.uptime.dailyHistory} />
                </span>
              )}
            </ListRow>
          ))}
        </List>
      )}

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "Edit sub-resource" : "Add sub-resource"}
        onSubmit={save}
        submitLabel={editing ? "Save" : "Create"}
        submitDisabled={!form.name.trim() || !checkIsComplete(form.check)}
        pending={saving}
      >
        <FormGrid>
          <FormField label="Name" htmlFor="sub-name">
            <Input
              id="sub-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="MongoDB"
              autoFocus
            />
          </FormField>
          <FormField label="Check">
            <Select
              value={form.check.type}
              onValueChange={(value) => {
                if (isCheckType(value)) setCheck({ type: value });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="http">HTTP</SelectItem>
                <SelectItem value="tcp">TCP</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField
            label="Description"
            htmlFor="sub-description"
            className="sm:col-span-2"
          >
            <Input
              id="sub-description"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </FormField>
          {form.check.type === "http" ? (
            <>
              <FormField
                label="URL"
                htmlFor="sub-url"
                className="sm:col-span-2"
              >
                <Input
                  id="sub-url"
                  value={form.check.url}
                  onChange={(e) => setCheck({ url: e.target.value })}
                  placeholder="https://search.denizlg24.com/health"
                  className="font-mono"
                />
              </FormField>
              <FormField label="Status" htmlFor="sub-status">
                <Input
                  id="sub-status"
                  inputMode="numeric"
                  value={form.check.expectStatus}
                  onChange={(e) => setCheck({ expectStatus: e.target.value })}
                  placeholder="2xx"
                  className="font-mono"
                />
              </FormField>
              <div className="hidden sm:block" />
              <FormField label="JSON path" htmlFor="sub-json-path">
                <Input
                  id="sub-json-path"
                  value={form.check.expectJsonPath}
                  onChange={(e) => setCheck({ expectJsonPath: e.target.value })}
                  placeholder="status"
                  className="font-mono"
                />
              </FormField>
              <FormField label="Equals" htmlFor="sub-equals">
                <Input
                  id="sub-equals"
                  value={form.check.expectEquals}
                  onChange={(e) => setCheck({ expectEquals: e.target.value })}
                  placeholder="available"
                  className="font-mono"
                />
              </FormField>
            </>
          ) : (
            <>
              <FormField label="Host" htmlFor="sub-host">
                <Input
                  id="sub-host"
                  value={form.check.host}
                  onChange={(e) => setCheck({ host: e.target.value })}
                  placeholder="mongodb.denizlg24.com"
                  className="font-mono"
                />
              </FormField>
              <FormField label="Port" htmlFor="sub-port">
                <Input
                  id="sub-port"
                  inputMode="numeric"
                  value={form.check.port}
                  onChange={(e) => setCheck({ port: e.target.value })}
                  placeholder="27017"
                  className="font-mono"
                />
              </FormField>
            </>
          )}
          <div className="flex items-center gap-2">
            <Switch
              id="sub-public"
              checked={form.isPublic}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isPublic: v }))}
            />
            <label htmlFor="sub-public" className="text-sm text-accent-strong">
              Public
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="sub-active"
              checked={form.isActive}
              onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
            />
            <label htmlFor="sub-active" className="text-sm text-accent-strong">
              Active
            </label>
          </div>
        </FormGrid>
      </FormDialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? "sub-resource"}?`}
        description="Its health history goes with it."
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) void remove(deleteTarget);
        }}
      />
    </Section>
  );
}
