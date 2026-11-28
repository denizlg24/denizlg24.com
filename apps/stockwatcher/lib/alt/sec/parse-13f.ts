import type {
  ChangeStatus,
  FilingRef,
  Position,
  PositionChange,
} from "./types";

const entities: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
};
const decode = (text: string) =>
  text.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (match) => entities[match]);

const tagPatterns = new Map<string, RegExp>();
function tag(block: string, name: string): string | null {
  let pattern = tagPatterns.get(name);
  if (!pattern) {
    pattern = new RegExp(
      `<(?:\\w+:)?${name}>\\s*([^<]*?)\\s*</(?:\\w+:)?${name}>`,
    );
    tagPatterns.set(name, pattern);
  }
  const match = pattern.exec(block);
  return match ? decode(match[1]) : null;
}

/** EDGAR writes dates as MM-DD-YYYY in 13F XML. */
export function isoDate(text: string | null): string | null {
  if (!text) return null;
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text.trim());
  if (match) return `${match[3]}-${match[1]}-${match[2]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) ? text.trim() : null;
}

export type CoverPage = {
  managerName: string;
  period: string | null;
  amendment: FilingRef["amendment"];
  reportedTotal: number | null;
};

export function parseCoverPage(xml: string): CoverPage {
  const manager =
    /<(?:\w+:)?filingManager>([\s\S]*?)<\/(?:\w+:)?filingManager>/.exec(xml);
  const amendmentType = tag(xml, "amendmentType")?.toUpperCase() ?? null;
  const total = Number(tag(xml, "tableValueTotal"));
  return {
    managerName: (manager ? tag(manager[1], "name") : null) ?? "",
    period: isoDate(
      tag(xml, "periodOfReport") ?? tag(xml, "reportCalendarOrQuarter"),
    ),
    amendment:
      amendmentType === "RESTATEMENT"
        ? "RESTATEMENT"
        : amendmentType === "NEW HOLDINGS"
          ? "NEW HOLDINGS"
          : null,
    reportedTotal:
      Number.isFinite(total) && tag(xml, "tableValueTotal") ? total : null,
  };
}

/** Reports for periods ending before 2022-12-31 state values in thousands of dollars. */
export const valueMultiplier = (period: string) =>
  period < "2022-12-31" ? 1000 : 1;

const key = (position: Pick<Position, "cusip" | "putCall" | "shareType">) =>
  `${position.cusip}|${position.putCall ?? ""}|${position.shareType}`;

/** Sums rows that share a CUSIP, put/call and unit: 13F lists one row per sub-manager. */
export function aggregatePositions(rows: Position[]): Position[] {
  const merged = new Map<string, Position & { top: number }>();
  for (const row of rows) {
    const existing = merged.get(key(row));
    if (!existing) {
      merged.set(key(row), { ...row, top: row.value });
      continue;
    }
    existing.value += row.value;
    existing.shares += row.shares;
    if (row.value > existing.top) {
      existing.top = row.value;
      existing.discretion = row.discretion;
    }
  }
  return [...merged.values()]
    .map(({ top: _top, ...position }) => position)
    .sort((a, b) => b.value - a.value);
}

export function parseInfoTable(xml: string, period: string): Position[] {
  const multiplier = valueMultiplier(period);
  const rows: Position[] = [];
  const blocks = xml.matchAll(
    /<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/g,
  );
  for (const [, block] of blocks) {
    const cusip = tag(block, "cusip")?.toUpperCase();
    const value = Number(tag(block, "value"));
    const shares = Number(tag(block, "sshPrnamt"));
    if (!cusip || !Number.isFinite(value)) continue;
    const put = tag(block, "putCall")?.toLowerCase();
    rows.push({
      cusip,
      issuer: tag(block, "nameOfIssuer") ?? "",
      titleOfClass: tag(block, "titleOfClass") ?? "",
      value: value * multiplier,
      shares: Number.isFinite(shares) ? shares : 0,
      shareType:
        tag(block, "sshPrnamtType")?.toUpperCase() === "PRN" ? "PRN" : "SH",
      putCall: put === "put" ? "Put" : put === "call" ? "Call" : null,
      discretion: tag(block, "investmentDiscretion"),
    });
  }
  return aggregatePositions(rows);
}

/** A restatement replaces the period's table; a new-holdings amendment adds rows to it. */
export function applyAmendment(
  base: Position[],
  amendment: FilingRef["amendment"],
  next: Position[],
): Position[] {
  return amendment === "NEW HOLDINGS"
    ? aggregatePositions([...base, ...next])
    : next;
}

export function diffPositions(
  current: Position[],
  previous: Position[],
): PositionChange[] {
  const before = new Map(previous.map((position) => [key(position), position]));
  const changes: PositionChange[] = [];
  for (const now of current) {
    const was = before.get(key(now));
    before.delete(key(now));
    const previousShares = was?.shares ?? 0;
    const sharesChange = now.shares - previousShares;
    const status: ChangeStatus = !was
      ? "new"
      : sharesChange > 0
        ? "added"
        : sharesChange < 0
          ? "reduced"
          : "unchanged";
    changes.push({
      cusip: now.cusip,
      issuer: now.issuer,
      titleOfClass: now.titleOfClass,
      putCall: now.putCall,
      status,
      shares: now.shares,
      previousShares,
      value: now.value,
      previousValue: was?.value ?? 0,
      sharesChange,
      sharesChangePercent:
        was && was.shares > 0 ? (sharesChange / was.shares) * 100 : null,
    });
  }
  for (const gone of before.values())
    changes.push({
      cusip: gone.cusip,
      issuer: gone.issuer,
      titleOfClass: gone.titleOfClass,
      putCall: gone.putCall,
      status: "sold",
      shares: 0,
      previousShares: gone.shares,
      value: 0,
      previousValue: gone.value,
      sharesChange: -gone.shares,
      sharesChangePercent: -100,
    });
  return changes.sort(
    (a, b) =>
      Math.abs(b.value - b.previousValue) - Math.abs(a.value - a.previousValue),
  );
}

/** The information table is the filing's XML document that is neither the cover page nor a rendered copy. */
export function infoTableCandidates(names: string[]): string[] {
  return names.filter(
    (name) =>
      /\.xml$/i.test(name) &&
      name.toLowerCase() !== "primary_doc.xml" &&
      !/^xsl/i.test(name),
  );
}
