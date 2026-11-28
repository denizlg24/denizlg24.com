"use client";

import type { AltMonitorFunction, AltSecurityFunction } from "@/lib/terminal";
import { CongressFeed, CongressTickerView, TrumpFeed } from "./congress";
import { ContractsFeed, ContractsView, PacFeed, PacView } from "./gov";
import {
  AppRatingsView,
  AttentionView,
  FlightsBoard,
  FlightsView,
  OffExchangeBoard,
  OffExchangeView,
  PolymarketBoard,
  WarnFeed,
  WarnView,
  WsbBoard,
  WsbView,
} from "./market";
import {
  EtfHoldings,
  ExecComp,
  InstitutionalHolders,
  ManagerPortfolio,
} from "./sec";

export function AltMonitor({
  fn,
  select,
}: {
  fn: AltMonitorFunction;
  select: (symbol: string) => void;
}) {
  switch (fn) {
    case "CONG":
      return <CongressFeed select={select} />;
    case "TRMP":
      return <TrumpFeed select={select} />;
    case "FUND":
      return <ManagerPortfolio />;
    case "CONT":
      return <ContractsFeed select={select} />;
    case "PACS":
      return <PacFeed select={select} />;
    case "DARK":
      return <OffExchangeBoard select={select} />;
    case "PMKT":
      return <PolymarketBoard />;
    case "WARN":
      return <WarnFeed select={select} />;
    case "WSB":
      return <WsbBoard select={select} />;
    case "ACFT":
      return <FlightsBoard select={select} />;
  }
}

export function AltSecurity({
  fn,
  ticker,
  select,
}: {
  fn: AltSecurityFunction;
  ticker: string;
  select: (symbol: string) => void;
}) {
  switch (fn) {
    case "CONG":
      return <CongressTickerView ticker={ticker} />;
    case "INST":
      return <InstitutionalHolders ticker={ticker} />;
    case "EXEC":
      return <ExecComp ticker={ticker} />;
    case "ETF":
      return <EtfHoldings ticker={ticker} select={select} />;
    case "CONT":
      return <ContractsView ticker={ticker} />;
    case "PACS":
      return <PacView ticker={ticker} />;
    case "DARK":
      return <OffExchangeView ticker={ticker} />;
    case "APPR":
      return <AppRatingsView ticker={ticker} />;
    case "WIKI":
      return <AttentionView ticker={ticker} />;
    case "WARN":
      return <WarnView ticker={ticker} />;
    case "WSB":
      return <WsbView ticker={ticker} />;
    case "ACFT":
      return <FlightsView ticker={ticker} />;
  }
}
