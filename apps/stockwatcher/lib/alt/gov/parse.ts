import { z } from "zod";
import type {
  ContractAction,
  LobbyingFiling,
  PacCommittee,
  PacContribution,
  RevolvingLobbyist,
} from "./types";

const text = z.string().nullish();
const money = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });

const clean = (value: string | null | undefined) => {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed ? trimmed : null;
};

const transactions = z.object({
  results: z.array(z.record(z.string(), z.unknown())),
});

export function usaTransactions(json: unknown): ContractAction[] {
  const parsed = transactions.safeParse(json);
  if (!parsed.success) return [];
  const rows: ContractAction[] = [];
  for (const row of parsed.data.results) {
    const item = z
      .object({
        "Award ID": text,
        "Recipient Name": text,
        "Transaction Amount": money,
        "Action Date": text,
        "Awarding Agency": text,
        "Awarding Sub Agency": text,
        "Transaction Description": text,
        "Award Type": text,
        generated_internal_id: text,
      })
      .safeParse(row);
    if (!item.success) continue;
    const value = item.data;
    const recipient = clean(value["Recipient Name"]);
    const date = value["Action Date"]?.slice(0, 10);
    const amount = value["Transaction Amount"];
    if (!recipient || !date || amount == null) continue;
    const id = value.generated_internal_id;
    rows.push({
      awardId: clean(value["Award ID"]) ?? "—",
      recipient,
      ticker: null,
      amount,
      date,
      agency: clean(value["Awarding Agency"]),
      subAgency: clean(value["Awarding Sub Agency"]),
      description: clean(value["Transaction Description"]),
      awardType: clean(value["Award Type"]),
      url: id
        ? `https://www.usaspending.gov/award/${encodeURIComponent(id)}`
        : null,
    });
  }
  return rows;
}

export function usaFiscalYears(
  json: unknown,
): { year: number; amount: number }[] {
  const parsed = z
    .object({
      results: z.array(
        z.object({
          aggregated_amount: z.number(),
          time_period: z.object({
            fiscal_year: z.union([z.string(), z.number()]),
          }),
        }),
      ),
    })
    .safeParse(json);
  if (!parsed.success) return [];
  return parsed.data.results
    .map((row) => ({
      year: Number(row.time_period.fiscal_year),
      amount: row.aggregated_amount,
    }))
    .filter((row) => Number.isFinite(row.year))
    .sort((a, b) => b.year - a.year);
}

const activity = z.object({
  general_issue_code: text,
  general_issue_code_display: text,
  description: text,
  lobbyists: z
    .array(
      z.object({
        lobbyist: z.object({ first_name: text, last_name: text }).nullish(),
        covered_position: text,
      }),
    )
    .nullish(),
  government_entities: z.array(z.object({ name: text })).nullish(),
});

const filing = z.object({
  filing_uuid: z.string(),
  filing_year: z.union([z.number(), z.string()]),
  filing_period_display: text,
  filing_period: text,
  income: money,
  expenses: money,
  dt_posted: text,
  filing_document_url: text,
  registrant: z.object({ name: text }).nullish(),
  client: z.object({ name: text }).nullish(),
  lobbying_activities: z.array(activity).nullish(),
});

const NO_POSITION = /^(n\/?a|none|not applicable|no|nil|-+|\.+)$/i;

export function coveredPosition(value: string | null | undefined) {
  const trimmed = clean(value);
  return trimmed && !NO_POSITION.test(trimmed) ? trimmed : null;
}

