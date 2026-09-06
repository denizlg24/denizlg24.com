/**
 * Every path a shared component navigates to.
 *
 * These live on the admin context rather than arriving as props because the
 * web/desktop difference is a property of the host, not of the component.
 * Desktop is a static export (`output: "export"` in its next config) and cannot
 * serve a dynamic segment, so it addresses a record with a query parameter
 * where web uses a path segment. A component that only asks for
 * `routes.finance.envelope(id)` never has to know which app it is running in,
 * and a host that forgets a route fails to typecheck instead of silently
 * rendering a dead link.
 */

/** A list surface with a create route and a per-record edit route. */
export interface EditableCollectionRoutes {
  root: string;
  new: string;
  edit: (id: string) => string;
}

export interface CourseRoutes extends EditableCollectionRoutes {
  /** One course's detail surface — the coursework board lives here. */
  detail: (courseId: string) => string;
  /** One coursework row, opened for edit. */
  work: (courseId: string, workId: string) => string;
  /** A new coursework row on a given course. */
  workNew: (courseId: string) => string;
}

export interface FinanceRoutes {
  root: string;
  /** Ledger entry detail, replacing `EntryDetailSheet`. */
  entry: (entryId: string) => string;
  entryNew: string;
  /** Recurring-rule editor, replacing `RuleSheet`. */
  rule: (ruleId: string) => string;
  ruleNew: string;
  /** Bank/CSV import and account management, replacing `AccountSheet`. */
  accounts: string;
  account: (accountId: string) => string;
  /** Budget overview. */
  budget: string;
  /** One envelope: its status, ledger rows, rollover walk-back and alerts. */
  envelope: (envelopeId: string) => string;
  envelopeNew: string;
  /** Budget alerts, with the open/acknowledged/resolved separation. */
  alerts: string;
  /** Projection-to-bank match review. */
  reviews: string;
}

export interface ContactRoutes {
  root: string;
  detail: (ticketId: string) => string;
}

export interface PaperRoutes {
  root: string;
  read: (paperId: string) => string;
}

export interface AgentMemoryRoutes {
  root: string;
  detail: (memoryId: string) => string;
}

export interface MarketRoutes {
  root: string;
  portfolios: string;
  /**
   * One portfolio's book.
   *
   * Both apps address this with `?portfolio=` rather than a segment — the
   * markets surface settled on query parameters before desktop's static export
   * forced the question, and the two are consistent because of it.
   */
  portfolio: (portfolioId: string) => string;
  /** One symbol on the markets dashboard. */
  ticker: (symbol: string) => string;
}

/** Where the host mounts shared multi-page features. */
export interface AdminRoutes {
  /** Root path accepted by agent navigation tools. */
  dashboardRoot: string;
  /** Base path of the global settings pages, without a trailing slash. */
  settings: string;
  /** Full path of the markets dashboard, which finance links across to. */
  markets: string;
  /** Full path of the virtual-portfolios surface, paired with markets. */
  portfolios: string;
  courses: CourseRoutes;
  finance: FinanceRoutes;
  blog: EditableCollectionRoutes;
  projects: EditableCollectionRoutes;
  timeline: EditableCollectionRoutes;
  contacts: ContactRoutes;
  papers: PaperRoutes;
  agentMemory: AgentMemoryRoutes;
  market: MarketRoutes;
}

/**
 * Appends a query string to a base path, dropping empty values.
 *
 * Desktop's route helpers are built on this: `/dashboard/finance/envelope?id=x`
 * is a real exported page in a way `/dashboard/finance/envelope/x` cannot be.
 */
export function withQuery(
  base: string,
  params: Record<string, string | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

/** Appends path segments, encoding each one. */
export function withSegments(base: string, ...segments: string[]): string {
  return [base, ...segments.map((s) => encodeURIComponent(s))].join("/");
}
