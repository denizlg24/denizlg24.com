"use client";

import {
  CalendarDays,
  Clock,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  TimetableForm,
  type TimetableFormValues,
} from "@/app/dashboard/timetable/_components/timetable-form";
import { TimetableGrid } from "@/app/dashboard/timetable/_components/timetable-grid";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { ITimetableEntry } from "@/lib/data-types";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

interface TimetableManagerProps {
  initialEntries: ITimetableEntry[];
}

export default function TimetableManager({
  initialEntries,
}: TimetableManagerProps) {
  const { settings, loading: loadingSettings } = useUserSettings();

  const API = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [entries, setEntries] = useState<ITimetableEntry[]>(initialEntries);
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

  const fetchEntries = async () => {
    if (!API) return;
    try {
      const result = await API.GET<{ entries: ITimetableEntry[] }>({
        endpoint: "timetable",
      });
      if ("code" in result) {
        setEntries([]);
        return;
      }
      setEntries(result.entries || []);
    } catch (error) {
      console.error("Error fetching timetable entries:", error);
    }
  };

  useEffect(() => {
    if (!API || !initialLoading) return;
    fetchEntries().finally(() => setInitialLoading(false));
  }, [API, initialLoading, fetchEntries]);

  if (loadingSettings || !API || initialLoading) {
    return (
      <div className="flex flex-col gap-2 pb-4">
        <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
          <CalendarDays className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">Timetable</span>
          <Button size={"sm"}>
            <Plus />
            Add Entry
          </Button>
        </div>
        <TimetableGrid entries={[]} onEntryClick={() => {}} />
      </div>
    );
  }

  const handleCreate = async (values: TimetableFormValues) => {
    setIsLoading(true);
    try {
      const result = await API.POST<{}>({
        endpoint: "timetable",
        body: values,
      });
      if ("code" in result) {
        return;
      }
      const newEntry: ITimetableEntry = {
        _id: `${Math.random() * 1000}_fake_id`,
        ...values,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        links: (values.links ?? []).map((l) => ({
          _id: `${Math.random() * 1000}_link`,
          label: l.label,
          url: l.url,
          icon: l.icon,
        })),
      };
      setEntries((prev) => [...prev, newEntry]);
      setFormOpen(false);
    } catch (error) {
      console.error("Error creating entry:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async (values: TimetableFormValues) => {
    if (!editingEntry) return;
    setIsLoading(true);
    try {
      const result = await API.PATCH<{}>({
        endpoint: `timetable/${editingEntry._id}`,
        body: values,
      });
      if ("code" in result) {
        return;
      }
      const updatedEntry: ITimetableEntry = {
        ...editingEntry,
        ...values,
        links: (values.links ?? []).map((l) => ({
          _id: `${Math.random() * 1000}_link`,
          label: l.label,
          url: l.url,
          icon: l.icon,
        })),
      };
      setEntries((prev) =>
        prev.map((e) => (e._id === editingEntry._id ? updatedEntry : e)),
      );
      setEditingEntry(null);
    } catch (error) {
      console.error("Error updating entry:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsLoading(true);
    try {
      const result = await API.DELETE<{}>({
        endpoint: `timetable/${deleteTarget._id}`,
      });
      if ("code" in result) {
        return;
      }
      setEntries((prev) => prev.filter((e) => e._id !== deleteTarget._id));
      setDeleteTarget(null);
    } catch (error) {
      console.error("Error deleting entry:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 pb-4">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <CalendarDays className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Timetable</span>
        <Button
          size={"sm"}
          onClick={() => {
            setFormOpen(true);
          }}
        >
          <Plus />
          Add Entry
        </Button>
      </div>
      <TimetableGrid
        entries={entries}
        onEntryClick={(entry) => setViewingEntry(entry)}
      />

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
                    {viewingEntry.startTime} – {viewingEntry.endTime}
                  </span>
                </div>

                {viewingEntry.place && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="size-4 shrink-0" />
                    <span>{viewingEntry.place}</span>
                  </div>
                )}

                {viewingEntry.links && viewingEntry.links.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {viewingEntry.links.map((link) => (
                      <a
                        key={link._id}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="size-4 shrink-0" />
                        <span className="underline underline-offset-2">
                          {link.label}
                        </span>
                      </a>
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
                links: editingEntry.links?.map((l) => ({
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
