"use client";

import type { ITimetableEntry } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { PageHeader } from "@repo/ui/page-header";
import {
  CalendarDays,
  Clock,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { TimetableForm, type TimetableFormValues } from "./timetable-form";
import { TimetableGrid } from "./timetable-grid";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function TimetableSkeleton() {
  const { slots } = useAdmin();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<CalendarDays className="size-4 text-muted-foreground" />}
        title="Timetable"
      >
        <Button size="sm" disabled>
          <Plus />
          Add Entry
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <TimetableGrid entries={[]} />
      </div>
    </div>
  );
}

export function TimetablePage() {
  const { client, slots, platform } = useAdmin();

  const [entries, setEntries] = useState<ITimetableEntry[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [viewingEntry, setViewingEntry] = useState<ITimetableEntry | null>(
    null,
  );
  const [editingEntry, setEditingEntry] = useState<ITimetableEntry | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<ITimetableEntry | null>(
    null,
  );
  const [initialLoading, setInitialLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const fetchEntries = useCallback(async () => {
    try {
      const result = await client.get<{ entries: ITimetableEntry[] }>(
        "timetable",
      );
      setEntries(result.entries || []);
    } catch {
      toast.error("Failed to load timetable");
      setEntries([]);
    }
  }, [client]);

  useEffect(() => {
    let active = true;
    fetchEntries().finally(() => {
      if (active) setInitialLoading(false);
    });
    return () => {
      active = false;
    };
  }, [fetchEntries]);

  if (initialLoading) {
    return <TimetableSkeleton />;
  }

  const handleCreate = async (values: TimetableFormValues) => {
    setIsLoading(true);
    try {
      const result = await client.post<{ entry: ITimetableEntry }>(
        "timetable",
        values,
      );
      setEntries((prev) => [...prev, result.entry]);
      setFormOpen(false);
      toast.success("Timetable entry created");
    } catch {
      toast.error("Failed to create entry");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async (values: TimetableFormValues) => {
    if (!editingEntry) return;
    setIsLoading(true);
    try {
      const result = await client.patch<{ entry: ITimetableEntry }>(
        `timetable/${editingEntry._id}`,
        values,
      );
      setEntries((prev) =>
        prev.map((e) => (e._id === editingEntry._id ? result.entry : e)),
      );
      setEditingEntry(null);
      toast.success("Timetable entry updated");
    } catch {
      toast.error("Failed to update entry");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsLoading(true);
    try {
      await client.del<{ success: true }>(`timetable/${deleteTarget._id}`);
      setEntries((prev) => prev.filter((e) => e._id !== deleteTarget._id));
      setDeleteTarget(null);
      toast.success("Timetable entry deleted");
    } catch {
      toast.error("Failed to delete entry");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<CalendarDays className="size-4 text-muted-foreground" />}
        title="Timetable"
      >
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus />
          Add Entry
        </Button>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <TimetableGrid
          entries={entries}
          onEntryClick={(entry) => setViewingEntry(entry)}
        />
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Timetable Entry</DialogTitle>
            <DialogDescription>
              Create a new recurring weekly entry.
            </DialogDescription>
          </DialogHeader>
          <TimetableForm
            onSubmit={handleCreate}
            isLoading={isLoading}
            mode="create"
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!viewingEntry}
        onOpenChange={(open) => !open && setViewingEntry(null)}
      >
        <DialogContent className="sm:max-w-md">
          {viewingEntry && (
            <>
              <DialogHeader>
                <DialogTitle>{viewingEntry.title}</DialogTitle>
                <DialogDescription>
                  {DAY_NAMES[viewingEntry.dayOfWeek]}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="size-4 shrink-0" />
                  <span>
                    {viewingEntry.startTime} - {viewingEntry.endTime}
                  </span>
                </div>

                {viewingEntry.place && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="size-4 shrink-0" />
                    <span>{viewingEntry.place}</span>
                  </div>
                )}

                {viewingEntry.links.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {viewingEntry.links.map((link) => (
                      <button
                        key={link._id}
                        type="button"
                        className="flex items-center gap-2 text-left text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => platform.openExternal(link.url)}
                      >
                        <ExternalLink className="size-4 shrink-0" />
                        <span className="underline underline-offset-2">
                          {link.label}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {!viewingEntry.isActive && (
                  <p className="text-xs text-muted-foreground italic">
                    This entry is currently inactive.
                  </p>
                )}
              </div>

              <DialogFooter className="flex-row gap-2 sm:justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => {
                    setDeleteTarget(viewingEntry);
                    setViewingEntry(null);
                  }}
                >
                  <Trash2 />
                  Delete
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingEntry(viewingEntry);
                    setViewingEntry(null);
                  }}
                >
                  <Pencil />
                  Edit
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!editingEntry}
        onOpenChange={(open) => !open && setEditingEntry(null)}
      >
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Timetable Entry</DialogTitle>
            <DialogDescription>Update this entry.</DialogDescription>
          </DialogHeader>
          {editingEntry && (
            <TimetableForm
              key={editingEntry._id}
              initialData={{
                title: editingEntry.title,
                dayOfWeek: editingEntry.dayOfWeek,
                startTime: editingEntry.startTime,
                endTime: editingEntry.endTime,
                place: editingEntry.place,
                links: editingEntry.links.map((l) => ({
                  label: l.label,
                  url: l.url,
                  icon: l.icon,
                })),
                color: editingEntry.color,
                isActive: editingEntry.isActive,
              }}
              onSubmit={handleUpdate}
              isLoading={isLoading}
              mode="edit"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Entry</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.title}&quot;?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isLoading}
            >
              {isLoading ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
