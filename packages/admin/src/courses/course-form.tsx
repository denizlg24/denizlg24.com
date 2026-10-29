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
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { DatePicker } from "@repo/ui/date-picker";
import { DateTimePicker } from "@repo/ui/date-time-picker";
import { EmptyState } from "@repo/ui/empty-state";
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Spinner } from "@repo/ui/spinner";
import { Textarea } from "@repo/ui/textarea";
import { FilterTabs, SearchField } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  BookOpen,
  CalendarDays,
  Clock,
  ExternalLink,
  FileText,
  Kanban,
  Link as LinkIcon,
  Plus,
  Radio,
  UsersRound,
  X,
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

/** Local wall time, the shape DateTimePicker reads and `new Date()` parses back as local. */
function toDateTimeInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

function isCourseStatus(value: string): value is CourseStatus {
  return value === "active" || value === "archived";
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      className="shrink-0 text-muted-foreground hover:text-destructive"
      onClick={onClick}
    >
      <X />
    </Button>
  );
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="xs" onClick={onClick}>
      <Plus />
      Add
    </Button>
  );
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
    <Section
      title={
        <span className="flex items-center gap-1.5 [&_svg]:size-3.5">
          {icon}
          {label}
        </span>
      }
      count={`${selectedIds.length}/${options.length}`}
      className="min-w-0"
    >
      <SearchField value={query} onChange={setQuery} placeholder="Filter" />
      <div className="max-h-56 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">No matches</p>
        ) : (
          filtered.map((option) => (
            <label
              key={option._id}
              className="-mx-2 flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface/70"
            >
              <Checkbox
                checked={selectedIds.includes(option._id)}
                onCheckedChange={() =>
                  onChange(toggleId(selectedIds, option._id))
                }
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-accent-strong">
                  {option.title}
                </span>
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
    </Section>
  );
}

type FormTab = "profile" | "records" | "deadlines";

export function CourseForm({
  initialCourse,
  options,
  onSubmit,
  onCancel,
  isLoading,
  mode,
}: CourseFormProps) {
  const [values, setValues] = useState(() => formDefaults(initialCourse));
  const [tab, setTab] = useState<FormTab>("profile");

  const setField = <K extends keyof CourseFormValues>(
    field: K,
    value: CourseFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const updateAt = <
    K extends "links" | "customFields" | "triageContext" | "manualDeadlines",
  >(
    field: K,
    index: number,
    patch: Partial<CourseFormValues[K][number]>,
  ) => {
    setValues((current) => ({
      ...current,
      [field]: current[field].map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));
  };

  const removeAt = (
    field: "links" | "customFields" | "triageContext" | "manualDeadlines",
    index: number,
  ) => {
    setValues((current) => ({
      ...current,
      [field]: current[field].filter((_, i) => i !== index),
    }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!values.name.trim()) return;
    await onSubmit(normalizeSubmit(values));
  };

  const linkedCount =
    values.timetableEntryIds.length +
    values.calendarEventIds.length +
    values.kanbanBoardIds.length +
    values.noteIds.length +
    values.personIds.length +
    values.resourceIds.length;

  return (
    <form onSubmit={submit} className="flex flex-col gap-8">
      <FilterTabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "profile", label: "Profile" },
          { value: "records", label: "Records", count: linkedCount },
          {
            value: "deadlines",
            label: "Deadlines",
            count: values.manualDeadlines.length,
          },
        ]}
      />

      {tab === "profile" && (
        <>
          <FormGrid>
            <FormField
              label="Name"
              htmlFor="course-name"
              className="sm:col-span-2"
            >
              <Input
                id="course-name"
                value={values.name}
                onChange={(event) => setField("name", event.target.value)}
                required
                autoFocus={mode === "create"}
              />
            </FormField>
            <FormField label="Code" htmlFor="course-code">
              <Input
                id="course-code"
                value={values.code ?? ""}
                onChange={(event) => setField("code", event.target.value)}
                placeholder="CS 301"
              />
            </FormField>
            <FormField label="Semester" htmlFor="course-semester">
              <Input
                id="course-semester"
                value={values.semester ?? ""}
                onChange={(event) => setField("semester", event.target.value)}
                placeholder="Fall 2026"
              />
            </FormField>
            <FormField label="Instructor" htmlFor="course-instructor">
              <Input
                id="course-instructor"
                value={values.instructorName ?? ""}
                onChange={(event) =>
                  setField("instructorName", event.target.value)
                }
              />
            </FormField>
            <FormField label="Location" htmlFor="course-location">
              <Input
                id="course-location"
                value={values.location ?? ""}
                onChange={(event) => setField("location", event.target.value)}
              />
            </FormField>
            <FormField
              label="Homepage"
              htmlFor="course-homepage"
              className="sm:col-span-2"
            >
              <Input
                id="course-homepage"
                value={values.homepageUrl ?? ""}
                onChange={(event) =>
                  setField("homepageUrl", event.target.value)
                }
                placeholder="https://"
                type="url"
              />
            </FormField>
            <FormField label="Starts" htmlFor="course-start">
              <DatePicker
                id="course-start"
                value={values.startsOn || undefined}
                onValueChange={(next) => setField("startsOn", next ?? "")}
                clearable
              />
            </FormField>
            <FormField label="Ends" htmlFor="course-end">
              <DatePicker
                id="course-end"
                value={values.endsOn || undefined}
                onValueChange={(next) => setField("endsOn", next ?? "")}
                clearable
              />
            </FormField>
            <FormField label="Status" htmlFor="course-status">
              <Select
                value={values.status}
                onValueChange={(value) => {
                  if (isCourseStatus(value)) setField("status", value);
                }}
              >
                <SelectTrigger id="course-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Colour">
              <div className="flex h-8 flex-wrap items-center gap-2">
                {COURSE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    aria-pressed={values.color === color}
                    onClick={() => setField("color", color)}
                    className={cn(
                      "size-6 rounded-full border transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                      values.color === color
                        ? "border-accent-strong ring-2 ring-ring/30 ring-offset-1 ring-offset-background"
                        : "border-border",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </FormField>
            <FormField
              label="Description"
              htmlFor="course-description"
              className="sm:col-span-2"
            >
              <Textarea
                id="course-description"
                value={values.description ?? ""}
                onChange={(event) =>
                  setField("description", event.target.value)
                }
                rows={4}
              />
            </FormField>
          </FormGrid>

          <Section
            title="Links"
            count={values.links.length}
            actions={
              <AddButton
                onClick={() =>
                  setField("links", [
                    ...values.links,
                    { label: "", url: "", icon: "" },
                  ])
                }
              />
            }
          >
            {values.links.map((link, index) => (
              <div key={link._id ?? `new-${index}`} className="flex gap-2">
                <Input
                  value={link.label}
                  placeholder="Label"
                  aria-label="Link label"
                  className="flex-1"
                  onChange={(event) =>
                    updateAt("links", index, { label: event.target.value })
                  }
                />
                <Input
                  value={link.url}
                  placeholder="https://"
                  aria-label="Link URL"
                  className="flex-[2]"
                  onChange={(event) =>
                    updateAt("links", index, { url: event.target.value })
                  }
                />
                <RemoveButton
                  label="Remove link"
                  onClick={() => removeAt("links", index)}
                />
              </div>
            ))}
          </Section>

          <Section
            title="Custom fields"
            count={values.customFields.length}
            actions={
              <AddButton
                onClick={() =>
                  setField("customFields", [
                    ...values.customFields,
                    { label: "", value: "" },
                  ])
                }
              />
            }
          >
            {values.customFields.map((field, index) => (
              <div key={field._id ?? `new-${index}`} className="flex gap-2">
                <Input
                  value={field.label}
                  placeholder="Label"
                  aria-label="Field label"
                  className="flex-1"
                  onChange={(event) =>
                    updateAt("customFields", index, {
                      label: event.target.value,
                    })
                  }
                />
                <Input
                  value={field.value}
                  placeholder="Value"
                  aria-label="Field value"
                  className="flex-[2]"
                  onChange={(event) =>
                    updateAt("customFields", index, {
                      value: event.target.value,
                    })
                  }
                />
                <RemoveButton
                  label="Remove field"
                  onClick={() => removeAt("customFields", index)}
                />
              </div>
            ))}
          </Section>

          <Section
            title="Triage context"
            count={values.triageContext.length}
            actions={
              <AddButton
                onClick={() =>
                  setField("triageContext", [
                    ...values.triageContext,
                    { label: "", value: "", includeInTriage: false },
                  ])
                }
              />
            }
          >
            {values.triageContext.map((field, index) => (
              <div
                key={field._id ?? `new-${index}`}
                className="flex flex-wrap items-center gap-2 sm:flex-nowrap"
              >
                <Input
                  value={field.label}
                  placeholder="Label"
                  aria-label="Context label"
                  className="flex-1"
                  onChange={(event) =>
                    updateAt("triageContext", index, {
                      label: event.target.value,
                    })
                  }
                />
                <Input
                  value={field.value}
                  placeholder="Value"
                  aria-label="Context value"
                  className="flex-[2]"
                  onChange={(event) =>
                    updateAt("triageContext", index, {
                      value: event.target.value,
                    })
                  }
                />
                <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={field.includeInTriage}
                    onCheckedChange={(checked) =>
                      updateAt("triageContext", index, {
                        includeInTriage: checked === true,
                      })
                    }
                  />
                  Triage
                </label>
                <RemoveButton
                  label="Remove context"
                  onClick={() => removeAt("triageContext", index)}
                />
              </div>
            ))}
          </Section>
        </>
      )}

      {tab === "records" && (
        <div className="grid grid-cols-1 gap-x-8 gap-y-8 lg:grid-cols-2">
          <LinkedPicker
            label="Timetable"
            icon={<Clock />}
            options={options.timetableEntries}
            selectedIds={values.timetableEntryIds}
            onChange={(ids) => setField("timetableEntryIds", ids)}
          />
          <LinkedPicker
            label="Calendar"
            icon={<CalendarDays />}
            options={options.calendarEvents}
            selectedIds={values.calendarEventIds}
            onChange={(ids) => setField("calendarEventIds", ids)}
          />
          <LinkedPicker
            label="Kanban"
            icon={<Kanban />}
            options={options.kanbanBoards}
            selectedIds={values.kanbanBoardIds}
            onChange={(ids) => setField("kanbanBoardIds", ids)}
          />
          <LinkedPicker
            label="Notes"
            icon={<FileText />}
            options={options.notes}
            selectedIds={values.noteIds}
            onChange={(ids) => setField("noteIds", ids)}
          />
          <LinkedPicker
            label="People"
            icon={<UsersRound />}
            options={options.people}
            selectedIds={values.personIds}
            onChange={(ids) => setField("personIds", ids)}
          />
          <LinkedPicker
            label="Resources"
            icon={<Radio />}
            options={options.resources}
            selectedIds={values.resourceIds}
            onChange={(ids) => setField("resourceIds", ids)}
          />
        </div>
      )}

      {tab === "deadlines" && (
        <Section
          title="Manual deadlines"
          count={values.manualDeadlines.length}
          actions={
            <AddButton
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
            />
          }
        >
          {values.manualDeadlines.length === 0 ? (
            <EmptyState compact icon={<CalendarDays />} label="No deadlines" />
          ) : (
            <div className="flex flex-col divide-y divide-border/70">
              {values.manualDeadlines.map((deadline, index) => (
                <div
                  key={deadline._id ?? `new-${index}`}
                  className="flex flex-col gap-2 py-3 first:pt-0"
                >
                  <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                    <Input
                      value={deadline.title}
                      placeholder="Title"
                      aria-label="Deadline title"
                      className="min-w-48 flex-1"
                      onChange={(event) =>
                        updateAt("manualDeadlines", index, {
                          title: event.target.value,
                        })
                      }
                    />
                    <DateTimePicker
                      value={deadline.dueAt || undefined}
                      aria-label="Deadline due"
                      onValueChange={(next) =>
                        updateAt("manualDeadlines", index, {
                          dueAt: next ?? "",
                        })
                      }
                    />
                    <RemoveButton
                      label="Remove deadline"
                      onClick={() => removeAt("manualDeadlines", index)}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                    <Input
                      value={deadline.url ?? ""}
                      placeholder="URL"
                      aria-label="Deadline URL"
                      className="flex-1"
                      onChange={(event) =>
                        updateAt("manualDeadlines", index, {
                          url: event.target.value,
                        })
                      }
                    />
                    <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox
                        checked={deadline.completed}
                        onCheckedChange={(checked) =>
                          updateAt("manualDeadlines", index, {
                            completed: checked === true,
                          })
                        }
                      />
                      Done
                    </label>
                  </div>
                  <Textarea
                    className="min-h-14"
                    value={deadline.notes ?? ""}
                    placeholder="Notes"
                    aria-label="Deadline notes"
                    onChange={(event) =>
                      updateAt("manualDeadlines", index, {
                        notes: event.target.value,
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <div className="flex items-center justify-end gap-2 border-t pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={isLoading}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading || !values.name.trim()}>
          {isLoading && <Spinner className="size-3.5" />}
          {mode === "edit" ? "Save" : "Create"}
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
