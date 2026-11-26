"use client";

import { useState } from "react";
import useSWR from "swr";
import { Link2, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BrokerBook } from "@/lib/models";
import { amount } from "@/lib/utils";
import { api, Failure } from "./shared";
import { FormDialog } from "./forms";
import { IbkrGuide, tokenStep } from "./ibkr-guide";

type PublicLink = {
  provider: "ibkr";
  queryId: string;
  status: "active" | "error" | "relink";
  error: string | null;
  createdAt: string;
  syncedAt: string | null;
};

type SyncResult =
  | {
      ok: true;
      accounts: Array<{ id: string; positions: number; asOf: string }>;
      skipped: Array<{ account: string; symbol: string; reason: string }>;
    }
  | { ok: false; error: string; relink: boolean };

type SyncResponse = { result: SyncResult; link: PublicLink | null };

const endpoint = "/api/brokers/ibkr";

async function post(body?: object): Promise<SyncResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await response.json()) as Partial<SyncResponse> & {
    error?: string;
  };
  if (data.result && !data.result.ok) throw new Error(data.result.error);
  if (!response.ok || !data.result)
    throw new Error(data.error ?? "Interactive Brokers sync failed.");
  return data as SyncResponse;
}

function ago(iso: string | null) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function BrokerConnect({
  reload,
  onSynced,
}: {
  reload: () => Promise<unknown>;
  onSynced: (accounts: string[]) => void;
}) {
  const { data, mutate } = useSWR<{ link: PublicLink | null }>(endpoint, api, {
    refreshInterval: 5 * 60_000,
  });
  const link = data?.link ?? null;
  const [dialog, setDialog] = useState<"connect" | "disconnect" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<Error>();

  const syncNow = async () => {
    setSyncing(true);
    setError(undefined);
    try {
      const response = await post();
      await Promise.all([mutate({ link: response.link }), reload()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Sync failed."));
      await mutate();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="broker-link">
      {link ? (
        <>
          <p className="broker-status">
            <span className={`broker-dot broker-dot-${link.status}`} />
            <span>
              Interactive Brokers ·{" "}
              {link.status === "relink"
                ? "needs a new token"
                : `synced ${ago(link.syncedAt)}`}
            </span>
          </p>
          {link.error && !error ? (
            <p className="broker-error">{link.error}</p>
          ) : null}
          <div className="row-actions">
            {link.status === "relink" ? (
              <Button size="sm" onClick={() => setDialog("connect")}>
                <Link2 /> Reconnect
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={syncing}
                onClick={() => void syncNow()}
              >
                <RefreshCw className={syncing ? "spin" : undefined} />
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Disconnect Interactive Brokers"
              onClick={() => setDialog("disconnect")}
            >
              <Unlink />
            </Button>
          </div>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="broker-connect"
          onClick={() => setDialog("connect")}
        >
          <Link2 /> Connect Interactive Brokers
        </Button>
      )}
      <Failure error={error} />
      {dialog === "connect" ? (
        <IbkrGuide
          close={() => setDialog(null)}
          initialQueryId={link?.queryId}
          startAt={link?.status === "relink" ? tokenStep : 0}
          connect={async (input) => {
            const response = await post(input);
            await Promise.all([mutate({ link: response.link }), reload()]);
            if (response.result.ok)
              onSynced(response.result.accounts.map((item) => item.id));
          }}
        />
      ) : null}
      {dialog === "disconnect" ? (
        <FormDialog
          title="Disconnect Interactive Brokers?"
          description="Stockwatcher deletes the saved token. Synced portfolios stay as manual portfolios with their last positions. Revoke the token in the IBKR Client Portal as well."
          label="Disconnect"
          danger
          close={() => setDialog(null)}
          submit={async () => {
            await api(endpoint, { method: "DELETE" });
            await Promise.all([mutate({ link: null }), reload()]);
          }}
        />
      ) : null}
    </div>
  );
}

export function BrokerBookNote({ broker }: { broker: BrokerBook }) {
  return (
    <div className="broker-note">
      <p>
        Synced from Interactive Brokers account <b>{broker.account}</b>.
        Positions as of {broker.asOf}, average cost from the IBKR cost basis.
        Last sync {ago(broker.syncedAt)}. Edit trades in IBKR, not here.
      </p>
      {broker.cash.length ? (
        <p>
          Cash{" "}
          {broker.cash.map((item, index) => (
            <span key={item.currency}>
              {index ? " · " : ""}
              {item.currency} {amount(item.amount)}
            </span>
          ))}
        </p>
      ) : null}
      {broker.skipped.length ? (
        <p className="broker-skipped">
          Not tracked:{" "}
          {broker.skipped
            .map((item) => `${item.symbol} (${item.reason})`)
            .join(", ")}
        </p>
      ) : null}
    </div>
  );
}
