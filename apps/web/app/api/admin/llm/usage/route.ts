import { startOfDay, subDays } from "date-fns";
import { Types } from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { getAppTimeZone, inTz } from "@/lib/timezone";
import { LlmUsage } from "@/models/LlmUsage";

type SumAgg = {
  _id: null;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
};

type GroupAgg = {
  _id: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
};

type RecentRow = {
  _id: unknown;
  llmModel: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  source: string;
  createdAt: Date;
};

type RecentCursor = {
  _id: Types.ObjectId;
  createdAt: Date;
};

type UsageFacet = {
  allTime: SumAgg[];
  last30d: SumAgg[];
  last7d: SumAgg[];
  last24h: SumAgg[];
  byModel: GroupAgg[];
  bySource: GroupAgg[];
  dailyBreakdown: GroupAgg[];
};

const DEFAULT_RECENT_LIMIT = 30;
const MAX_RECENT_LIMIT = 300;

class BadRequestError extends Error {}

const sumGroup = {
  $group: {
    _id: null,
    totalRequests: { $sum: 1 },
    totalInputTokens: { $sum: "$inputTokens" },
    totalOutputTokens: { $sum: "$outputTokens" },
    totalCost: { $sum: "$costUsd" },
  },
};

const groupBy = (field: string) => ({
  $group: {
    _id: field,
    requests: { $sum: 1 },
    inputTokens: { $sum: "$inputTokens" },
    outputTokens: { $sum: "$outputTokens" },
    cost: { $sum: "$costUsd" },
  },
});

function parseNonNegativeInteger(value: string | null, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.trunc(parsed));
}

function parseLimit(value: string | null) {
  const parsed = Number(value ?? DEFAULT_RECENT_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_RECENT_LIMIT;
  return Math.min(Math.max(1, Math.trunc(parsed)), MAX_RECENT_LIMIT);
}

function parseCursorId(value: string | null) {
  if (!value) return null;
  if (!Types.ObjectId.isValid(value)) {
    throw new BadRequestError("Invalid lastId cursor");
  }

  return new Types.ObjectId(value);
}

function serializeRecentRequests(rows: RecentRow[]) {
  return rows.map((r) => ({
    _id: String(r._id),
    llmModel: r.llmModel,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    costUsd: r.costUsd,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function getRecentRequestsPage(
  offset: number,
  limit: number,
  lastId: string | null,
) {
  const cursorId = parseCursorId(lastId);
  const cursor = cursorId
    ? await LlmUsage.findById(cursorId)
        .select("createdAt")
        .lean<RecentCursor | null>()
    : null;

  if (cursorId && !cursor) {
    throw new BadRequestError("Invalid lastId cursor");
  }

  const query = cursor
    ? {
        $or: [
          { createdAt: { $lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
        ],
      }
    : {};
  const effectiveOffset = cursor ? 0 : offset;
  const [rows, totalRows] = await Promise.all([
    LlmUsage.find(query)
      .select("llmModel inputTokens outputTokens costUsd source createdAt")
      .sort({ createdAt: -1, _id: -1 })
      .skip(effectiveOffset)
      .limit(limit)
      .lean<RecentRow[]>(),
    LlmUsage.countDocuments(),
  ]);
  const items = serializeRecentRequests(rows);

  return {
    items,
    totalRows,
    offset: effectiveOffset,
    limit,
    nextCursor: items.length === limit ? (items.at(-1)?._id ?? null) : null,
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();

    const { searchParams } = new URL(request.url);
    const offset = parseNonNegativeInteger(searchParams.get("offset"), 0);
    const limit = parseLimit(searchParams.get("limit"));
    const lastId = searchParams.get("lastId");
    const recentRequestsPromise = getRecentRequestsPage(offset, limit, lastId);

    if (searchParams.get("section") === "recent") {
      return NextResponse.json({
        recentRequests: await recentRequestsPromise,
      });
    }

    const timeZone = await getAppTimeZone();
    const now = inTz(new Date(), timeZone);
    const thirtyDaysAgo = startOfDay(subDays(now, 30));
    const sevenDaysAgo = startOfDay(subDays(now, 7));
    const oneDayAgo = startOfDay(subDays(now, 1));

    const [[facet], recentRequests] = await Promise.all([
      LlmUsage.aggregate<UsageFacet>([
        {
          $facet: {
            allTime: [sumGroup],
            last30d: [
              { $match: { createdAt: { $gte: thirtyDaysAgo } } },
              sumGroup,
            ],
            last7d: [
              { $match: { createdAt: { $gte: sevenDaysAgo } } },
              sumGroup,
            ],
            last24h: [{ $match: { createdAt: { $gte: oneDayAgo } } }, sumGroup],
            byModel: [groupBy("$llmModel"), { $sort: { cost: -1 } }],
            bySource: [groupBy("$source"), { $sort: { cost: -1 } }],
            dailyBreakdown: [
              { $match: { createdAt: { $gte: thirtyDaysAgo } } },
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$createdAt",
                      timezone: timeZone,
                    },
                  },
                  requests: { $sum: 1 },
                  inputTokens: { $sum: "$inputTokens" },
                  outputTokens: { $sum: "$outputTokens" },
                  cost: { $sum: "$costUsd" },
                },
              },
              { $sort: { _id: 1 } },
            ],
          },
        },
      ]),
      recentRequestsPromise,
    ]);

    const emptyAgg = {
      totalRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
    };

    return NextResponse.json({
      allTime: facet?.allTime[0] ?? emptyAgg,
      last30d: facet?.last30d[0] ?? emptyAgg,
      last7d: facet?.last7d[0] ?? emptyAgg,
      last24h: facet?.last24h[0] ?? emptyAgg,
      byModel: (facet?.byModel ?? []).map((m) => ({
        model: m._id,
        requests: m.requests,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cost: m.cost,
      })),
      bySource: (facet?.bySource ?? []).map((s) => ({
        source: s._id,
        requests: s.requests,
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        cost: s.cost,
      })),
      dailyBreakdown: (facet?.dailyBreakdown ?? []).map((d) => ({
        date: d._id,
        requests: d.requests,
        inputTokens: d.inputTokens,
        outputTokens: d.outputTokens,
        cost: d.cost,
      })),
      recentRequests,
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Error fetching LLM usage stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch LLM usage stats" },
      { status: 500 },
    );
  }
}
