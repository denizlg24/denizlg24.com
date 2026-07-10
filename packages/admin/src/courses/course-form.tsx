"use client";

import type {
  CourseStatus,
  ICourse,
  ICourseCustomField,
  ICourseLink,
  ICourseManualDeadline,
  ICourseOption,
  ICourseOptions,
  ICourseTriageContext,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Separator } from "@repo/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import {
  BookOpen,
  CalendarDays,
  CheckSquare,
  Clock,
  ExternalLink,
  FileText,
  Kanban,
  Link as LinkIcon,
  Plus,
  Radio,
  Trash2,
  UsersRound,
} from "lucide-react";
import type * as React from "react";
import { useMemo, useState } from "react";

const COURSE_COLORS = [
  "#536dfe",
  "#a1bc98",
  "#d97706",
  "#0f766e",
  "#be123c",
  "#7c3aed",
  "#334155",
  "#c0352b",
];

type LinkDraft = Omit<ICourseLink, "_id"> & { _id?: string };
type CustomFieldDraft = Omit<ICourseCustomField, "_id"> & { _id?: string };
type TriageContextDraft = Omit<ICourseTriageContext, "_id"> & {
  _id?: string;
};
type ManualDeadlineDraft = Omit<ICourseManualDeadline, "_id"> & {
  _id?: string;
};

export interface CourseFormValues {
  name: string;
  code?: string;
  semester?: string;
  description?: string;
  homepageUrl?: string;
  instructorName?: string;
  location?: string;
  color?: string;
  status: CourseStatus;
  startsOn?: string;
  endsOn?: string;
  links: LinkDraft[];
  customFields: CustomFieldDraft[];
  triageContext: TriageContextDraft[];
  manualDeadlines: ManualDeadlineDraft[];
  timetableEntryIds: string[];
  calendarEventIds: string[];
  kanbanBoardIds: string[];
  noteIds: string[];
  personIds: string[];
  resourceIds: string[];
}

interface CourseFormProps {
  initialCourse?: ICourse;
  options: ICourseOptions;
  onSubmit: (values: CourseFormValues) => Promise<void>;
  onCancel: () => void;
  isLoading: boolean;
  mode: "create" | "edit";
}

function toDateInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toDateTimeInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function fromDateTimeInput(value: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function formDefaults(initial?: ICourse): CourseFormValues {
  return {
    name: initial?.name ?? "",
    code: initial?.code ?? "",
    semester: initial?.semester ?? "",
    description: initial?.description ?? "",
    homepageUrl: initial?.homepageUrl ?? "",
    instructorName: initial?.instructorName ?? "",
    location: initial?.location ?? "",
    color: initial?.color ?? COURSE_COLORS[0],
    status: initial?.status ?? "active",
    startsOn: toDateInput(initial?.startsOn),
    endsOn: toDateInput(initial?.endsOn),
    links: initial?.links ?? [],
    customFields: initial?.customFields ?? [],
    triageContext: initial?.triageContext ?? [],
    manualDeadlines:
      initial?.manualDeadlines.map((deadline) => ({
        ...deadline,
        dueAt: toDateTimeInput(deadline.dueAt),
      })) ?? [],
    timetableEntryIds: initial?.timetableEntryIds ?? [],
    calendarEventIds: initial?.calendarEventIds ?? [],
    kanbanBoardIds: initial?.kanbanBoardIds ?? [],
    noteIds: initial?.noteIds ?? [],
    personIds: initial?.personIds ?? [],
    resourceIds: initial?.resourceIds ?? [],
  };
}

function normalizeSubmit(values: CourseFormValues): CourseFormValues {
  return {
    ...values,
    startsOn: values.startsOn || undefined,
    endsOn: values.endsOn || undefined,
    links: values.links
      .map((link) => ({
        label: link.label.trim(),
        url: link.url.trim(),
        icon: link.icon?.trim() || undefined,
      }))
      .filter((link) => link.label && link.url),
    customFields: values.customFields
      .map((field) => ({
        label: field.label.trim(),
        value: field.value.trim(),
      }))
      .filter((field) => field.label && field.value),
    triageContext: values.triageContext
      .map((field) => ({
        label: field.label.trim(),
        value: field.value.trim(),
        includeInTriage: field.includeInTriage,
      }))
      .filter((field) => field.label && field.value),
    manualDeadlines: values.manualDeadlines
      .map((deadline) => ({
        title: deadline.title.trim(),
        dueAt: fromDateTimeInput(deadline.dueAt),
        notes: deadline.notes?.trim() || undefined,
        url: deadline.url?.trim() || undefined,
        completed: deadline.completed,
      }))
      .filter((deadline) => deadline.title && deadline.dueAt),
  };
}

function toggleId(ids: string[], id: string) {
  return ids.includes(id)
    ? ids.filter((current) => current !== id)
    : [...ids, id];
}

function LinkedPicker({
  label,
  icon,
  options,
  selectedIds,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  options: ICourseOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      [option.title, option.subtitle, option.meta]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(needle)),
    );
  }, [options, query]);

  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {icon}
        <span className="text-sm font-medium">{label}</span>
        <Badge variant="secondary" className="ml-auto">
          {selectedIds.length}
        </Badge>
      </div>
      <div className="p-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter"
          className="h-8"
        />
      </div>
      <div className="max-h-48 overflow-y-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">No matches</p>
        ) : (
          filtered.map((option) => (
            <label
              key={option._id}
              className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-muted/60"
            >
              <Checkbox
                checked={selectedIds.includes(option._id)}
                onCheckedChange={() =>
                  onChange(toggleId(selectedIds, option._id))
                }
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{option.title}</span>
                {(option.subtitle || option.meta) && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {[option.subtitle, option.meta].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}

export function CourseForm({
  initialCourse,
  options,
  onSubmit,
  onCancel,
  isLoading,
  mode,
}: CourseFormProps) {
  const [values, setValues] = useState(() => formDefaults(initialCourse));

  const setField = <K extends keyof CourseFormValues>(
    field: K,
    value: CourseFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!values.name.trim()) return;
    await onSubmit(normalizeSubmit(values));
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
      <Tabs defaultValue="profile" className="min-h-0">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="deadlines">Deadlines</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="course-name">Name</Label>
              <Input
                id="course-name"
                value={values.name}
                onChange={(event) => setField("name", event.target.value)}
                placeholder="Course name"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="course-code">Code</Label>
              <Input
                id="course-code"
                value={values.code ?? ""}
                onChange={(event) => setField("code", event.target.value)}
                placeholder="CS 301"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="course-semester">Semester</Label>
              <Input
                id="course-semester"
                value={values.semester ?? ""}
                onChange={(event) => setField("semester", event.target.value)}
                placeholder="Fall 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="course-instructor">Instructor</Label>
              <Input
                id="course-instructor"
                value={values.instructorName ?? ""}
                onChange={(event) =>
                  setField("instructorName", event.target.value)
                }
                placeholder="Instructor"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="course-location">Location</Label>
              <Input
                id="course-location"
                value={values.location ?? ""}
                onChange={(event) => setField("location", event.target.value)}
                placeholder="Room / campus"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="course-homepage">Homepage</Label>
              <Input
                id="course-homepage"
                value={values.homepageUrl ?? ""}
                onChange={(event) =>
                  setField("homepageUrl", event.target.value)
                }
                placeholder="https://..."
                type="url"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="course-start">Starts</Label>
              <Input
                id="course-start"
                type="date"
                value={values.startsOn ?? ""}
                onChange={(event) => setField("startsOn", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="course-end">Ends</Label>
              <Input
                id="course-end"
                type="date"
                value={values.endsOn ?? ""}
                onChange={(event) => setField("endsOn", event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={values.status}
                onValueChange={(value) =>
                  setField("status", value as CourseStatus)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {COURSE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    onClick={() => setField("color", color)}
                    className={cn(
                      "size-7 rounded-full border transition-transform hover:scale-105",
                      values.color === color
                        ? "border-foreground ring-2 ring-ring/30"
                        : "border-border",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="course-description">Description</Label>
              <Textarea
                id="course-description"
                value={values.description ?? ""}
                onChange={(event) =>
                  setField("description", event.target.value)
                }
                rows={4}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Links</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setField("links", [
                    ...values.links,
                    { label: "", url: "", icon: "" },
                  ])
                }
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
            {values.links.map((link, index) => (
              <div key={link._id ?? index} className="flex gap-2">
                <Input
                  value={link.label}
                  placeholder="Label"
                  onChange={(event) => {
                    const links = [...values.links];
                    links[index] = { ...link, label: event.target.value };
                    setField("links", links);
                  }}
                />
                <Input
                  value={link.url}
                  placeholder="https://..."
                  onChange={(event) => {
                    const links = [...values.links];
                    links[index] = { ...link, url: event.target.value };
                    setField("links", links);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setField(
                      "links",
                      values.links.filter((_, current) => current !== index),
                    )
                  }
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Custom Fields</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setField("customFields", [
                    ...values.customFields,
                    { label: "", value: "" },
                  ])
                }
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
            {values.customFields.map((field, index) => (
              <div key={field._id ?? index} className="flex gap-2">
                <Input
                  value={field.label}
                  placeholder="Label"
                  onChange={(event) => {
                    const fields = [...values.customFields];
                    fields[index] = { ...field, label: event.target.value };
                    setField("customFields", fields);
                  }}
                />
                <Input
                  value={field.value}
                  placeholder="Value"
                  onChange={(event) => {
                    const fields = [...values.customFields];
                    fields[index] = { ...field, value: event.target.value };
                    setField("customFields", fields);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    setField(
                      "customFields",
                      values.customFields.filter(
                        (_, current) => current !== index,
                      ),
                    )
                  }
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Triage Context</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setField("triageContext", [
                    ...values.triageContext,
                    { label: "", value: "", includeInTriage: false },
                  ])
                }
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
            {values.triageContext.map((field, index) => (
              <div key={field._id ?? index} className="rounded-md border p-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[0.8fr_1fr_auto]">
                  <Input
                    value={field.label}
                    placeholder="Label"
                    onChange={(event) => {
                      const triageContext = [...values.triageContext];
                      triageContext[index] = {
                        ...field,
                        label: event.target.value,
                      };
                      setField("triageContext", triageContext);
                    }}
                  />
                  <Input
                    value={field.value}
                    placeholder="Value"
                    onChange={(event) => {
                      const triageContext = [...values.triageContext];
                      triageContext[index] = {
                        ...field,
                        value: event.target.value,
                      };
                      setField("triageContext", triageContext);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setField(
                        "triageContext",
                        values.triageContext.filter(
                          (_, current) => current !== index,
                        ),
                      )
                    }
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={field.includeInTriage}
                    onCheckedChange={(checked) => {
                      const triageContext = [...values.triageContext];
                      triageContext[index] = {
                        ...field,
                        includeInTriage: checked === true,
                      };
                      setField("triageContext", triageContext);
                    }}
                  />
                  Use in triage
                </label>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="records">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <LinkedPicker
              label="Timetable"
              icon={<Clock className="size-4 text-muted-foreground" />}
              options={options.timetableEntries}
              selectedIds={values.timetableEntryIds}
              onChange={(ids) => setField("timetableEntryIds", ids)}
            />
            <LinkedPicker
              label="Calendar"
              icon={<CalendarDays className="size-4 text-muted-foreground" />}
              options={options.calendarEvents}
              selectedIds={values.calendarEventIds}
              onChange={(ids) => setField("calendarEventIds", ids)}
            />
            <LinkedPicker
              label="Kanban"
              icon={<Kanban className="size-4 text-muted-foreground" />}
              options={options.kanbanBoards}
              selectedIds={values.kanbanBoardIds}
              onChange={(ids) => setField("kanbanBoardIds", ids)}
            />
            <LinkedPicker
              label="Notes"
              icon={<FileText className="size-4 text-muted-foreground" />}
              options={options.notes}
              selectedIds={values.noteIds}
              onChange={(ids) => setField("noteIds", ids)}
            />
            <LinkedPicker
              label="People"
              icon={<UsersRound className="size-4 text-muted-foreground" />}
              options={options.people}
              selectedIds={values.personIds}
              onChange={(ids) => setField("personIds", ids)}
            />
            <LinkedPicker
              label="Resources"
              icon={<Radio className="size-4 text-muted-foreground" />}
              options={options.resources}
              selectedIds={values.resourceIds}
              onChange={(ids) => setField("resourceIds", ids)}
            />
          </div>
        </TabsContent>

        <TabsContent value="deadlines" className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Manual Deadlines</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setField("manualDeadlines", [
                  ...values.manualDeadlines,
                  {
                    title: "",
                    dueAt: "",
                    notes: "",
                    url: "",
                    completed: false,
                  },
                ])
              }
            >
              <Plus className="size-3.5" />
              Add
            </Button>
          </div>
          {values.manualDeadlines.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No manual deadlines
            </div>
          ) : (
            values.manualDeadlines.map((deadline, index) => (
              <div
                key={deadline._id ?? index}
                className="rounded-md border p-3"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_14rem_auto]">
                  <Input
                    value={deadline.title}
                    placeholder="Title"
                    onChange={(event) => {
                      const deadlines = [...values.manualDeadlines];
                      deadlines[index] = {
                        ...deadline,
                        title: event.target.value,
                      };
                      setField("manualDeadlines", deadlines);
                    }}
                  />
                  <Input
                    type="datetime-local"
                    value={deadline.dueAt}
                    onChange={(event) => {
                      const deadlines = [...values.manualDeadlines];
                      deadlines[index] = {
                        ...deadline,
                        dueAt: event.target.value,
                      };
                      setField("manualDeadlines", deadlines);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setField(
                        "manualDeadlines",
                        values.manualDeadlines.filter(
                          (_, current) => current !== index,
                        ),
                      )
                    }
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    value={deadline.url ?? ""}
                    placeholder="URL"
                    onChange={(event) => {
                      const deadlines = [...values.manualDeadlines];
                      deadlines[index] = {
                        ...deadline,
                        url: event.target.value,
                      };
                      setField("manualDeadlines", deadlines);
                    }}
                  />
                  <label className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Checkbox
                      checked={deadline.completed}
                      onCheckedChange={(checked) => {
                        const deadlines = [...values.manualDeadlines];
                        deadlines[index] = {
                          ...deadline,
                          completed: checked === true,
                        };
                        setField("manualDeadlines", deadlines);
                      }}
                    />
                    <CheckSquare className="size-4 text-muted-foreground" />
                    Completed
                  </label>
                </div>
                <Textarea
                  className="mt-2 min-h-14"
                  value={deadline.notes ?? ""}
                  placeholder="Notes"
                  onChange={(event) => {
                    const deadlines = [...values.manualDeadlines];
                    deadlines[index] = {
                      ...deadline,
                      notes: event.target.value,
                    };
                    setField("manualDeadlines", deadlines);
                  }}
                />
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>

      <div className="flex justify-end gap-2 border-t bg-background px-1 py-3">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading || !values.name.trim()}>
          {isLoading
            ? mode === "edit"
              ? "Saving..."
              : "Creating..."
            : mode === "edit"
              ? "Save"
              : "Create"}
        </Button>
      </div>
    </form>
  );
}

export const courseRecordIcons = {
  timetable: Clock,
  calendar: CalendarDays,
  kanban: Kanban,
  notes: FileText,
  people: UsersRound,
  resources: Radio,
  links: LinkIcon,
  homepage: ExternalLink,
  course: BookOpen,
};
