"use client";

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
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  Archive,
  ArrowRight,
  Bookmark,
  Bug,
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Code2,
  Eye,
  Flag,
  Flame,
  Folder,
  Heart,
  Inbox,
  Layers,
  Lightbulb,
  ListTodo,
  Loader,
  MessageSquare,
  Milestone,
  Pencil,
  Play,
  Rocket,
  Search,
  Settings,
  Shield,
  Sparkles,
  Star,
  Target,
  TestTube,
  Truck,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { IKanbanColumn } from "@/lib/data-types";

export const COLUMN_ICON_MAP: Record<string, LucideIcon> = {
  circle: Circle,
  clock: Clock,
  inbox: Inbox,
  "list-todo": ListTodo,
  loader: Loader,
  play: Play,
  "arrow-right": ArrowRight,
  pencil: Pencil,
  code: Code2,
  eye: Eye,
  search: Search,
  "test-tube": TestTube,
  "check-circle": CheckCircle2,
  check: Check,
  rocket: Rocket,
  flag: Flag,
  milestone: Milestone,
  target: Target,
  star: Star,
  sparkles: Sparkles,
  zap: Zap,
  flame: Flame,
  lightbulb: Lightbulb,
  bug: Bug,
  shield: Shield,
  "alert-circle": AlertCircle,
  "x-circle": XCircle,
  heart: Heart,
  bookmark: Bookmark,
  "message-square": MessageSquare,
  calendar: Calendar,
  archive: Archive,
  folder: Folder,
  layers: Layers,
  settings: Settings,
  truck: Truck,
};

export const COLUMN_ICON_NAMES = Object.keys(COLUMN_ICON_MAP);

export const COLUMN_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#64748b",
];

export function resolveColumnIcon(iconName?: string): LucideIcon {
  if (iconName && iconName in COLUMN_ICON_MAP) {
    return COLUMN_ICON_MAP[iconName];
  }
  return Circle;
}

export function SwatchPicker({
  colors,
  value,
  onChange,
}: {
  colors: string[];
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          aria-pressed={value === color}
          onClick={() => onChange(color)}
          className={cn(
            "size-6 rounded-full ring-offset-2 ring-offset-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            value === color && "ring-2 ring-ring",
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

export function ColumnIconPicker({
  value,
  onChange,
  color,
}: {
  value: string;
  onChange: (icon: string) => void;
  color?: string;
}) {
  return (
    <div className="grid grid-cols-9 gap-1 sm:grid-cols-12">
      {COLUMN_ICON_NAMES.map((name) => {
        const Icon = COLUMN_ICON_MAP[name];
        const selected = value === name;
        return (
          <button
            key={name}
            type="button"
            aria-label={name}
            aria-pressed={selected}
            onClick={() => onChange(name)}
            className={cn(
              "flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              selected
                ? "bg-surface text-accent-strong ring-1 ring-ring/40 dark:bg-muted"
                : "text-muted-foreground hover:bg-surface/70 hover:text-accent-strong",
            )}
          >
            <Icon
              className="size-4"
              style={selected && color ? { color } : undefined}
            />
          </button>
        );
      })}
    </div>
  );
}

export type ColumnSortRule = NonNullable<IKanbanColumn["sortRule"]>;

export type ColumnFormValues = {
  title: string;
  description: string;
  color: string;
  icon: string;
  wipLimit: number | null;
  isDoneColumn: boolean;
  sortRule: ColumnSortRule;
};

const SORT_RULES: { value: ColumnSortRule; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "priority", label: "Priority" },
  { value: "dueDate", label: "Due date" },
];

function isSortRule(value: string): value is ColumnSortRule {
  return SORT_RULES.some((rule) => rule.value === value);
}

function valuesFrom(column?: IKanbanColumn): ColumnFormValues {
  return {
    title: column?.title ?? "",
    description: column?.description ?? "",
    color: column?.color ?? COLUMN_COLORS[0],
    icon: column?.icon ?? "circle",
    wipLimit: column?.wipLimit ?? null,
    isDoneColumn: column?.isDoneColumn ?? false,
    sortRule: column?.sortRule ?? "manual",
  };
}

/** Create (no `column`) or edit a column. */
export function ColumnDialog({
  open,
  onOpenChange,
  column,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  column?: IKanbanColumn;
  onSubmit: (values: ColumnFormValues) => void | Promise<void>;
}) {
  const [values, setValues] = useState<ColumnFormValues>(() =>
    valuesFrom(column),
  );
  const [wipInput, setWipInput] = useState("");
  const [pending, setPending] = useState(false);

  // Reset only when the dialog opens: the column object is replaced on every
  // board update, which would otherwise wipe the form mid-edit.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const next = valuesFrom(column);
      setValues(next);
      setWipInput(next.wipLimit ? String(next.wipLimit) : "");
    }
    wasOpen.current = open;
  }, [open, column]);

  const set = <K extends keyof ColumnFormValues>(
    key: K,
    value: ColumnFormValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }));

  const idPrefix = column?._id ?? "new";

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={column ? "Edit column" : "New column"}
      submitLabel={column ? "Save" : "Add"}
      submitDisabled={!values.title.trim()}
      pending={pending}
      onSubmit={async () => {
        const parsedWip = Number.parseInt(wipInput, 10);
        setPending(true);
        try {
          await onSubmit({
            ...values,
            title: values.title.trim(),
            description: values.description.trim(),
            wipLimit: parsedWip > 0 ? parsedWip : null,
          });
          onOpenChange(false);
        } finally {
          setPending(false);
        }
      }}
    >
      <FormGrid>
        <FormField label="Title" htmlFor={`${idPrefix}-title`}>
          <Input
            id={`${idPrefix}-title`}
            autoFocus
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </FormField>
        <FormField label="WIP limit" htmlFor={`${idPrefix}-wip`}>
          <Input
            id={`${idPrefix}-wip`}
            type="number"
            min={1}
            value={wipInput}
            onChange={(e) => setWipInput(e.target.value)}
            placeholder="None"
          />
        </FormField>
        <FormField label="Sort">
          <Select
            value={values.sortRule}
            onValueChange={(value) => {
              if (isSortRule(value)) set("sortRule", value);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_RULES.map((rule) => (
                <SelectItem key={rule.value} value={rule.value}>
                  {rule.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Done column" htmlFor={`${idPrefix}-done`}>
          <div className="flex h-8 items-center">
            <Switch
              id={`${idPrefix}-done`}
              checked={values.isDoneColumn}
              onCheckedChange={(checked) => set("isDoneColumn", checked)}
            />
          </div>
        </FormField>
        <FormField
          label="Description"
          htmlFor={`${idPrefix}-description`}
          className="sm:col-span-2"
        >
          <Textarea
            id={`${idPrefix}-description`}
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            rows={3}
          />
        </FormField>
        <FormField label="Color" className="sm:col-span-2">
          <SwatchPicker
            colors={COLUMN_COLORS}
            value={values.color}
            onChange={(color) => set("color", color)}
          />
        </FormField>
        <FormField label="Icon" className="sm:col-span-2">
          <ColumnIconPicker
            value={values.icon}
            onChange={(icon) => set("icon", icon)}
            color={values.color}
          />
        </FormField>
      </FormGrid>
    </FormDialog>
  );
}