export function ldaPage(json: unknown): {
  count: number;
  hasNext: boolean;
  filings: LobbyingFiling[];
} | null {
  const page = z
    .object({
      count: z.number().optional(),
      next: z.string().nullish(),
      results: z.array(z.unknown()),
    })
    .safeParse(json);
  if (!page.success) return null;
  const filings: LobbyingFiling[] = [];
  for (const raw of page.data.results) {
    const parsed = filing.safeParse(raw);
    if (!parsed.success) continue;
    const row = parsed.data;
    const client = clean(row.client?.name);
    if (!client) continue;
    const amount = row.expenses ?? row.income;
    const people = new Map<string, string | null>();
    const entities = new Set<string>();
    const issues: LobbyingFiling["issues"] = [];
    for (const item of row.lobbying_activities ?? []) {
      issues.push({
        code: clean(item.general_issue_code),
        label: clean(item.general_issue_code_display),
        description: clean(item.description),
      });
      for (const entity of item.government_entities ?? []) {
        const name = clean(entity.name);
        if (name) entities.add(name);
      }
      for (const entry of item.lobbyists ?? []) {
        const name = clean(
          `${entry.lobbyist?.first_name ?? ""} ${entry.lobbyist?.last_name ?? ""}`,
        );
        if (!name) continue;
        const covered = coveredPosition(entry.covered_position);
        if (covered || !people.has(name)) people.set(name, covered);
      }
    }
    filings.push({
      id: row.filing_uuid,
      client,
      registrant: clean(row.registrant?.name) ?? "—",
      ticker: null,
      amount,
      year: Number(row.filing_year),
      period: clean(row.filing_period_display) ?? clean(row.filing_period),
      posted: clean(row.dt_posted),
      issues,
      entities: [...entities],
      lobbyists: [...people].map(([name, covered]) => ({ name, covered })),
      url: clean(row.filing_document_url),
    });
  }
  return {
    count: page.data.count ?? filings.length,
    hasNext: Boolean(page.data.next),
    filings,
  };
}

