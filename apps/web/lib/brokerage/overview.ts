import type {
  BrokerageActivity,
  BrokerageHolding,
  BrokerageNavChange,
  BrokerageOverview,
  BrokerageSeriesPoint,
  BrokerageSnapshot,
} from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import {
  BrokerageActivityModel,
  BrokerageSnapshotModel,
  BrokerageSyncState,
  type IBrokerageActivity,
} from "@/models/Brokerage";
import { BROKERAGE_STATE_ID } from "./sync";

const ACTIVITY_LIMIT = 50;

interface SeriesInput {
  reportDate: string;
  nav: number;
  change: BrokerageNavChange | null;
}

/**
 * Compounds IBKR's daily time-weighted returns and accumulates flows. A day
 * missing from storage contributes nothing to either, so a gap understates
 * deposits rather than inventing return.
 */
export function buildSeries(rows: SeriesInput[]): BrokerageSeriesPoint[] {
  let growth = 1;
  let netDeposits = 0;
  return rows.map((row) => {
    growth *= 1 + (row.change?.twr ?? 0) / 100;
    netDeposits += row.change?.flows ?? 0;
    return {
      date: row.reportDate,
      nav: row.nav,
      netDeposits,
      cumulativeReturn: growth - 1,
    };
  });
}

/** Price change per instrument against the previous stored day. */
export function withDayChange(
  latest: BrokerageSnapshot,
  previous: BrokerageSnapshot | null,
): BrokerageHolding[] {
  const prior = new Map(
    (previous?.positions ?? []).map((position) => [
      position.conid,
      position.markPrice,
    ]),
  );
  return latest.positions
    .map((position) => {
      const before = prior.get(position.conid);
      return {
        ...position,
        dayChange: before ? position.markPrice / before - 1 : null,
      };
    })
    .sort((a, b) => b.valueBase - a.valueBase);
}

function serializeActivity(row: IBrokerageActivity): BrokerageActivity {
  return {
    id: row.activityId,
    kind: row.kind,
    date: row.date,
    type: row.type,
    symbol: row.symbol ?? undefined,
    description: row.description,
    currency: row.currency,
    amount: row.amount,
    amountBase: row.amountBase,
    side: row.side ?? undefined,
    quantity: row.quantity ?? undefined,
    price: row.price ?? undefined,
    commission: row.commission ?? undefined,
  };
}

function toSnapshot(row: BrokerageSnapshot): BrokerageSnapshot {
  return {
    accountId: row.accountId,
    reportDate: row.reportDate,
    baseCurrency: row.baseCurrency,
    nav: row.nav,
    cashBase: row.cashBase,
    change: row.change ?? null,
    positions: row.positions,
    cash: row.cash,
  };
}

export async function getBrokerageOverview(): Promise<BrokerageOverview> {
  await connectDB();
  const state = await BrokerageSyncState.findById(BROKERAGE_STATE_ID).lean();
  const sync = {
    lastAttemptAt: state?.lastAttemptAt?.toISOString(),
    lastSyncedAt: state?.lastSyncedAt?.toISOString(),
    lastError: state?.lastError ?? undefined,
  };
  if (!state?.accountId) {
    return {
      account: null,
      sync,
      asOf: null,
      totals: null,
      holdings: [],
      cash: [],
      series: [],
      activity: [],
    };
  }
  const accountId = state.accountId;

  const [seriesRows, latestRows, activityRows] = await Promise.all([
    BrokerageSnapshotModel.find(
      { accountId },
      { _id: 0, reportDate: 1, nav: 1, change: 1 },
    )
      .sort({ reportDate: 1 })
      .lean<SeriesInput[]>(),
    BrokerageSnapshotModel.find({ accountId }, { _id: 0, syncedAt: 0 })
      .sort({ reportDate: -1 })
      .limit(2)
      .lean<BrokerageSnapshot[]>(),
    BrokerageActivityModel.find({ accountId })
      .sort({ date: -1, activityId: -1 })
      .limit(ACTIVITY_LIMIT)
      .lean<IBrokerageActivity[]>(),
  ]);

  const series = buildSeries(seriesRows);
  const latest = latestRows[0] ? toSnapshot(latestRows[0]) : null;
  const previous = latestRows[1] ? toSnapshot(latestRows[1]) : null;
  const account = {
    accountId,
    baseCurrency: state.baseCurrency ?? latest?.baseCurrency ?? "EUR",
    entity: state.entity ?? undefined,
  };
  if (!latest) {
    return {
      account,
      sync,
      asOf: null,
      totals: null,
      holdings: [],
      cash: [],
      series,
      activity: activityRows.map(serializeActivity),
    };
  }

  const last = series.at(-1);
  const netDeposits = last?.netDeposits ?? 0;
  let income = 0;
  let commissions = 0;
  for (const row of seriesRows) {
    income += (row.change?.dividends ?? 0) + (row.change?.withholdingTax ?? 0);
    commissions += row.change?.commissions ?? 0;
  }
  const change = latest.change;
  const dayPnl = change
    ? change.endingValue - change.startingValue - change.flows
    : null;

  return {
    account,
    sync,
    asOf: latest.reportDate,
    totals: {
      nav: latest.nav,
      cash: latest.cashBase,
      netDeposits,
      pnl: latest.nav - netDeposits,
      cumulativeReturn: last?.cumulativeReturn ?? 0,
      dayPnl,
      dayReturn: change ? change.twr / 100 : null,
      income,
      commissions,
    },
    holdings: withDayChange(latest, previous),
    cash: latest.cash,
    series,
    activity: activityRows.map(serializeActivity),
  };
}

export interface BrokerageValuation {
  accountId: string;
  entity?: string;
  asOf: string;
  nav: number;
  baseCurrency: string;
}

/** The latest statement's NAV, for finance's net worth. */
export async function getLatestBrokerageValuation(): Promise<BrokerageValuation | null> {
  await connectDB();
  const state = await BrokerageSyncState.findById(BROKERAGE_STATE_ID).lean();
  if (!state?.accountId) return null;
  const latest = await BrokerageSnapshotModel.findOne(
    { accountId: state.accountId },
    { _id: 0, reportDate: 1, nav: 1, baseCurrency: 1 },
  )
    .sort({ reportDate: -1 })
    .lean<Pick<BrokerageSnapshot, "reportDate" | "nav" | "baseCurrency">>();
  if (!latest) return null;
  return {
    accountId: state.accountId,
    entity: state.entity ?? undefined,
    asOf: latest.reportDate,
    nav: latest.nav,
    baseCurrency: latest.baseCurrency,
  };
}
