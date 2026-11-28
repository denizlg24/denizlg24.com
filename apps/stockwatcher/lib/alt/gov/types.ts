import { z } from "zod";

export const contractAction = z.object({
  awardId: z.string(),
  recipient: z.string(),
  ticker: z.string().nullable(),
  amount: z.number(),
  date: z.string(),
  agency: z.string().nullable(),
  subAgency: z.string().nullable(),
  description: z.string().nullable(),
  awardType: z.string().nullable(),
  url: z.string().nullable(),
});
export type ContractAction = z.infer<typeof contractAction>;

export const contractsTicker = z.object({
  ticker: z.string(),
  /** Names the award search was run for. */
  names: z.array(z.string()),
  /** Distinct recipient names on the returned actions that resolved to the ticker. */
  recipients: z.array(z.string()),
  windowDays: z.number(),
  fiscalYears: z.array(z.object({ year: z.number(), amount: z.number() })),
  actions: z.array(contractAction),
  /** Actions the search returned whose recipient did not resolve to this ticker. */
  dropped: z.number(),
});
export type ContractsTicker = z.infer<typeof contractsTicker>;

export const contractsRecent = z.object({
  days: z.number(),
  minAmount: z.number(),
  scanned: z.number(),
  actions: z.array(contractAction),
});
export type ContractsRecent = z.infer<typeof contractsRecent>;

export const lobbyingFiling = z.object({
  id: z.string(),
  client: z.string(),
  registrant: z.string(),
  ticker: z.string().nullable(),
  amount: z.number().nullable(),
  year: z.number(),
  period: z.string().nullable(),
  posted: z.string().nullable(),
  issues: z.array(
    z.object({
      code: z.string().nullable(),
      label: z.string().nullable(),
      description: z.string().nullable(),
    }),
  ),
  entities: z.array(z.string()),
  lobbyists: z.array(
    z.object({ name: z.string(), covered: z.string().nullable() }),
  ),
  url: z.string().nullable(),
});
export type LobbyingFiling = z.infer<typeof lobbyingFiling>;

export const revolvingLobbyist = z.object({
  name: z.string(),
  covered: z.string(),
  clients: z.array(
    z.object({ client: z.string(), ticker: z.string().nullable() }),
  ),
  registrants: z.array(z.string()),
  filings: z.number(),
  latest: z.string().nullable(),
});
export type RevolvingLobbyist = z.infer<typeof revolvingLobbyist>;

export const lobbyingTicker = z.object({
  ticker: z.string(),
  names: z.array(z.string()),
  /** Distinct client names on the returned filings that resolved to the ticker. */
  clients: z.array(z.string()),
  filings: z.array(lobbyingFiling),
  years: z.array(
    z.object({ year: z.number(), amount: z.number(), filings: z.number() }),
  ),
  /** False when more filings exist than were fetched, so year totals are lower bounds. */
  complete: z.boolean(),
  revolving: z.array(revolvingLobbyist),
});
export type LobbyingTicker = z.infer<typeof lobbyingTicker>;

export const lobbyingSpender = z.object({
  ticker: z.string(),
  name: z.string(),
  amount: z.number(),
  filings: z.number(),
});
export type LobbyingSpender = z.infer<typeof lobbyingSpender>;

export const lobbyingFeed = z.object({
  windowDays: z.number(),
  scanned: z.number(),
  filings: z.array(lobbyingFiling),
  top: z.array(lobbyingSpender),
  revolving: z.array(revolvingLobbyist),
});
export type LobbyingFeed = z.infer<typeof lobbyingFeed>;

export const pacCommittee = z.object({
  id: z.string(),
  name: z.string(),
  organization: z.string().nullable(),
  lastFiled: z.string().nullable(),
  cycles: z.array(
    z.object({
      cycle: z.number(),
      receipts: z.number(),
      disbursements: z.number(),
      contributions: z.number(),
      coverageEnd: z.string().nullable(),
    }),
  ),
});
export type PacCommittee = z.infer<typeof pacCommittee>;

export const pacContribution = z.object({
  committeeId: z.string(),
  recipient: z.string(),
  recipientId: z.string().nullable(),
  candidate: z.string().nullable(),
  office: z.string().nullable(),
  party: z.string().nullable(),
  kind: z.enum(["candidate", "committee"]),
  amount: z.number(),
  date: z.string().nullable(),
});
export type PacContribution = z.infer<typeof pacContribution>;

export const pacTicker = z.object({
  ticker: z.string(),
  names: z.array(z.string()),
  cycle: z.number(),
  committees: z.array(pacCommittee),
  contributions: z.array(pacContribution),
  /** Sum of the listed contributions by party code (DEM, REP, other). */
  parties: z.array(
    z.object({ party: z.string(), amount: z.number(), count: z.number() }),
  ),
  /** True when the contribution list is the latest page, not every disbursement of the cycle. */
  sampled: z.boolean(),
});
export type PacTicker = z.infer<typeof pacTicker>;

export const pacTopRow = z.object({
  committeeId: z.string(),
  committee: z.string(),
  ticker: z.string(),
  company: z.string(),
  receipts: z.number(),
  disbursements: z.number(),
  contributions: z.number(),
  coverageEnd: z.string().nullable(),
});
export type PacTopRow = z.infer<typeof pacTopRow>;

export const pacTop = z.object({
  cycle: z.number(),
  scanned: z.number(),
  rows: z.array(pacTopRow),
});
export type PacTop = z.infer<typeof pacTop>;
