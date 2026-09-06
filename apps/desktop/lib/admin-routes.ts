import type { AdminRoutes } from "@repo/admin/routes";
import { withQuery } from "@repo/admin/routes";

const ROOT = "/dashboard";

/**
 * Where this app mounts the shared admin features.
 *
 * This app is a static export, so a dynamic segment has no page to serve: every
 * record is addressed by query parameter against a real exported route. Each
 * base path here needs a matching directory under `app/dashboard` *and* an
 * entry in `KNOWN_ROUTES` (`context/user-context.tsx`) — an unregistered path
 * renders the not-found screen rather than the page.
 */
export const DESKTOP_ADMIN_ROUTES: AdminRoutes = {
  dashboardRoot: ROOT,
  settings: `${ROOT}/settings`,
  markets: `${ROOT}/markets`,
  portfolios: `${ROOT}/markets/portfolios`,

  courses: {
    root: `${ROOT}/courses`,
    new: `${ROOT}/courses/new`,
    detail: (courseId) => withQuery(`${ROOT}/courses`, { id: courseId }),
    edit: (courseId) => withQuery(`${ROOT}/courses/edit`, { id: courseId }),
    work: (courseId, workId) =>
      withQuery(`${ROOT}/courses/work`, { id: courseId, workId }),
    workNew: (courseId) => withQuery(`${ROOT}/courses/work`, { id: courseId }),
  },

  finance: {
    root: `${ROOT}/finance`,
    entry: (entryId) => withQuery(`${ROOT}/finance/entry`, { id: entryId }),
    entryNew: `${ROOT}/finance/entry`,
    rule: (ruleId) => withQuery(`${ROOT}/finance/rule`, { id: ruleId }),
    ruleNew: `${ROOT}/finance/rule`,
    accounts: `${ROOT}/finance/accounts`,
    account: (accountId) =>
      withQuery(`${ROOT}/finance/accounts`, { id: accountId }),
    budget: `${ROOT}/finance/budget`,
    envelope: (envelopeId) =>
      withQuery(`${ROOT}/finance/envelope`, { id: envelopeId }),
    envelopeNew: `${ROOT}/finance/envelope`,
    alerts: `${ROOT}/finance/alerts`,
    reviews: `${ROOT}/finance/reviews`,
  },

  blog: {
    root: `${ROOT}/blog`,
    new: `${ROOT}/blog/new`,
    edit: (id) => withQuery(`${ROOT}/blog/edit`, { id }),
  },

  projects: {
    root: `${ROOT}/projects`,
    new: `${ROOT}/projects/new`,
    edit: (id) => withQuery(`${ROOT}/projects/edit`, { id }),
  },

  timeline: {
    root: `${ROOT}/timeline`,
    new: `${ROOT}/timeline/new`,
    edit: (id) => withQuery(`${ROOT}/timeline/edit`, { id }),
  },

  contacts: {
    root: `${ROOT}/contacts`,
    detail: (ticketId) =>
      withQuery(`${ROOT}/contacts/detail`, { id: ticketId }),
  },

  papers: {
    root: `${ROOT}/papers`,
    read: (paperId) => withQuery(`${ROOT}/papers/read`, { id: paperId }),
  },

  agentMemory: {
    root: `${ROOT}/agent-memory`,
    detail: (memoryId) =>
      withQuery(`${ROOT}/agent-memory/detail`, { id: memoryId }),
  },

  market: {
    root: `${ROOT}/markets`,
    portfolios: `${ROOT}/markets/portfolios`,
    portfolio: (portfolioId) =>
      withQuery(`${ROOT}/markets/portfolios`, { portfolio: portfolioId }),
    ticker: (symbol) => withQuery(`${ROOT}/markets`, { ticker: symbol }),
  },
};
