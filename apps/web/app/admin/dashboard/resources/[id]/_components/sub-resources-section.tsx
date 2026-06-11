"use client";

import { Globe, Network, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { ResourceUptimeData } from "@/lib/resource-agent";
import type { SubResourceCheck } from "@/models/resource-db/SubResource";
import { UptimeBar } from "../../_components/uptime-bar";

interface AdminSubResource {
  _id: string;
  parentResourceId: string;
  name: string;
  description: string;
  isActive: boolean;
  isPublic: boolean;
  check: SubResourceCheck;
  lastCheckedAt: string | null;
  lastStatus: "healthy" | "unhealthy" | null;
  lastResponseTimeMs: number | null;
  uptime: ResourceUptimeData | null;
}

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
  const check =
    form.check.type === "http"
      ? {
          type: "http" as const,
          url: form.check.url.trim(),
          expectStatus: form.check.expectStatus.trim()
            ? Number(form.check.expectStatus)
            : null,
          expectJsonPath: form.check.expectJsonPath.trim() || null,
          expectEquals: form.check.expectEquals.trim() || null,
        }
      : {
          type: "tcp" as const,
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

function subToForm(sub: AdminSubResource): FormState {
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

export function SubResourcesSection({ resourceId }: { resourceId: string }) {
  const [subs, setSubs] = useState<AdminSubResource[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminSubResource | null>(null);
  const [deleting, setDeleting] = useState<AdminSubResource | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  const baseUrl = `/api/admin/resources/${resourceId}/sub-resources`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(baseUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed with ${res.status}`);
      const data = await res.json();
      setSubs(data.subResources ?? []);
    } catch {
      setSubs([]);
      toast.error("Failed to load sub-resources");
    }
  }, [baseUrl]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (sub: AdminSubResource) => {
    setEditing(sub);
    setForm(subToForm(sub));
    setDialogOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        editing ? `${baseUrl}/${editing._id}` : baseUrl,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formToPayload(form)),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to save sub-resource");
        return;
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

  const remove = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`${baseUrl}/${deleting._id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Failed to delete sub-resource");
        return;
      }
      toast.success("Sub-resource deleted");
      setSubs((prev) =>
        prev ? prev.filter((s) => s._id !== deleting._id) : prev,
      );
    } catch {
      toast.error("Failed to delete sub-resource");
    } finally {
      setDeleting(null);
    }
  };

  const runChecksNow = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/admin/resources/health-check", {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Failed with ${res.status}`);
      toast.success("Health checks completed");
      await refresh();
    } catch {
      toast.error("Failed to run health checks");
    } finally {
      setChecking(false);
    }
  };

  const setCheck = (patch: Partial<CheckFormState>) =>
    setForm((f) => ({ ...f, check: { ...f.check, ...patch } }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Sub-resources</h2>
          <p className="text-xs text-muted-foreground">
            Services monitored under this resource (HTTP health endpoints or
            TCP ports).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={runChecksNow}
            disabled={checking}
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1.5 ${checking ? "animate-spin" : ""}`}
            />
            Check now
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Add
          </Button>
        </div>
      </div>

      {subs === null ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : subs.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed rounded-md px-4 py-6 text-center">
          No sub-resources yet. Add one to start tracking it.
        </p>
      ) : (
        <div className="space-y-2">
          {subs.map((sub) => (
            <div key={sub._id} className="border rounded-md px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {sub.check.type === "http" ? (
                      <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <Network className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-sm font-medium">{sub.name}</span>
                    <Badge
                      variant={
                        sub.lastStatus === "healthy"
                          ? "default"
                          : sub.lastStatus === "unhealthy"
                            ? "destructive"
                            : "secondary"
                      }
                      className="text-[10px]"
                    >
                      {sub.lastStatus ?? "never checked"}
                    </Badge>
                    {!sub.isActive && (
                      <Badge variant="outline" className="text-[10px]">
                        paused
                      </Badge>
                    )}
                    {!sub.isPublic && (
                      <Badge variant="outline" className="text-[10px]">
                        private
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {checkSummary(sub.check)}
                    {sub.lastResponseTimeMs != null && (
                      <span className="tabular-nums">
                        {" "}
                        · {sub.lastResponseTimeMs} ms
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openEdit(sub)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => setDeleting(sub)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              {sub.uptime && (
                <div className="mt-2">
                  <UptimeBar
                    dailyHistory={sub.uptime.dailyHistory}
                    lastCheckedAt={sub.lastCheckedAt}
                  />
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
              {saving ? "Saving…" : editing ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the sub-resource and its health check history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
