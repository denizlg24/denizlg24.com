"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIMETABLE_COLORS } from "@/lib/timetable-constants";

const COLOR_LABELS: Record<string, { label: string; hex: string }> = {
  background: { label: "Background", hex: "#f9f8f6" },
  surface: { label: "Surface", hex: "#f1f3e0" },
  muted: { label: "Muted", hex: "#d2dcb6" },
  accent: { label: "Accent", hex: "#a1bc98" },
  "accent-strong": { label: "Accent Strong", hex: "#303630" },
  foreground: { label: "Foreground", hex: "#778873" },
  destructive: { label: "Destructive", hex: "#c0352b" },
};

const DAYS = [
  { value: "0", label: "Monday" },
  { value: "1", label: "Tuesday" },
  { value: "2", label: "Wednesday" },
  { value: "3", label: "Thursday" },
  { value: "4", label: "Friday" },
  { value: "5", label: "Saturday" },
  { value: "6", label: "Sunday" },
];

const timetableSchema = z.object({
  title: z.string().min(1, "Title is required"),
  dayOfWeek: z.number().min(0).max(6),
  startTime: z.string().min(1, "Start time is required"),
  endTime: z.string().min(1, "End time is required"),
  place: z.string().optional(),
  links: z
    .array(
      z.object({
        label: z.string().min(1, "Label is required"),
        url: z.string().min(1, "URL is required"),
        icon: z.string().optional(),
      }),
    )
    .optional(),
  color: z.enum(TIMETABLE_COLORS),
  isActive: z.boolean(),
});

export type TimetableFormValues = z.infer<typeof timetableSchema>;

interface TimetableFormProps {
  initialData?: Partial<TimetableFormValues>;
  onSubmit: (values: TimetableFormValues) => Promise<void>;
  isLoading: boolean;
  mode: "create" | "edit";
}

export function TimetableForm({
  initialData,
  onSubmit,
  isLoading,
  mode,
}: TimetableFormProps) {
  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<TimetableFormValues>({
    resolver: zodResolver(timetableSchema),
    defaultValues: {
      title: initialData?.title || "",
      dayOfWeek: initialData?.dayOfWeek ?? 0,
      startTime: initialData?.startTime || "09:00",
      endTime: initialData?.endTime || "10:00",
      place: initialData?.place || "",
      links: initialData?.links || [],
      color: initialData?.color || "accent",
      isActive: initialData?.isActive ?? true,
    },
  });

  const links = watch("links") || [];

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Field data-invalid={!!errors.title}>
        <FieldLabel htmlFor="title">Title</FieldLabel>
        <Controller
          name="title"
          control={control}
          render={({ field }) => (
            <Input {...field} id="title" placeholder="e.g. Math Class" />
          )}
        />
        {errors.title && <FieldError>{errors.title.message}</FieldError>}
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field data-invalid={!!errors.dayOfWeek}>
          <FieldLabel htmlFor="dayOfWeek">Day</FieldLabel>
          <Controller
            name="dayOfWeek"
            control={control}
            render={({ field }) => (
              <Select
                value={String(field.value)}
                onValueChange={(v) => field.onChange(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select day" />
                </SelectTrigger>
                <SelectContent className="z-99">
                  {DAYS.map((day) => (
                    <SelectItem key={day.value} value={day.value}>
                      {day.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.dayOfWeek && (
            <FieldError>{errors.dayOfWeek.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={!!errors.color}>
          <FieldLabel htmlFor="color">Color</FieldLabel>
          <Controller
            name="color"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select color" />
                </SelectTrigger>
                <SelectContent className="z-99">
                  {TIMETABLE_COLORS.map((color) => (
                    <SelectItem key={color} value={color}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block w-3 h-3 rounded-full border border-black/10"
                          style={{
                            backgroundColor: COLOR_LABELS[color].hex,
                          }}
                        />
                        {COLOR_LABELS[color].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4 w-full">
        <Field data-invalid={!!errors.startTime} className="col-span-1 w-full">
          <FieldLabel htmlFor="startTime">Start Time</FieldLabel>
          <Controller
            name="startTime"
            control={control}
            render={({ field }) => (
              <Input {...field} id="startTime" type="time" />
            )}
          />
          {errors.startTime && (
            <FieldError>{errors.startTime.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={!!errors.endTime} className="col-span-1 w-full">
          <FieldLabel htmlFor="endTime">End Time</FieldLabel>
          <Controller
            name="endTime"
            control={control}
            render={({ field }) => (
              <Input {...field} id="endTime" type="time" />
            )}
          />
          {errors.endTime && <FieldError>{errors.endTime.message}</FieldError>}
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="place">Place</FieldLabel>
        <Controller
          name="place"
          control={control}
          render={({ field }) => (
            <Input
              {...field}
              id="place"
              placeholder="e.g. Room 101"
              value={field.value || ""}
            />
          )}
        />
      </Field>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <FieldLabel>Links</FieldLabel>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setValue("links", [...links, { label: "", url: "", icon: "" }])
            }
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Link
          </Button>
        </div>
        {links.map((_, index) => (
          <div key={index} className="flex gap-2 items-start">
            <div className="flex-1 grid grid-cols-2 gap-2">
              <Controller
                name={`links.${index}.label`}
                control={control}
                render={({ field }) => <Input {...field} placeholder="Label" />}
              />
              <Controller
                name={`links.${index}.url`}
                control={control}
                render={({ field }) => <Input {...field} placeholder="URL" />}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setValue(
                  "links",
                  links.filter((_, i) => i !== index),
                )
              }
            >
              <Trash2 className="w-4 h-4 text-destructive" />
            </Button>
          </div>
        ))}
      </div>

      <Field>
        <div className="flex items-center gap-2">
          <Controller
            name="isActive"
            control={control}
            render={({ field: { value, onChange, ...field } }) => (
              <Checkbox
                {...field}
                id="isActive"
                checked={value}
                onCheckedChange={onChange}
              />
            )}
          />
          <FieldLabel htmlFor="isActive" className="cursor-pointer">
            Active (visible on timetable)
          </FieldLabel>
        </div>
      </Field>

      <DialogFooter className="mt-2">
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isLoading}>
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={isLoading}>
          {isLoading
            ? `${mode === "edit" ? "Updating" : "Creating"}...`
            : mode === "edit"
              ? "Update"
              : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}
