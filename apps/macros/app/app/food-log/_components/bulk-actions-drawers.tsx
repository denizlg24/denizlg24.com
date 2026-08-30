"use client";

import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@repo/ui/keyboard-sheet";
import { cn } from "@repo/ui/utils";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DrumColumn } from "@/app/app/add/_components/add-food-shared";
import { dateToIso, relativeDayLabel, shiftIso } from "../_lib/date-utils";

const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;

export type MealType = (typeof MEALS)[number];

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

const DAY_WINDOW = 14;

export function MoveEntriesDrawer({
  open,
  count,
  selectedDate,
  isSaving,
  onClose,
  onMove,
}: {
  open: boolean;
  count: number;
  selectedDate: string;
  isSaving: boolean;
  onClose: () => void;
  onMove: (mealType: MealType, logDate: string) => void;
}) {
  const [mealType, setMealType] = useState<MealType>("lunch");
  const [targetDate, setTargetDate] = useState(selectedDate);

  useEffect(() => {
    if (open) setTargetDate(selectedDate);
  }, [open, selectedDate]);

  // The window ends on whichever is later, so a day being viewed in the past
  // is always reachable from its own drum.
  const dates = useMemo(() => {
    const end =
      selectedDate > dateToIso(new Date())
        ? selectedDate
        : dateToIso(new Date());
    return Array.from({ length: DAY_WINDOW }, (_, index) =>
      shiftIso(end, -(DAY_WINDOW - 1 - index)),
    );
  }, [selectedDate]);

  const selectedIndex = Math.max(0, dates.indexOf(targetDate));

  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
      <DrawerContent className="pb-safe-end">
        <VisuallyHidden>
          <DrawerTitle>Move entries</DrawerTitle>
          <DrawerDescription>
            Choose a meal and date for the selected entries.
          </DrawerDescription>
        </VisuallyHidden>
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 pt-3 pb-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-6" />
          </Button>
          <p className="text-center text-base font-semibold">
            Move {count} {count === 1 ? "entry" : "entries"}
          </p>
          <span className="size-9" aria-hidden="true" />
        </div>

        <div className="grid grid-cols-4 gap-2 px-4 pb-3">
          {MEALS.map((meal) => (
            <button
              key={meal}
              type="button"
              onClick={() => setMealType(meal)}
              className={cn(
                "h-9 rounded-full text-xs font-medium transition-colors",
                meal === mealType
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {MEAL_LABELS[meal]}
            </button>
          ))}
        </div>

        <div className="px-4 pb-2">
          <DrumColumn
            count={dates.length}
            selectedIndex={selectedIndex}
            onSelect={(index) => setTargetDate(dates[index] ?? selectedDate)}
            getLabel={(index) => {
              const iso = dates[index];
              return iso ? relativeDayLabel(iso) : "";
            }}
          />
        </div>

        <div className="px-3 pt-1">
          <Button
            type="button"
            disabled={isSaving}
            onClick={() => onMove(mealType, targetDate)}
            className="h-11 w-full rounded-full"
          >
            {isSaving ? "Moving..." : "Move"}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function SaveTemplateDrawer({
  open,
  count,
  isSaving,
  onClose,
  onSave,
}: {
  open: boolean;
  count: number;
  isSaving: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  return (
    <Drawer open={open} onOpenChange={(next) => !next && onClose()}>
      <DrawerContent className="pb-safe-end">
        <VisuallyHidden>
          <DrawerTitle>Save meal template</DrawerTitle>
          <DrawerDescription>
            Name the template built from this day&apos;s entries.
          </DrawerDescription>
        </VisuallyHidden>
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-3 pt-3 pb-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-6" />
          </Button>
          <p className="text-center text-base font-semibold">
            Save {count} {count === 1 ? "entry" : "entries"}
          </p>
          <span className="size-9" aria-hidden="true" />
        </div>

        <div className="px-4 pb-4">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Template name"
            autoComplete="off"
            className="h-11 rounded-xl"
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim()) onSave(name.trim());
            }}
          />
        </div>

        <div className="px-3">
          <Button
            type="button"
            disabled={isSaving || !name.trim()}
            onClick={() => onSave(name.trim())}
            className="h-11 w-full rounded-full"
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