export function revolvingDoor(filings: LobbyingFiling[]): RevolvingLobbyist[] {
  const byKey = new Map<
    string,
    {
      name: string;
      covered: string;
      clients: Map<string, string | null>;
      registrants: Set<string>;
      filings: number;
      latest: string | null;
    }
  >();
  for (const item of filings) {
    for (const person of item.lobbyists) {
      if (!person.covered) continue;
      const key = person.name.toUpperCase();
      const entry = byKey.get(key) ?? {
        name: person.name,
        covered: person.covered,
        clients: new Map(),
        registrants: new Set(),
        filings: 0,
        latest: null,
      };
      entry.clients.set(item.client, item.ticker);
      entry.registrants.add(item.registrant);
      entry.filings += 1;
      if (item.posted && (!entry.latest || item.posted > entry.latest))
        entry.latest = item.posted;
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()]
    .map((entry) => ({
      name: entry.name,
      covered: entry.covered,
      clients: [...entry.clients].map(([client, ticker]) => ({
        client,
        ticker,
      })),
      registrants: [...entry.registrants],
      filings: entry.filings,
      latest: entry.latest,
    }))
    .sort((a, b) => b.filings - a.filings || a.name.localeCompare(b.name));
}

/** The cycle a date falls in: federal cycles end in even years. */
export const fecCycle = (date = new Date()) => {
  const year = date.getUTCFullYear();
  return year % 2 === 0 ? year : year + 1;
};

const PAC_NOISE = new Set([
  "EMPLOYEES",
  "EMPLOYEE",
  "POLITICAL",
  "PAC",
  "FEDERAL",
  "FUND",
  "COMMITTEE",
  "PUBLIC",
  "GOOD",
  "GOVERNMENT",
  "VOLUNTARY",
  "CITIZENSHIP",
  "CITIZENS",
  "ACTION",
  "STOCKHOLDERS",
  "SHAREHOLDERS",
  "MANAGEMENT",
  "SEPARATE",
  "SEGREGATED",
  "CONNECTED",
  "SSF",
  "AFFAIRS",
  "COUNCIL",
  "TEAM",
]);

/**
 * Company-name candidates for a corporate PAC's name, longest first: the
 * words before the first PAC-ish word, then shorter prefixes of them.
 */
export function pacOrgCandidates(name: string): string[] {
  const words = name
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/'/g, "")
    .replace(/[^A-Z0-9& ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const cut = words.findIndex((word) => PAC_NOISE.has(word));
  const head = (cut === -1 ? words : words.slice(0, cut)).filter(
    (word, index) => !(index === 0 && word === "THE"),
  );
  const out: string[] = [];
  for (let size = head.length; size >= 1; size--)
    out.push(head.slice(0, size).join(" "));
  return out;
}

const partyCode = (value: string | null | undefined) => {
  const upper = value?.toUpperCase();
  if (!upper) return null;
  if (upper === "DEM" || upper === "REP") return upper;
  return upper;
};

export function fecCommittees(json: unknown): {
  id: string;
  name: string;
  affiliated: string | null;
  lastFiled: string | null;
}[] {
  const parsed = z
    .object({
      results: z.array(
        z.object({
          committee_id: z.string(),
          name: z.string(),
          affiliated_committee_name: text,
          connected_organization_name: text,
          last_file_date: text,
          organization_type: text,
        }),
      ),
    })
    .safeParse(json);
  if (!parsed.success) return [];
  return parsed.data.results
    .filter((row) => !row.organization_type || row.organization_type === "C")
    .map((row) => ({
      id: row.committee_id,
      name: row.name,
      affiliated:
        clean(row.connected_organization_name) ??
        clean(row.affiliated_committee_name),
      lastFiled: clean(row.last_file_date),
    }));
}

const totalsRow = z.object({
  committee_id: z.string(),
  committee_name: text,
  cycle: z.number(),
  receipts: money,
  disbursements: money,
  contributions: money,
  fed_candidate_committee_contributions: money,
  coverage_end_date: text,
});

export type FecTotals = {
  committeeId: string;
  committee: string;
  cycle: number;
  receipts: number;
  disbursements: number;
  contributions: number;
  candidateContributions: number;
  coverageEnd: string | null;
};

export function fecTotals(json: unknown): FecTotals[] {
  const parsed = z.object({ results: z.array(z.unknown()) }).safeParse(json);
  if (!parsed.success) return [];
  const rows: FecTotals[] = [];
  for (const raw of parsed.data.results) {
    const row = totalsRow.safeParse(raw);
    if (!row.success) continue;
    rows.push({
      committeeId: row.data.committee_id,
      committee: clean(row.data.committee_name) ?? row.data.committee_id,
      cycle: row.data.cycle,
      receipts: row.data.receipts ?? 0,
      disbursements: row.data.disbursements ?? 0,
      contributions: row.data.contributions ?? 0,
      candidateContributions:
        row.data.fed_candidate_committee_contributions ?? 0,
      coverageEnd: clean(row.data.coverage_end_date)?.slice(0, 10) ?? null,
    });
  }
  return rows;
}

export function groupCycles(rows: FecTotals[]): PacCommittee["cycles"] {
  return rows
    .map((row) => ({
      cycle: row.cycle,
      receipts: row.receipts,
      disbursements: row.disbursements,
      contributions: row.contributions,
      coverageEnd: row.coverageEnd,
    }))
    .sort((a, b) => b.cycle - a.cycle);
}

const disbursement = z.object({
  committee_id: z.string(),
  recipient_name: text,
  recipient_committee_id: text,
  disbursement_amount: money,
  disbursement_date: text,
  candidate_name: text,
  candidate_office: text,
  recipient_committee: z
    .object({
      party: text,
      committee_type: text,
      name: text,
    })
    .nullish(),
});

export function fecContributions(json: unknown): PacContribution[] {
  const parsed = z.object({ results: z.array(z.unknown()) }).safeParse(json);
  if (!parsed.success) return [];
  const rows: PacContribution[] = [];
  for (const raw of parsed.data.results) {
    const row = disbursement.safeParse(raw);
    if (!row.success) continue;
    const amount = row.data.disbursement_amount;
    const recipient = clean(row.data.recipient_name);
    if (!recipient || amount == null || amount <= 0) continue;
    const type = row.data.recipient_committee?.committee_type;
    const candidate = clean(row.data.candidate_name);
    rows.push({
      committeeId: row.data.committee_id,
      recipient,
      recipientId: clean(row.data.recipient_committee_id),
      candidate,
      office: clean(row.data.candidate_office),
      party: partyCode(row.data.recipient_committee?.party),
      kind:
        candidate || type === "H" || type === "S" || type === "P"
          ? "candidate"
          : "committee",
      amount,
      date: clean(row.data.disbursement_date)?.slice(0, 10) ?? null,
    });
  }
  return rows;
}

export function partySplit(rows: PacContribution[]) {
  const by = new Map<string, { amount: number; count: number }>();
  for (const row of rows) {
    const key = row.party ?? "OTHER";
    const entry = by.get(key) ?? { amount: 0, count: 0 };
    entry.amount += row.amount;
    entry.count += 1;
    by.set(key, entry);
  }
  return [...by]
    .map(([party, value]) => ({ party, ...value }))
    .sort((a, b) => b.amount - a.amount);
}
