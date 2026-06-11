import { CalendarDays, Plus } from "lucide-react";
import { TimetableGrid } from "@/app/dashboard/timetable/_components/timetable-grid";
import { Button } from "@/components/ui/button";

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
