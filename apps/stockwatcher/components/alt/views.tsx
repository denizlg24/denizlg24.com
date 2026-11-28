"use client";

import type { AltMonitorFunction, AltSecurityFunction } from "@/lib/terminal";
import { CongressFeed, CongressTickerView, TrumpFeed } from "./congress";
import {
  ContractsFeed,
  ContractsView,
  LobbyingFeed,
  LobbyingView,
  PacFeed,
  PacView,
} from "./gov";
import {
  AppRatingsView,
  AttentionView,
  OffExchangeBoard,
  OffExchangeView,
  PatentsView,
  PolymarketBoard,
  WarnFeed,
  WarnView,
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
    case "LOBY":
      return <LobbyingFeed select={select} />;
    case "PACS":
      return <PacFeed select={select} />;
    case "DARK":
      return <OffExchangeBoard select={select} />;
    case "PMKT":
      return <PolymarketBoard />;
    case "WARN":
      return <WarnFeed select={select} />;
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
    case "LOBY":
      return <LobbyingView ticker={ticker} />;
    case "PACS":
      return <PacView ticker={ticker} />;
    case "DARK":
      return <OffExchangeView ticker={ticker} />;
    case "PATN":
      return <PatentsView ticker={ticker} />;
    case "APPR":
      return <AppRatingsView ticker={ticker} />;
    case "WIKI":
      return <AttentionView ticker={ticker} />;
    case "WARN":
      return <WarnView ticker={ticker} />;
  }
}
