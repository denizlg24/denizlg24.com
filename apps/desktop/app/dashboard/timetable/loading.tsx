import { TimetableGrid } from "@repo/admin/timetable/timetable-grid";
import { Button } from "@repo/ui/button";
import { CalendarDays, Plus } from "lucide-react";

export default function Loading() {
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
      <TimetableGrid entries={[]} />
    </div>
  );
}
