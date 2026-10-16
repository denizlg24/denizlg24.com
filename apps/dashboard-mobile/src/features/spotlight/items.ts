import type { SpotlightItem } from "@modules/dashboard-native";
import type {
  IContact,
  ISemesterCourseStanding,
  NoteSummary,
} from "@repo/schemas";

function firstLine(text: string | undefined, limit = 120) {
  const line = text
    ?.split("\n")
    .find((row) => row.trim())
    ?.trim();
  if (!line) return undefined;
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}

/** Titles, one line and a link; never a note body or a message. */
export function noteItems(notes: NoteSummary[]): SpotlightItem[] {
  return notes.map((note) => ({
    id: `notes:${note._id}`,
    domain: "notes",
    title: note.title,
    description: note.url ?? firstLine(note.preview, 80),
    url: `dashboard://more/note/${note._id}`,
  }));
}

export function contactItems(contacts: IContact[]): SpotlightItem[] {
  return contacts
    .filter((contact) => contact.status !== "archived")
    .map((contact) => ({
      id: `contacts:${contact.ticketId}`,
      domain: "contacts",
      title: contact.name,
      description: contact.email,
      url: `dashboard://inbox/contact/${contact.ticketId}`,
    }));
}

export function courseItems(
  courses: ISemesterCourseStanding[],
): SpotlightItem[] {
  return courses.map((course) => ({
    id: `courses:${course.courseId}`,
    domain: "courses",
    title: course.code ? `${course.code} ${course.name}` : course.name,
    description: course.semester,
    url: `dashboard://calendar/course/${course.courseId}`,
  }));
}
