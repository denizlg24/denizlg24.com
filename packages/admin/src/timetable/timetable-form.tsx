"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { TIMETABLE_COLORS, type TimetableColor } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Switch } from "@repo/ui/switch";
import { cn } from "@repo/ui/utils";
import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import * as z from "zod";
import { TIMETABLE_COLOR_CLASSES } from "./timetable-grid";

const COLOR_LABELS: Record<TimetableColor, string> = {
  background: "Background",
  surface: "Surface",
  muted: "Muted",
  accent: "Accent",
  "accent-strong": "Accent strong",
  foreground: "Foreground",
  destructive: "Destructive",
};

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, i) =>
  String(i).padStart(2, "0"),
);

const timetableSchema = z
  .object({
    title: z.string().trim().min(1, "Required"),
    dayOfWeek: z.number().min(0).max(6),
    startTime: z.string().min(1, "Required"),
    endTime: z.string().min(1, "Required"),
    place: z.string().optional(),
    links: z
      .array(
        z.object({
          label: z.string().trim().min(1, "Label required"),
          url: z.string().trim().min(1, "URL required"),
          icon: z.string().optional(),
        }),
      )
      .optional(),
    color: z.enum(TIMETABLE_COLORS),
    isActive: z.boolean(),
  })
  .refine((values) => values.endTime > values.startTime, {
    path: ["endTime"],
    message: "Ends before it starts",
  });

export type TimetableFormValues = z.infer<typeof timetableSchema>;

function TimeSelect({
  value,
  fallback,
  onChange,
  id,
}: {
  value: string;
  fallback: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  const [fallbackHour = "00", fallbackMinute = "00"] = fallback.split(":");
  const [h = fallbackHour, m = fallbackMinute] = value ? value.split(":") : [];
  return (
    <div className="flex items-center gap-1">
      <Select value={h} onValueChange={(next) => onChange(`${next}:${m}`)}>
        <SelectTrigger id={id} className="flex-1 tabular-nums">
          <SelectValue placeholder="HH" />
        </SelectTrigger>
        <SelectContent className="max-h-48" position="popper">
          {HOURS.map((hour) => (
            <SelectItem key={hour} value={hour}>
              {hour}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-sm text-muted-foreground">:</span>
      <Select value={m} onValueChange={(next) => onChange(`${h}:${next}`)}>
        <SelectTrigger className="flex-1 tabular-nums">
          <SelectValue placeholder="MM" />
        </SelectTrigger>
        <SelectContent className="max-h-48" position="popper">
          {MINUTES.map((minute) => (
            <SelectItem key={minute} value={minute}>
              {minute}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

interface TimetableFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: Partial<TimetableFormValues>;
  onSubmit: (values: TimetableFormValues) => Promise<void>;
  isLoading: boolean;
  mode: "create" | "edit";
  footerStart?: ReactNode;
}

/** Mount with a `key` per record: defaults are read once. */
export function TimetableFormDialog({
  open,
  onOpenChange,
  initialData,
  onSubmit,
  isLoading,
  mode,
  footerStart,
}: TimetableFormDialogProps) {
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<TimetableFormValues>({
    resolver: zodResolver(timetableSchema),
    defaultValues: {
      title: initialData?.title ?? "",
      dayOfWeek: initialData?.dayOfWeek ?? 0,
      startTime: initialData?.startTime || "09:00",
      endTime: initialData?.endTime || "10:00",
      place: initialData?.place ?? "",
      links: initialData?.links ?? [],
      color: initialData?.color ?? "accent",
      isActive: initialData?.isActive ?? true,
    },
  });
  const links = useFieldArray({ control, name: "links" });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "edit" ? "Edit entry" : "New entry"}
      submitLabel={mode === "edit" ? "Save" : "Create"}
      pending={isLoading}
      onSubmit={() => handleSubmit(onSubmit)()}
      footerStart={footerStart}
    >
      <FormGrid>
        <FormField
          label="Title"
          htmlFor="timetable-title"
          error={errors.title?.message}
          className="sm:col-span-2"
        >
          <Controller
            name="title"
            control={control}
            render={({ field }) => (
              <Input {...field} id="timetable-title" autoFocus />
            )}
          />
        </FormField>

        <FormField label="Day" htmlFor="timetable-day">
          <Controller
            name="dayOfWeek"
            control={control}
            render={({ field }) => (
              <Select
                value={String(field.value)}
                onValueChange={(v) => field.onChange(Number(v))}
              >
                <SelectTrigger id="timetable-day" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {DAYS.map((day, index) => (
                    <SelectItem key={day} value={String(index)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>

        <FormField label="Place" htmlFor="timetable-place">
          <Controller
            name="place"
            control={control}
            render={({ field }) => (
              <Input
                {...field}
                id="timetable-place"
                value={field.value ?? ""}
              />
            )}
          />
        </FormField>

        <FormField
          label="Start"
          htmlFor="timetable-start"
          error={errors.startTime?.message}
        >
          <Controller
            name="startTime"
            control={control}
            render={({ field }) => (
              <TimeSelect
                id="timetable-start"
                value={field.value}
                fallback="09:00"
                onChange={field.onChange}
              />
            )}
          />
        </FormField>

        <FormField
          label="End"
          htmlFor="timetable-end"
          error={errors.endTime?.message}
        >
          <Controller
            name="endTime"
            control={control}
            render={({ field }) => (
              <TimeSelect
                id="timetable-end"
                value={field.value}
                fallback="10:00"
                onChange={field.onChange}
              />
            )}
          />
        </FormField>

        <FormField label="Colour" htmlFor="timetable-color">
          <Controller
            name="color"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="timetable-color" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  {TIMETABLE_COLORS.map((color) => (
                    <SelectItem key={color} value={color}>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-block size-3 rounded-full border border-border",
                            TIMETABLE_COLOR_CLASSES[color].bg,
                          )}
                        />
                        {COLOR_LABELS[color]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </FormField>

        <FormField label="Active" htmlFor="timetable-active">
          <Controller
            name="isActive"
            control={control}
            render={({ field }) => (
              <div className="flex h-8 items-center">
                <Switch
                  id="timetable-active"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </div>
            )}
          />
        </FormField>
      </FormGrid>

      <FormField label="Links">
        <div className="flex flex-col gap-2">
          {links.fields.map((link, index) => {
            const linkErrors = errors.links?.[index];
            return (
              <div key={link.id} className="flex items-start gap-2">
                <div className="grid flex-1 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2">
                  <Controller
                    name={`links.${index}.label`}
                    control={control}
                    render={({ field }) => (
                      <Input
                        {...field}
                        placeholder="Label"
                        aria-label="Link label"
                        aria-invalid={Boolean(linkErrors?.label)}
                      />
                    )}
                  />
                  <Controller
                    name={`links.${index}.url`}
                    control={control}
                    render={({ field }) => (
                      <Input
                        {...field}
                        type="url"
                        placeholder="https://"
                        aria-label="Link URL"
                        aria-invalid={Boolean(linkErrors?.url)}
                      />
                    )}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove link"
                  onClick={() => links.remove(index)}
                >
                  <X />
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => links.append({ label: "", url: "", icon: "" })}
          >
            <Plus />
            Add link
          </Button>
        </div>
      </FormField>
    </FormDialog>
  );
}
