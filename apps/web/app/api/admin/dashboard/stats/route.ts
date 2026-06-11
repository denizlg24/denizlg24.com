import { addDays, endOfDay, startOfDay } from "date-fns";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { Blog } from "@/models/Blog";
import { BlogComment } from "@/models/BlogComment";
import { CalendarEvent } from "@/models/CalendarEvent";
import { Contact } from "@/models/Contact";
import { EmailModel } from "@/models/Email";
import { EmailTriageModel } from "@/models/EmailTriage";
import { LlmUsage } from "@/models/LlmUsage";
import { Note } from "@/models/Note";
import { Project } from "@/models/Project";
import { Resource } from "@/models/Resource";
import { TimetableEntry } from "@/models/TimetableEntry";

type FacetCount = { n?: number }[];
const countOf = (arr: FacetCount | undefined): number => arr?.[0]?.n ?? 0;

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();

    const now = new Date();
    const todayDayOfWeek = (now.getDay() + 6) % 7;
    const startOfToday = startOfDay(now);
    const endOfToday = endOfDay(now);
    const startOfTomorrow = startOfDay(addDays(now, 1));
    const endOfWeek = endOfDay(addDays(now, 7));

    const calendarSuppressionMatch = {
      $or: [
        { "source.isSuppressed": { $ne: true } },
        { source: { $exists: false } },
      ],
    };

    const [
      contactFacet,
      projectFacet,
      blogFacet,
      calendarFacet,
      commentFacet,
      emailFacet,
      noteFacet,
      todayTimetable,
      resources,
      actionRequiredTriageCount,
      llmToday,
    ] = await Promise.all([
      Contact.aggregate<{
        total: FacetCount;
        unread: FacetCount;
        recent: {
          _id: unknown;
          name: string;
          email: string;
          createdAt: Date;
          status: string;
        }[];
      }>([
        {
          $facet: {
            total: [{ $count: "n" }],
            unread: [{ $match: { status: "new" } }, { $count: "n" }],
            recent: [
              { $sort: { createdAt: -1 } },
              { $limit: 5 },
              {
                $project: {
                  _id: 1,
                  name: 1,
                  email: 1,
                  createdAt: 1,
                  status: 1,
                },
              },
            ],
          },
        },
      ]),

      Project.aggregate<{ total: FacetCount; featured: FacetCount }>([
        {
          $facet: {
            total: [{ $count: "n" }],
            featured: [{ $match: { isFeatured: true } }, { $count: "n" }],
          },
        },
      ]),

      Blog.aggregate<{ total: FacetCount; published: FacetCount }>([
        {
          $facet: {
            total: [{ $count: "n" }],
            published: [{ $match: { isActive: true } }, { $count: "n" }],
          },
        },
      ]),

      CalendarEvent.aggregate<{
        todayEvents: FacetCount;
        upcomingEvents: FacetCount;
        events: {
          _id: unknown;
          title: string;
          date: Date;
          calendarDate: string;
          isAllDay?: boolean;
          kind?: string;
          status: string;
        }[];
      }>([
        { $match: calendarSuppressionMatch },
        {
          $facet: {
            todayEvents: [
              {
                $match: {
                  date: { $gte: startOfToday, $lte: endOfToday },
                  status: { $ne: "canceled" },
                },
              },
              { $count: "n" },
            ],
            upcomingEvents: [
              {
                $match: {
                  date: { $gte: startOfTomorrow, $lte: endOfWeek },
                  status: "scheduled",
                },
              },
              { $count: "n" },
            ],
            events: [
              {
                $match: {
                  date: { $gte: startOfToday },
                  status: { $ne: "canceled" },
                },
              },
              { $sort: { date: 1 } },
              { $limit: 5 },
              {
                $project: {
                  _id: 1,
                  title: 1,
                  date: 1,
                  calendarDate: 1,
                  isAllDay: 1,
                  kind: 1,
                  status: 1,
                },
              },
            ],
          },
        },
      ]),

      BlogComment.aggregate<{ total: FacetCount; pending: FacetCount }>([
        {
          $facet: {
            total: [{ $count: "n" }],
            pending: [
              { $match: { isApproved: false, isDeleted: { $ne: true } } },
              { $count: "n" },
            ],
          },
        },
      ]),

      EmailModel.aggregate<{ total: FacetCount; unread: FacetCount }>([
        {
          $facet: {
            total: [{ $count: "n" }],
            unread: [{ $match: { seen: false } }, { $count: "n" }],
          },
        },
      ]),

      Note.aggregate<{
        total: FacetCount;
        recent: { _id: unknown; title: string; updatedAt: Date }[];
      }>([
        {
          $facet: {
            total: [{ $count: "n" }],
            recent: [
              { $sort: { updatedAt: -1 } },
              { $limit: 3 },
              { $project: { _id: 1, title: 1, updatedAt: 1 } },
            ],
          },
        },
      ]),

      TimetableEntry.find({
        dayOfWeek: todayDayOfWeek,
        isActive: true,
      })
        .sort({ startTime: 1 })
        .select("title startTime endTime place color")
        .lean(),

      Resource.find({ isActive: true })
        .select("name type agentService.lastStatus agentService.lastCheckedAt")
        .lean(),

      EmailTriageModel.countDocuments({
        category: "action-needed",
        userStatus: "pending",
      }),

      LlmUsage.aggregate([
        { $match: { createdAt: { $gte: startOfToday } } },
        {
          $group: {
            _id: null,
            totalCost: { $sum: "$costUsd" },
            totalRequests: { $sum: 1 },
            totalInputTokens: { $sum: "$inputTokens" },
            totalOutputTokens: { $sum: "$outputTokens" },
          },
        },
      ]),
    ]);

    const c = contactFacet[0];
    const p = projectFacet[0];
    const b = blogFacet[0];
    const cal = calendarFacet[0];
    const cm = commentFacet[0];
    const em = emailFacet[0];
    const nt = noteFacet[0];

    return NextResponse.json({
      contacts: {
        total: countOf(c?.total),
        unread: countOf(c?.unread),
        recent: (c?.recent ?? []).map((contact) => ({
          _id: String(contact._id),
          name: contact.name,
          email: contact.email,
          createdAt: contact.createdAt,
          status: contact.status,
        })),
      },
      projects: {
        total: countOf(p?.total),
        featured: countOf(p?.featured),
      },
      blogs: {
        total: countOf(b?.total),
        published: countOf(b?.published),
      },
      calendar: {
        todayEvents: countOf(cal?.todayEvents),
        upcomingEvents: countOf(cal?.upcomingEvents),
        events: (cal?.events ?? []).map((event) => ({
          _id: String(event._id),
          title: event.title,
          date: event.date,
          calendarDate: event.calendarDate,
          isAllDay: event.isAllDay ?? false,
          kind: event.kind ?? "manual",
          status: event.status,
        })),
      },
      comments: {
        total: countOf(cm?.total),
        pending: countOf(cm?.pending),
      },
      timetable: todayTimetable.map((entry) => ({
        _id: String(entry._id),
        title: entry.title,
        startTime: entry.startTime,
        endTime: entry.endTime,
        place: entry.place,
        color: entry.color,
      })),
      resources: resources.map((r) => ({
        _id: String(r._id),
        name: r.name,
        type: r.type,
        status: r.agentService?.lastStatus ?? null,
        lastCheckedAt: r.agentService?.lastCheckedAt ?? null,
      })),
      emails: {
        total: countOf(em?.total),
        unread: countOf(em?.unread),
      },
      triage: {
        actionRequired: actionRequiredTriageCount,
      },
      notes: {
        total: countOf(nt?.total),
        recent: (nt?.recent ?? []).map((n) => ({
          _id: String(n._id),
          title: n.title,
          updatedAt: n.updatedAt,
        })),
      },
      llm: {
        todayCost: llmToday[0]?.totalCost ?? 0,
        todayRequests: llmToday[0]?.totalRequests ?? 0,
        todayInputTokens: llmToday[0]?.totalInputTokens ?? 0,
        todayOutputTokens: llmToday[0]?.totalOutputTokens ?? 0,
      },
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard stats" },
      { status: 500 },
    );
  }
}
