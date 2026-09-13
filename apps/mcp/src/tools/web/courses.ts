import type { McpServer } from "@modelcontextprotocol/server";
import {
  courseAssignmentFileSchema,
  courseAssignmentGradeSchema,
  courseAssignmentLinkSchema,
  courseAssignmentStatusSchema,
  courseAssignmentTypeSchema,
  courseCustomFieldSchema,
  courseDeadlineInputSchema,
  courseDeadlinePatchSchema,
  courseEmailRelinkSchema,
  courseLinkMutationSchema,
  courseLinkSchema,
  courseManualDeadlineSchema,
  courseStatusSchema,
  courseTriageContextSchema,
} from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p, partial } from "../define";

const id = z.string().min(1).describe("Course id");
const byId = z.object({ id });
const assignmentId = z.string().min(1).describe("Assignment id");
const deadlineId = z.string().min(1).describe("Manual deadline id");

// Sub-document ids are minted server-side, so the wire shape drops them.
const courseFields = {
  name: z.string().min(1),
  code: z.string().optional(),
  semester: z.string().optional(),
  description: z.string().optional(),
  homepageUrl: z.string().optional(),
  instructorName: z.string().optional(),
  location: z.string().optional(),
  color: z.string().optional(),
  status: courseStatusSchema.optional(),
  startsOn: z.string().optional().describe("ISO date"),
  endsOn: z.string().optional().describe("ISO date"),
  links: z.array(courseLinkSchema.omit({ _id: true })).optional(),
  customFields: z.array(courseCustomFieldSchema.omit({ _id: true })).optional(),
  triageContext: z
    .array(courseTriageContextSchema.omit({ _id: true }))
    .optional(),
  manualDeadlines: z
    .array(courseManualDeadlineSchema.omit({ _id: true }))
    .optional(),
  timetableEntryIds: z.array(z.string()).optional(),
  calendarEventIds: z.array(z.string()).optional(),
  kanbanBoardIds: z.array(z.string()).optional(),
  noteIds: z.array(z.string()).optional(),
  personIds: z.array(z.string()).optional(),
  resourceIds: z.array(z.string()).optional(),
};

const assignmentFields = {
  title: z.string().min(1),
  type: courseAssignmentTypeSchema.optional(),
  assessed: z.boolean().optional(),
  status: courseAssignmentStatusSchema.optional(),
  dueAt: z.string().optional().describe("ISO datetime"),
  submittedAt: z.string().optional().describe("ISO datetime"),
  notes: z.string().optional(),
  links: z.array(courseAssignmentLinkSchema.omit({ _id: true })).optional(),
  files: z.array(courseAssignmentFileSchema.omit({ _id: true })).optional(),
  grade: courseAssignmentGradeSchema.optional(),
  kanbanCardId: z.string().optional(),
};

export function registerWebCourses(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_courses",
    title: "Web: courses",
    description: "University courses and their linked data.",
    actions: {
      overview: action({
        description: "Semester overview",
        readOnly: true,
        run: () => api.web.get("/api/admin/courses/overview"),
      }),
      options: action({
        description: "Picker options (active courses and semesters)",
        readOnly: true,
        run: () => api.web.get("/api/admin/courses/options"),
      }),
      list: action({
        description: "Every course",
        readOnly: true,
        run: () => api.web.get("/api/admin/courses"),
      }),
      get: action({
        description: "Course detail with assignments and linked records",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/courses/${id}`),
      }),
      create: action({
        description: "Creates a course (name required)",
        input: z.object(courseFields),
        run: (body) => api.web.post("/api/admin/courses", body),
      }),
      update: action({
        description: "Changes any field",
        input: z.object({ id, ...partial(courseFields) }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/courses/${id}`, body),
      }),
      delete: action({
        description: "Deletes a course, its timetable entries and assignments",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/courses/${id}`),
      }),
      resolve: action({
        description: "Best matches for a partial name or code",
        input: z.object({ q: z.string().min(1) }),
        readOnly: true,
        run: ({ q }) => api.web.get("/api/admin/courses/resolve", { q }),
      }),
      grade_projection: action({
        description:
          "Weighted average, best/worst case and the average needed for targetAverage",
        input: z.object({
          id,
          targetAverage: z.number().min(0).max(100).optional(),
        }),
        readOnly: true,
        run: ({ id, targetAverage }) =>
          api.web.get(p`/api/admin/courses/${id}/grade-projection`, {
            targetAverage,
          }),
      }),
      link: action({
        description: "Attaches an existing record to one of the link fields",
        input: z.object({ id, ...courseLinkMutationSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/courses/${id}/links`, body),
      }),
      unlink: action({
        description: "Detaches a record from a link field",
        input: z.object({ id, ...courseLinkMutationSchema.shape }),
        idempotent: true,
        run: ({ id, field, entityId }) =>
          api.web.delete(p`/api/admin/courses/${id}/links`, {
            field,
            entityId,
          }),
      }),
      deadline_add: action({
        description: "Adds a manual deadline",
        input: z.object({ id, ...courseDeadlineInputSchema.shape }),
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/courses/${id}/deadlines`, body),
      }),
      deadline_update: action({
        description:
          "Changes title, dueAt, notes or completed of a manual deadline",
        input: z.object({ id, deadlineId, ...courseDeadlinePatchSchema.shape }),
        idempotent: true,
        run: ({ id, deadlineId, ...body }) =>
          api.web.patch(
            p`/api/admin/courses/${id}/deadlines/${deadlineId}`,
            body,
          ),
      }),
      deadline_delete: action({
        description: "Deletes a manual deadline",
        input: z.object({ id, deadlineId }),
        destructive: true,
        run: ({ id, deadlineId }) =>
          api.web.delete(p`/api/admin/courses/${id}/deadlines/${deadlineId}`),
      }),
    },
  });

  defineActions(server, {
    name: "web_course_assignments",
    title: "Web: course assignments",
    description: "Assignments, exams and other dated work per course.",
    actions: {
      list: action({
        description: "Assignments of a course",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/courses/${id}/assignments`),
      }),
      create: action({
        description: "Adds an assignment (title required)",
        input: z.object({ id, ...assignmentFields }),
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/courses/${id}/assignments`, body),
      }),
      update: action({
        description: "Changes any field",
        input: z.object({ id, assignmentId, ...partial(assignmentFields) }),
        idempotent: true,
        run: ({ id, assignmentId, ...body }) =>
          api.web.patch(
            p`/api/admin/courses/${id}/assignments/${assignmentId}`,
            body,
          ),
      }),
      delete: action({
        description: "Deletes an assignment",
        input: z.object({ id, assignmentId }),
        destructive: true,
        run: ({ id, assignmentId }) =>
          api.web.delete(
            p`/api/admin/courses/${id}/assignments/${assignmentId}`,
          ),
      }),
    },
  });

  defineActions(server, {
    name: "web_course_emails",
    title: "Web: course emails",
    description: "Triaged mail matched to a course.",
    actions: {
      list: action({
        description: "Paged mail for a course",
        input: z.object({
          id,
          page: z.number().int().min(1).optional(),
          pageSize: z.number().int().min(1).optional(),
          category: z.string().optional(),
          q: z.string().optional(),
        }),
        readOnly: true,
        run: ({ id, ...query }) =>
          api.web.get(p`/api/admin/courses/${id}/emails`, query),
      }),
      update: action({
        description:
          "Moves mail off this course: courseId null unlinks, an id relinks",
        input: z.object({ id, ...courseEmailRelinkSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/courses/${id}/emails`, body),
      }),
    },
  });
}
