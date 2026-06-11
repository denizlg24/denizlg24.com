import { forbidden } from "next/navigation";
import { getAdminSession } from "@/lib/require-admin";
import { getAllTimetableEntries } from "@/lib/timetable";
import { TimetableManager } from "./_components/timetable-manager";

export default async function TimetablePage() {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
  }

  const entries = await getAllTimetableEntries();

  return (
    <div className="mx-auto space-y-6">
      <TimetableManager initialEntries={entries} />
    </div>
  );
}
