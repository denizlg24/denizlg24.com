import { TimetableGrid } from "@repo/admin/timetable/timetable-grid";
import { Button } from "@repo/ui/button";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { CalendarDays, Plus } from "lucide-react";

export default function Loading() {
  return (
    <Page>
      <PageHeader icon={<CalendarDays />} title="Timetable">
        <Button size="sm" disabled>
          <Plus />
          Add
        </Button>
      </PageHeader>
      <PageBody width="full">
        <TimetableGrid entries={[]} />
      </PageBody>
    </Page>
  );
}
