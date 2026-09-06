import type { AdminRoutes } from "@repo/admin/routes";
import { withQuery, withSegments } from "@repo/admin/routes";

const ROOT = "/admin/dashboard";

/**
 * Where this app mounts the shared admin features.
 *
 * Web can serve dynamic segments, so a record is addressed by path. Every entry
 * here has a matching directory under `app/admin/dashboard`; adding a route
 * means adding both.
 */
export const WEB_ADMIN_ROUTES: AdminRoutes = {
  dashboardRoot: ROOT,
  settings: `${ROOT}/settings`,
  markets: `${ROOT}/markets`,
  portfolios: `${ROOT}/markets/portfolios`,

  courses: {
    root: `${ROOT}/courses`,
    new: `${ROOT}/courses/new`,
    detail: (courseId) => withSegments(`${ROOT}/courses`, courseId),
    edit: (courseId) => `${withSegments(`${ROOT}/courses`, courseId)}/edit`,
    work: (courseId, workId) =>
      withSegments(`${ROOT}/courses`, courseId, "work", workId),
    workNew: (courseId) =>
      withSegments(`${ROOT}/courses`, courseId, "work", "new"),
  },

  finance: {
    root: `${ROOT}/finance`,
    entry: (entryId) => withSegments(`${ROOT}/finance/entries`, entryId),
    entryNew: `${ROOT}/finance/entries/new`,
    rule: (ruleId) => withSegments(`${ROOT}/finance/rules`, ruleId),
    ruleNew: `${ROOT}/finance/rules/new`,
    accounts: `${ROOT}/finance/accounts`,
    account: (accountId) => withSegments(`${ROOT}/finance/accounts`, accountId),
    budget: `${ROOT}/finance/budget`,
    envelope: (envelopeId) =>
      withSegments(`${ROOT}/finance/budget`, envelopeId),
    envelopeNew: `${ROOT}/finance/budget/new`,
    alerts: `${ROOT}/finance/alerts`,
    reviews: `${ROOT}/finance/reviews`,
  },

  blog: {
    root: `${ROOT}/blogs`,
    new: `${ROOT}/blogs/new`,
    edit: (id) => `${withSegments(`${ROOT}/blogs`, id)}/edit`,
  },

  projects: {
    root: `${ROOT}/projects`,
    new: `${ROOT}/projects/new`,
    edit: (id) => `${withSegments(`${ROOT}/projects`, id)}/edit`,
  },

  timeline: {
    root: `${ROOT}/timeline`,
    new: `${ROOT}/timeline/new`,
    edit: (id) => `${withSegments(`${ROOT}/timeline`, id)}/edit`,
  },

  contacts: {
    root: `${ROOT}/contacts`,
    detail: (ticketId) => withSegments(`${ROOT}/contacts`, ticketId),
  },

  papers: {
    root: `${ROOT}/papers`,
    read: (paperId) => `${withSegments(`${ROOT}/papers`, paperId)}/read`,
  },

  agentMemory: {
    root: `${ROOT}/agent-memory`,
    detail: (memoryId) => withSegments(`${ROOT}/agent-memory`, memoryId),
  },

  market: {
    root: `${ROOT}/markets`,
    portfolios: `${ROOT}/markets/portfolios`,
    portfolio: (portfolioId) =>
      withQuery(`${ROOT}/markets/portfolios`, { portfolio: portfolioId }),
    ticker: (symbol) => withQuery(`${ROOT}/markets`, { ticker: symbol }),
  },
};
