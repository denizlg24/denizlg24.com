import {
  addCourseDeadline,
  addCourseLink,
  type CourseLinkField,
  completeCourseDeadline,
  createCourse,
  getCourseDetail,
  getCourseRelatedEmails,
  getCourses,
  removeCourseLink,
  updateCourse,
} from "@/lib/courses";
import type { ToolDefinition } from "./types";

const ENTITY_FIELD_MAP: Record<string, CourseLinkField> = {
  timetable: "timetableEntryIds",
  calendar: "calendarEventIds",
  board: "kanbanBoardIds",
  note: "noteIds",
  person: "personIds",
  resource: "resourceIds",
};

const ENTITY_TYPES = Object.keys(ENTITY_FIELD_MAP);

export const coursesTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_courses",
      description:
        "List courses (the per-class home for a semester). Returns each course's id, name, code, semester, status, linked-entity counts, and next upcoming deadline.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    isWrite: false,
    category: "courses",
    execute: async () => {
      const courses = await getCourses();
      return courses.map(({ course, stats, nextDeadline }) => ({
        _id: course._id,
        name: course.name,
        code: course.code,
        semester: course.semester,
        instructorName: course.instructorName,
        status: course.status,
        stats,
        nextDeadline: nextDeadline
          ? {
              title: nextDeadline.title,
              dueAt: nextDeadline.dueAt,
              source: nextDeadline.source,
              overdue: nextDeadline.overdue,
            }
          : null,
      }));
    },
  },
  {
    schema: {
      name: "get_course",
      description:
        "Get the full detail of one course: its metadata, merged deadlines (manual + kanban), timetable entries, calendar events, kanban boards, notes, people, resources, and related triaged emails.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
        },
        required: ["courseId"],
      },
    },
    isWrite: false,
    category: "courses",
    execute: async (input) => {
      const detail = await getCourseDetail(input.courseId as string);
      if (!detail) throw new Error("Course not found");
      return detail;
    },
  },
  {
    schema: {
      name: "find_course_emails",
      description:
        "List the triaged emails that have been matched to a course (e.g. messages from the instructor or about assignments). Returns subject, sender, date, category, and summary.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
        },
        required: ["courseId"],
      },
    },
    isWrite: false,
    category: "courses",
    execute: async (input) => {
      return await getCourseRelatedEmails(input.courseId as string);
    },
  },
  {
    schema: {
      name: "create_course",
      description:
        "Create a new course. Only name is required; provide code, semester, instructor, etc. when known.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Course name" },
          code: {
            type: "string",
            description: "Course code, e.g. CS101 (optional)",
          },
          semester: {
            type: "string",
            description: "Semester label, e.g. 'Fall 2026' (optional)",
          },
          instructorName: {
            type: "string",
            description: "Instructor name (optional)",
          },
          description: {
            type: "string",
            description: "Description (optional)",
          },
          homepageUrl: {
            type: "string",
            description: "Course homepage URL (optional)",
          },
          location: { type: "string", description: "Location (optional)" },
          color: {
            type: "string",
            description: "Color in hex (optional)",
          },
        },
        required: ["name"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const course = await createCourse({
        name: input.name as string,
        code: input.code as string | undefined,
        semester: input.semester as string | undefined,
        instructorName: input.instructorName as string | undefined,
        description: input.description as string | undefined,
        homepageUrl: input.homepageUrl as string | undefined,
        location: input.location as string | undefined,
        color: input.color as string | undefined,
      });
      if (!course) throw new Error("Failed to create course (name required)");
      return { _id: course._id, name: course.name, code: course.code };
    },
  },
  {
    schema: {
      name: "update_course",
      description:
        "Update a course's metadata. Only provided fields change. To link or unlink entities use link_to_course / unlink_from_course instead.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          name: { type: "string", description: "New name (optional)" },
          code: { type: "string", description: "New code (optional)" },
          semester: { type: "string", description: "New semester (optional)" },
          instructorName: {
            type: "string",
            description: "New instructor (optional)",
          },
          description: {
            type: "string",
            description: "New description (optional)",
          },
          homepageUrl: {
            type: "string",
            description: "New homepage URL (optional)",
          },
          location: { type: "string", description: "New location (optional)" },
          color: { type: "string", description: "New color (optional)" },
        },
        required: ["courseId"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const data: Record<string, unknown> = {};
      for (const key of [
        "name",
        "code",
        "semester",
        "instructorName",
        "description",
        "homepageUrl",
        "location",
        "color",
      ]) {
        if (input[key] !== undefined) data[key] = input[key];
      }
      const course = await updateCourse(input.courseId as string, data);
      if (!course) throw new Error("Course not found or invalid input");
      return { _id: course._id, name: course.name };
    },
  },
  {
    schema: {
      name: "archive_course",
      description:
        "Archive a course (status = archived) or restore it (archived = false). Archived courses drop out of the active course list.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          archived: {
            type: "boolean",
            description: "true to archive (default), false to restore",
          },
        },
        required: ["courseId"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const archived = input.archived !== false;
      const course = await updateCourse(input.courseId as string, {
        status: archived ? "archived" : "active",
      });
      if (!course) throw new Error("Course not found");
      return { _id: course._id, status: course.status };
    },
  },
  {
    schema: {
      name: "link_to_course",
      description:
        "Attach an existing entity to a course so it shows on the course home screen. The entity must already exist.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          entityType: {
            type: "string",
            enum: ENTITY_TYPES,
            description:
              "Kind of entity: timetable | calendar | board | note | person | resource.",
          },
          entityId: {
            type: "string",
            description: "ID of the entity to link",
          },
        },
        required: ["courseId", "entityType", "entityId"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const field = ENTITY_FIELD_MAP[input.entityType as string];
      if (!field) throw new Error("Unknown entityType");
      const course = await addCourseLink(
        input.courseId as string,
        field,
        input.entityId as string,
      );
      if (!course) throw new Error("Course or entity not found");
      return { _id: course._id, linked: true, field };
    },
  },
  {
    schema: {
      name: "unlink_from_course",
      description: "Detach a previously linked entity from a course.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          entityType: {
            type: "string",
            enum: ENTITY_TYPES,
            description:
              "Kind of entity: timetable | calendar | board | note | person | resource.",
          },
          entityId: {
            type: "string",
            description: "ID of the entity to unlink",
          },
        },
        required: ["courseId", "entityType", "entityId"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const field = ENTITY_FIELD_MAP[input.entityType as string];
      if (!field) throw new Error("Unknown entityType");
      const course = await removeCourseLink(
        input.courseId as string,
        field,
        input.entityId as string,
      );
      if (!course) throw new Error("Course not found");
      return { _id: course._id, unlinked: true, field };
    },
  },
  {
    schema: {
      name: "add_course_deadline",
      description:
        "Add a manual deadline to a course (assignment, exam, submission). Use ISO 8601 for dueAt.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          title: { type: "string", description: "Deadline title" },
          dueAt: {
            type: "string",
            description: "Due date/time, ISO 8601",
          },
          notes: { type: "string", description: "Notes (optional)" },
          url: { type: "string", description: "Related URL (optional)" },
        },
        required: ["courseId", "title", "dueAt"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const result = await addCourseDeadline(input.courseId as string, {
        title: input.title as string,
        dueAt: input.dueAt as string,
        notes: input.notes as string | undefined,
        url: input.url as string | undefined,
      });
      if (!result) throw new Error("Course not found or invalid deadline");
      return { courseId: result.course._id, deadlineId: result.deadlineId };
    },
  },
  {
    schema: {
      name: "complete_course_deadline",
      description:
        "Mark a course's manual deadline complete (or reopen it with completed = false).",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          deadlineId: {
            type: "string",
            description: "Manual deadline ID (from get_course deadlines)",
          },
          completed: {
            type: "boolean",
            description: "true to complete (default), false to reopen",
          },
        },
        required: ["courseId", "deadlineId"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const course = await completeCourseDeadline(
        input.courseId as string,
        input.deadlineId as string,
        input.completed !== false,
      );
      if (!course) throw new Error("Course or deadline not found");
      return { _id: course._id, updated: true };
    },
  },
];
