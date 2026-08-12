import {
  type DeploymentStatus,
  type ForgeDeploymentQuery,
  forgeDeploymentQuerySchema,
} from "@repo/schemas/cloud";

/**
 * What the feed shows before anything is asked of it.
 *
 * The three it leaves out — `superseded`, `cancelled`, `interrupted` — are the
 * ones nothing is ever done about, and they are also the ones that accumulate:
 * every push supersedes the last preview, so the unfiltered feed is mostly
 * rows describing deployments that stopped mattering the moment they appeared.
 * The default is a starting view rather than a filter the owner set, so it does
 * not count towards `filtered` and `clear` returns to it.
 */
export const DEFAULT_STATUSES: DeploymentStatus[] = [
  "queued",
  "building",
  "deploying",
  "ready",
  "failed",
];

/**
 * A day string carries no time and the filter compares timestamps, so a bare
 * date has to be widened to the day it names — local midnight to local
 * midnight. Parsing it as UTC instead shifts the boundary by the offset and
 * drops the first or last few hours of the range.
 */
export function dayStart(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function dayEnd(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export interface ResolvedDeploymentQuery {
  query: ForgeDeploymentQuery;
  /** Whether a status filter from the URL is what the query is actually using. */
  statusFromUrl: boolean;
}

/**
 * The URL is the state. A filtered view stays linkable, survives a refresh and
 * comes back intact from a deployment's detail page.
 *
 * Parsed safely because the URL is typed by hand as often as it is navigated
 * to: `?size=`, a status the enum does not hold, or a stale link from before a
 * filter was renamed would otherwise throw inside render and blank the page.
 *
 * Absent, not empty. An empty `status` array means "every status" to the query
 * schema, so the default can only be applied where the URL says nothing about
 * status at all — and that same distinction is what keeps the default from
 * reading as a filter the owner applied.
 */
export function resolveDeploymentQuery(
  params: URLSearchParams,
): ResolvedDeploymentQuery {
  const statusInUrl = params.getAll("status");
  const parsed = forgeDeploymentQuerySchema.safeParse({
    limit: params.get("size") ?? undefined,
    sort: params.get("sort") ?? undefined,
    direction: params.get("direction") ?? undefined,
    status: statusInUrl.length > 0 ? statusInUrl : DEFAULT_STATUSES,
    project: params.get("project"),
    search: params.get("search"),
    kind: params.get("kind"),
    branch: params.get("branch"),
    repo: params.get("repo"),
    since: dayStart(params.get("since")),
    until: dayEnd(params.get("until")),
  });

  // The fallback is the default view, not the schema's own defaults. Empty
  // `status` means "every status" to the query, so parsing `{}` answers a
  // malformed `?size=` by filling the feed with the superseded rows the default
  // exists to hide — a worse view than the one that failed to parse.
  if (!parsed.success) {
    return {
      query: forgeDeploymentQuerySchema.parse({ status: DEFAULT_STATUSES }),
      // Nothing from the URL survived, so no filter was applied, whatever it
      // asked for. Reading the raw parameter here labels the default view
      // "matched" and offers a `clear` that changes nothing.
      statusFromUrl: false,
    };
  }
  return { query: parsed.data, statusFromUrl: statusInUrl.length > 0 };
}
