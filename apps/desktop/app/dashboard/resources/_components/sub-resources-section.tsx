"use client";

import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Switch } from "@repo/ui/switch";
import { Globe, Network, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";
import type { ISubResource, SubResourceCheck } from "@/lib/data-types";
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

function statusDot(sub: ISubResource): string {
  if (!sub.isActive) return "bg-muted-foreground/40";
  if (sub.lastStatus === "healthy") return "bg-accent";
  if (sub.lastStatus === "unhealthy") return "bg-red-500";
  return "bg-muted-foreground/40";
}

export function SubResourcesSection({
  resourceId,
  API,
}: {
  resourceId: string;
  API: denizApi;
}) {
  const [subs, setSubs] = useState<ISubResource[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ISubResource | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ISubResource | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    const result = await API.GET<{ subResources: ISubResource[] }>({
      endpoint: `resources/${resourceId}/sub-resources`,
    });
    if ("code" in result) {
      setSubs([]);
      toast.error("Failed to load sub-resources");
      return;
    }
    setSubs(result.subResources);
  }, [API, resourceId]);

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
    const result = editing
      ? await API.PATCH<{ subResource: ISubResource }>({
          endpoint: `resources/${resourceId}/sub-resources/${editing._id}`,
          body: payload,
        })
      : await API.POST<{ subResource: ISubResource }>({
          endpoint: `resources/${resourceId}/sub-resources`,
          body: payload,
        });
    setSaving(false);
    if ("code" in result) {
      toast.error("Failed to save sub-resource");
      return;
    }
    toast.success(editing ? "Sub-resource updated" : "Sub-resource created");
    setDialogOpen(false);
    await refresh();
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const result = await API.DELETE<{ status: string }>({
      endpoint: `resources/${resourceId}/sub-resources/${deleteTarget._id}`,
    });
    setDeleting(false);
    if ("code" in result) {
      toast.error("Failed to delete sub-resource");
      return;
    }
    setSubs((prev) =>
      prev ? prev.filter((s) => s._id !== deleteTarget._id) : prev,
    );
    setDeleteTarget(null);
    toast.success("Sub-resource removed");
  };

  const setCheck = (patch: Partial<CheckFormState>) =>
    setForm((f) => ({ ...f, check: { ...f.check, ...patch } }));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground/60">
          Sub-resources
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs gap-1 text-muted-foreground"
          onClick={openCreate}
        >
          <Plus className="size-3" />
          Add
        </Button>
      </div>

      {subs === null ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : subs.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 border border-dashed border-border/50 rounded-lg px-4 py-5 text-center">
          No sub-resources tracked yet.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {subs.map((sub) => (
            <div
              key={sub._id}
              className="px-3 py-2.5 rounded-lg border border-border/50"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`size-1.5 rounded-full shrink-0 ${statusDot(sub)}`}
                />
                {sub.check.type === "http" ? (
                  <Globe className="size-3 text-muted-foreground/60 shrink-0" />
                ) : (
                  <Network className="size-3 text-muted-foreground/60 shrink-0" />
                )}
                <span className="text-sm font-medium">{sub.name}</span>
                <span className="text-[10px] text-muted-foreground/60 font-mono truncate flex-1">
                  {checkSummary(sub.check)}
                </span>
                {sub.lastResponseTimeMs != null && (
                  <span className="text-[10px] text-muted-foreground font-mono tabular-nums shrink-0">
                    {sub.lastResponseTimeMs} ms
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground font-mono uppercase shrink-0">
                  {sub.lastStatus ?? "unchecked"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 p-0 text-muted-foreground"
                  onClick={() => openEdit(sub)}
                >
                  <Pencil className="size-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 p-0 text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(sub)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
              {sub.uptime && sub.uptime.dailyHistory.length > 0 && (
                <div className="mt-2 ml-[18px]">
                  <UptimeBar history={sub.uptime.dailyHistory} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit sub-resource" : "Add sub-resource"}
            </DialogTitle>
            <DialogDescription>
              Track an HTTP health endpoint or a TCP port under this resource.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sub-name">Name</Label>
              <Input
                id="sub-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="MongoDB"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-description">Description</Label>
              <Input
                id="sub-description"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="Optional"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Check type</Label>
              <Select
                value={form.check.type}
                onValueChange={(v) =>
                  setCheck({ type: v as CheckFormState["type"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP health endpoint</SelectItem>
                  <SelectItem value="tcp">TCP port</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.check.type === "http" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="sub-url">URL</Label>
                  <Input
                    id="sub-url"
                    value={form.check.url}
                    onChange={(e) => setCheck({ url: e.target.value })}
                    placeholder="https://search.denizlg24.com/health"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="sub-status">Status</Label>
                    <Input
                      id="sub-status"
                      value={form.check.expectStatus}
                      onChange={(e) =>
                        setCheck({ expectStatus: e.target.value })
                      }
                      placeholder="any 2xx"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sub-json-path">JSON path</Label>
                    <Input
                      id="sub-json-path"
                      value={form.check.expectJsonPath}
                      onChange={(e) =>
                        setCheck({ expectJsonPath: e.target.value })
                      }
                      placeholder="status"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sub-equals">Equals</Label>
                    <Input
                      id="sub-equals"
                      value={form.check.expectEquals}
                      onChange={(e) =>
                        setCheck({ expectEquals: e.target.value })
                      }
                      placeholder="available"
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="sub-host">Host</Label>
                  <Input
                    id="sub-host"
                    value={form.check.host}
                    onChange={(e) => setCheck({ host: e.target.value })}
                    placeholder="mongodb.denizlg24.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sub-port">Port</Label>
                  <Input
                    id="sub-port"
                    value={form.check.port}
                    onChange={(e) => setCheck({ port: e.target.value })}
                    placeholder="27017"
                  />
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch
                  id="sub-public"
                  checked={form.isPublic}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, isPublic: v }))
                  }
                />
                <Label htmlFor="sub-public" className="text-sm">
                  Public
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="sub-active"
                  checked={form.isActive}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, isActive: v }))
                  }
                />
                <Label htmlFor="sub-active" className="text-sm">
                  Active
                </Label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !form.name.trim()}>
              {saving ? "Saving..." : editing ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Sub-resource</DialogTitle>
            <DialogDescription>
              This removes {deleteTarget?.name} and its health check history.
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={remove} disabled={deleting}>
              {deleting ? "Removing..." : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
