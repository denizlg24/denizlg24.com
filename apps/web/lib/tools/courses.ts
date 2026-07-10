import type {
  CourseAssignmentStatus,
  CourseAssignmentType,
} from "@repo/schemas";
import {
  addCourseDeadline,
  addCourseLink,
  type CourseLinkField,
  completeCourseDeadline,
  createCourse,
  createCourseAssignment,
  deleteCourse,
  deleteCourseAssignment,
  deleteCourseDeadline,
  getCourseDetail,
  getCourseGradeProjection,
  getCourseRelatedEmails,
  getCourses,
  getSemesterOverview,
  removeCourseLink,
  requiredAverageForTarget,
  updateCourse,
  updateCourseAssignment,
  updateCourseDeadline,
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

const ASSIGNMENT_TYPES = [
  "assignment",
  "exam",
  "quiz",
  "project",
  "lab",
  "reading",
  "other",
];

const ASSIGNMENT_STATUSES = [
  "planned",
  "in-progress",
  "submitted",
  "graded",
  "archived",
];

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
      name: "set_course_triage_context",
      description:
        "Replace a course's private triage context entries. Only entries with includeInTriage=true are shown to email triage LLM prompts.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          entries: {
            type: "array",
            description:
              "Course-specific identifiers or routing hints, e.g. student number, lab group, tutorial section.",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "string" },
                includeInTriage: {
                  type: "boolean",
                  description: "true to include this value in triage prompts",
                },
              },
              required: ["label", "value", "includeInTriage"],
              additionalProperties: false,
            },
          },
        },
        required: ["courseId", "entries"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const course = await updateCourse(input.courseId as string, {
        triageContext: Array.isArray(input.entries)
          ? (input.entries as never)
          : [],
      });
      if (!course) throw new Error("Course not found or invalid context");
      return {
        _id: course._id,
        triageContext: course.triageContext.map(
          ({ label, includeInTriage }) => ({ label, includeInTriage }),
        ),
      };
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
      name: "add_course_assignment",
      description:
        "Add an assignment, exam, quiz, project, lab, or reading to a course. Can include notes, URLs, uploaded file metadata, and an optional grade.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          title: { type: "string", description: "Assignment title" },
          type: {
            type: "string",
            enum: ASSIGNMENT_TYPES,
            description: "Assignment type",
          },
          status: {
            type: "string",
            enum: ASSIGNMENT_STATUSES,
            description: "Workflow status",
          },
          dueAt: {
            type: "string",
            description: "Due date/time, ISO 8601 (optional)",
          },
          submittedAt: {
            type: "string",
            description: "Submission date/time, ISO 8601 (optional)",
          },
          notes: { type: "string", description: "Notes (optional)" },
          links: {
            type: "array",
            description: "Related URLs",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                url: { type: "string" },
              },
              required: ["label", "url"],
              additionalProperties: false,
            },
          },
          files: {
            type: "array",
            description:
              "Already-uploaded file metadata. Use upload APIs before passing files here.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                url: { type: "string" },
                mimeType: { type: "string" },
                size: { type: "number" },
              },
              required: ["name", "url"],
              additionalProperties: false,
            },
          },
          score: { type: "number", description: "Grade score (optional)" },
          maxScore: {
            type: "number",
            description: "Maximum possible score (optional)",
          },
          letter: {
            type: "string",
            description: "Letter/label grade (optional)",
          },
          weight: {
            type: "number",
            description: "Grade weight, e.g. 20 for 20% (optional)",
          },
          gradeNotes: { type: "string", description: "Grade notes" },
          gradedAt: {
            type: "string",
            description: "Grade date/time, ISO 8601 (optional)",
          },
        },
        required: ["courseId", "title"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const hasGrade =
        input.score !== undefined ||
        input.maxScore !== undefined ||
        input.letter !== undefined ||
        input.weight !== undefined ||
        input.gradeNotes !== undefined ||
        input.gradedAt !== undefined;
      const assignment = await createCourseAssignment(
        input.courseId as string,
        {
          title: input.title as string,
          type: input.type as CourseAssignmentType | undefined,
          status:
            (input.status as CourseAssignmentStatus | undefined) ??
            (hasGrade ? "graded" : undefined),
          dueAt: input.dueAt as string | undefined,
          submittedAt: input.submittedAt as string | undefined,
          notes: input.notes as string | undefined,
          links: input.links as never,
          files: input.files as never,
          ...(hasGrade
            ? {
                grade: {
                  score: input.score as number | undefined,
                  maxScore: input.maxScore as number | undefined,
                  letter: input.letter as string | undefined,
                  weight: input.weight as number | undefined,
                  notes: input.gradeNotes as string | undefined,
                  gradedAt: input.gradedAt as string | undefined,
                },
              }
            : {}),
        },
      );
      if (!assignment)
        throw new Error("Course not found or invalid assignment");
      return {
        _id: assignment._id,
        courseId: assignment.courseId,
        title: assignment.title,
        status: assignment.status,
      };
    },
  },
  {
    schema: {
      name: "update_course_assignment",
      description:
        "Update an existing course assignment/exam, including status, dates, notes, links, files, or grade fields.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          assignmentId: { type: "string", description: "Assignment ID" },
          title: { type: "string", description: "New title (optional)" },
          type: {
            type: "string",
            enum: ASSIGNMENT_TYPES,
            description: "New type (optional)",
          },
          status: {
            type: "string",
            enum: ASSIGNMENT_STATUSES,
            description: "New status (optional)",
          },
          dueAt: { type: "string", description: "New due date (optional)" },
          submittedAt: {
            type: "string",
            description: "New submission date (optional)",
          },
          notes: { type: "string", description: "New notes (optional)" },
          links: {
            type: "array",
            description:
              "Related URLs. Replaces the full list when provided (optional)",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                url: { type: "string" },
              },
              required: ["label", "url"],
              additionalProperties: false,
            },
          },
          files: {
            type: "array",
            description:
              "Already-uploaded file metadata. Replaces the full list when provided (optional)",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                url: { type: "string" },
                mimeType: { type: "string" },
                size: { type: "number" },
              },
              required: ["name", "url"],
              additionalProperties: false,
            },
          },
          score: { type: "number", description: "Grade score (optional)" },
          maxScore: {
            type: "number",
            description: "Maximum possible score (optional)",
          },
          letter: { type: "string", description: "Letter grade (optional)" },
          weight: {
            type: "number",
            description: "Grade weight, e.g. 20 for 20% (optional)",
          },
          gradeNotes: { type: "string", description: "Grade notes" },
          gradedAt: {
            type: "string",
            description: "Grade date/time, ISO 8601 (optional)",
          },
        },
        required: ["courseId", "assignmentId"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const data: Record<string, unknown> = {};
      for (const key of [
        "title",
        "type",
        "status",
        "dueAt",
        "submittedAt",
        "notes",
        "links",
        "files",
      ]) {
        if (input[key] !== undefined) data[key] = input[key];
      }
      if (
        input.score !== undefined ||
        input.maxScore !== undefined ||
        input.letter !== undefined ||
        input.weight !== undefined ||
        input.gradeNotes !== undefined ||
        input.gradedAt !== undefined
      ) {
        data.grade = {
          score: input.score,
          maxScore: input.maxScore,
          letter: input.letter,
          weight: input.weight,
          notes: input.gradeNotes,
          gradedAt: input.gradedAt,
        };
      }
      const assignment = await updateCourseAssignment(
        input.courseId as string,
        input.assignmentId as string,
        data,
      );
      if (!assignment) throw new Error("Assignment not found or invalid input");
      return { _id: assignment._id, status: assignment.status };
    },
  },
  {
    schema: {
      name: "delete_course_assignment",
      description: "Delete a course assignment/exam record.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          assignmentId: { type: "string", description: "Assignment ID" },
        },
        required: ["courseId", "assignmentId"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const deleted = await deleteCourseAssignment(
        input.courseId as string,
        input.assignmentId as string,
      );
      if (!deleted) throw new Error("Assignment not found");
      return { deleted: true };
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
  {
    schema: {
      name: "update_course_deadline",
      description:
        "Update a course's manual deadline: title, due date, notes, or completion. Only provided fields change.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          deadlineId: {
            type: "string",
            description: "Manual deadline ID (from get_course deadlines)",
          },
          title: { type: "string", description: "New title (optional)" },
          dueAt: {
            type: "string",
            description: "New due date/time, ISO 8601 (optional)",
          },
          notes: { type: "string", description: "New notes (optional)" },
          completed: {
            type: "boolean",
            description: "New completion state (optional)",
          },
        },
        required: ["courseId", "deadlineId"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const course = await updateCourseDeadline(
        input.courseId as string,
        input.deadlineId as string,
        {
          title: input.title as string | undefined,
          dueAt: input.dueAt as string | undefined,
          notes: input.notes as string | undefined,
          completed: input.completed as boolean | undefined,
        },
      );
      if (!course) throw new Error("Course or deadline not found");
      return { _id: course._id, updated: true };
    },
  },
  {
    schema: {
      name: "delete_course_deadline",
      description:
        "Delete a course's manual deadline permanently. To keep it but mark it done, use complete_course_deadline instead.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          deadlineId: {
            type: "string",
            description: "Manual deadline ID (from get_course deadlines)",
          },
        },
        required: ["courseId", "deadlineId"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const course = await deleteCourseDeadline(
        input.courseId as string,
        input.deadlineId as string,
      );
      if (!course) throw new Error("Course or deadline not found");
      return { _id: course._id, deleted: true };
    },
  },
  {
    schema: {
      name: "delete_course",
      description:
        "Permanently delete a course and its assignments. Cannot be undone — prefer archive_course unless the user explicitly asks for deletion.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
        },
        required: ["courseId"],
      },
    },
    isWrite: true,
    category: "courses",
    execute: async (input) => {
      const deleted = await deleteCourse(input.courseId as string);
      if (!deleted) throw new Error("Course not found");
      return { deleted: true };
    },
  },
  {
    schema: {
      name: "resolve_course",
      description:
        "Find a course by (partial) name or code, e.g. 'CS101' or 'algorithms'. Returns the best matches with ids so you can skip list_courses when the user names a specific class.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Course name or code to look up",
          },
        },
        required: ["query"],
      },
    },
    isWrite: false,
    category: "courses",
    execute: async (input) => {
      const query = (input.query as string).trim().toLowerCase();
      if (!query) throw new Error("query required");

      const courses = await getCourses();
      const scored = courses
        .map(({ course }) => {
          const name = course.name.toLowerCase();
          const code = (course.code ?? "").toLowerCase();
          let score = 0;
          if (code && code === query) score = 100;
          else if (name === query) score = 90;
          else if (code && (code.includes(query) || query.includes(code)))
            score = 70;
          else if (name.includes(query)) score = 60;
          else {
            const tokens = query.split(/\s+/).filter(Boolean);
            const hits = tokens.filter(
              (token) => name.includes(token) || code.includes(token),
            ).length;
            if (tokens.length > 0 && hits > 0)
              score = Math.round((hits / tokens.length) * 50);
          }
          return { course, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

      return {
        matches: scored.slice(0, 5).map(({ course, score }) => ({
          _id: course._id,
          name: course.name,
          code: course.code,
          semester: course.semester,
          status: course.status,
          confidence: score,
        })),
      };
    },
  },
  {
    schema: {
      name: "get_semester_overview",
      description:
        "The semester cockpit in one call: per-course grade standings with projections (current weighted average, graded vs remaining weight, best/worst case final grade), every open deadline that is overdue or due within 14 days across all courses, the next 7 days of classes from the timetable, and aggregate stats. Call this first for any semester-wide question (how is the semester going, what's due this week, what does my week look like).",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    isWrite: false,
    category: "courses",
    execute: async () => {
      return await getSemesterOverview();
    },
  },
  {
    schema: {
      name: "project_course_grade",
      description:
        "Grade projection for one course: current weighted average, graded vs remaining weight, best/worst case final grade, and — when targetAverage is given — the average needed on the remaining weight to reach that target. Use for questions like 'what do I need on the final to get 85%?'. Requires grade weights on graded assignments.",
      input_schema: {
        type: "object",
        properties: {
          courseId: { type: "string", description: "Course ID" },
          targetAverage: {
            type: "number",
            description:
              "Target final grade as a percentage 0-100 (optional). E.g. 85 to ask what is needed on remaining work to finish at 85%.",
          },
        },
        required: ["courseId"],
      },
    },
    isWrite: false,
    category: "courses",
    execute: async (input) => {
      const result = await getCourseGradeProjection(input.courseId as string);
      if (!result) throw new Error("Course not found");

      const target =
        typeof input.targetAverage === "number"
          ? input.targetAverage
          : undefined;
      if (target === undefined) return result;

      const requiredAverage = requiredAverageForTarget(
        result.projection,
        target,
      );
      let note: string | undefined;
      if (requiredAverage === null) {
        note =
          result.projection.remainingWeight === 0
            ? "All grade weight is already graded — the final grade is settled."
            : "No weighted grades recorded yet; add grade weights to assignments to enable target projections.";
      }
      return {
        ...result,
        target,
        requiredAverage,
        alreadySecured: requiredAverage !== null && requiredAverage <= 0,
        achievable: requiredAverage !== null && requiredAverage <= 100,
        note,
      };
    },
  },
];
