"use client";

import type { ITimetableEntry } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import { CalendarDays, Clock, ExternalLink, MapPin, Plus } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RecordDialog } from "../calendar/record-dialog";
import { useAdmin } from "../provider";
import {
  TimetableFormDialog,
  type TimetableFormValues,
} from "./timetable-form";
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

function TimetableChrome({
  onAdd,
  children,
}: {
  onAdd?: () => void;
  children: ReactNode;
}) {
  const { slots } = useAdmin();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<CalendarDays />}
        title="Timetable"
      >
        <Button size="sm" onClick={onAdd} disabled={!onAdd}>
          <Plus />
          Add
        </Button>
      </PageHeader>
      <PageBody width="full">{children}</PageBody>
    </Page>
  );
}

export function TimetableSkeleton() {
  return (
    <TimetableChrome>
      <TimetableGrid entries={[]} />
    </TimetableChrome>
  );
}

function toFormValues(entry: ITimetableEntry): Partial<TimetableFormValues> {
  return {
    title: entry.title,
    dayOfWeek: entry.dayOfWeek,
    startTime: entry.startTime,
    endTime: entry.endTime,
    place: entry.place,
    links: entry.links.map((l) => ({
      label: l.label,
      url: l.url,
      icon: l.icon,
    })),
    color: entry.color,
    isActive: entry.isActive,
  };
}

export function TimetablePage() {
  const { client, platform } = useAdmin();

  const [entries, setEntries] = useState<ITimetableEntry[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [viewingEntry, setViewingEntry] = useState<ITimetableEntry | null>(
    null,
  );
  const [editingEntry, setEditingEntry] = useState<ITimetableEntry | null>(
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
      toast.success("Entry created");
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
      toast.success("Entry updated");
    } catch {
      toast.error("Failed to update entry");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (entry: ITimetableEntry) => {
    setIsLoading(true);
    try {
      await client.del<{ success: true }>(`timetable/${entry._id}`);
      setEntries((prev) => prev.filter((e) => e._id !== entry._id));
      setViewingEntry(null);
      setEditingEntry(null);
      toast.success("Entry deleted");
    } catch {
      toast.error("Failed to delete entry");
    } finally {
      setIsLoading(false);
    }
  };

  const deleteButton = (entry: ITimetableEntry) => (
    <ConfirmButton
      trigger={
        <Button
          type="button"
          variant="ghost"
          className="text-destructive"
          disabled={isLoading}
        >
          Delete
        </Button>
      }
      title={`Delete "${entry.title}"?`}
      actionLabel="Delete"
      destructive
      pending={isLoading}
      onConfirm={() => handleDelete(entry)}
    />
  );

  return (
    <TimetableChrome
      onAdd={() => {
        setCreateKey((key) => key + 1);
        setFormOpen(true);
      }}
    >
      <TimetableGrid
        entries={entries}
        onEntryClick={(entry) => setViewingEntry(entry)}
      />

      <TimetableFormDialog
        key={`create-${createKey}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        onSubmit={handleCreate}
        isLoading={isLoading}
        mode="create"
      />

      {editingEntry && (
        <TimetableFormDialog
          key={editingEntry._id}
          open
          onOpenChange={(open) => !open && setEditingEntry(null)}
          initialData={toFormValues(editingEntry)}
          onSubmit={handleUpdate}
          isLoading={isLoading}
          mode="edit"
          footerStart={deleteButton(editingEntry)}
        />
      )}

      {viewingEntry && (
        <RecordDialog
          open
          onOpenChange={(open) => !open && setViewingEntry(null)}
          title={viewingEntry.title}
          meta={
            viewingEntry.isActive ? undefined : (
              <Badge variant="outline">Inactive</Badge>
            )
          }
          footerStart={deleteButton(viewingEntry)}
          footer={
            <Button
              onClick={() => {
                setEditingEntry(viewingEntry);
                setViewingEntry(null);
              }}
            >
              Edit
            </Button>
          }
        >
          <Properties>
            <Property icon={<CalendarDays />} label="Day">
              {DAY_NAMES[viewingEntry.dayOfWeek]}
            </Property>
            <Property icon={<Clock />} label="Time">
              <span className="tabular-nums">
                {viewingEntry.startTime}–{viewingEntry.endTime}
              </span>
            </Property>
            <Property icon={<MapPin />} label="Place">
              {viewingEntry.place || (
                <span className="text-muted-foreground">—</span>
              )}
            </Property>
          </Properties>
          {viewingEntry.links.length > 0 && (
            <Section title="Links" count={viewingEntry.links.length}>
              <List>
                {viewingEntry.links.map((link) => (
                  <ListRow
                    key={link._id}
                    leading={<ExternalLink />}
                    title={link.label}
                    description={link.url}
                    onClick={() => platform.openExternal(link.url)}
                  />
                ))}
              </List>
            </Section>
          )}
        </RecordDialog>
      )}
    </TimetableChrome>
  );
}
