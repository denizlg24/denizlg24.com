"use client";

import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../../provider";
import {
  type AiConnectionsResponse,
  authorizeVercel,
  disconnectGateway,
  getAiConnections,
  saveGatewayConnection,
  testGatewayConnection,
} from "../ai-connections-api";
import { SettingsGroup, SettingsRow } from "../settings-shell";
import { AiSubscriptionsSection } from "./ai-subscriptions-section";

const statusLabels = {
  connected: "Connected",
  unverified: "Not tested",
  error: "Connection error",
  disconnected: "Disconnected",
} as const;

const sourceLabels = {
  stored: "Saved key",
  environment: "Host key",
  oauth: "Vercel account",
} as const;

export function AiConnectionsSection() {
  const { client, platform } = useAdmin();
  const [data, setData] = useState<AiConnectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [team, setTeam] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setFailed(false);
      try {
        const next = await getAiConnections(client, { signal });
        if (signal?.aborted) return;
        setData(next);
        setTeam(next.gateway.teamIdOrSlug ?? "");
      } catch {
        if (!signal?.aborted) setFailed(true);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function run(kind: "save" | "test" | "disconnect" | "authorize") {
    if (busy.current || !data) return;
    busy.current = true;
    setAction(kind);
    try {
      if (kind === "save") {
        await saveGatewayConnection(client, {
          apiKey: apiKey.trim(),
          teamIdOrSlug: team.trim() || undefined,
        });
        setApiKey("");
        toast.success("Gateway key saved");
      } else if (kind === "test") {
        await testGatewayConnection(client);
      } else if (kind === "disconnect") {
        await disconnectGateway(client);
        setApiKey("");
      } else {
        await platform.openExternal(authorizeVercel(client, team));
        return;
      }
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : {
              save: "Could not save Gateway key",
              test: "Gateway test failed. Refresh to check its status.",
              disconnect: "Could not disconnect Gateway",
              authorize: "Could not open Vercel sign-in",
            }[kind],
      );
      if (kind === "test") await load();
    } finally {
      busy.current = false;
      setAction(null);
    }
  }

  const disabled = action !== null || loading;
  const gateway = data?.gateway;

  return (
    <>
      <SettingsGroup
        label="Vercel AI Gateway"
        description="Billing: Gateway credits"
        actions={
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => void load()}
          >
            Refresh
          </Button>
        }
      >
        {loading ? (
          <Skeleton className="h-9 w-full" />
        ) : failed ? (
          <div className="flex flex-wrap items-center gap-2" role="alert">
            <span className="text-sm text-muted-foreground">
              Could not load Gateway connection
            </span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        ) : gateway ? (
          <>
            <SettingsRow
              label="Connection"
              hint={gateway.source ? sourceLabels[gateway.source] : undefined}
            >
              <div className="flex flex-wrap items-center gap-2" role="status">
                <Badge
                  variant={
                    gateway.status === "error" ? "critical" : "secondary"
                  }
                >
                  {statusLabels[gateway.status]}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled || !gateway.configured}
                  onClick={() => void run("test")}
                >
                  {action === "test" ? <Spinner /> : null} Test
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={
                    disabled ||
                    !gateway.configured ||
                    gateway.source === "environment"
                  }
                  onClick={() => void run("disconnect")}
                >
                  {action === "disconnect" ? <Spinner /> : null} Disconnect
                </Button>
              </div>
            </SettingsRow>
            {gateway.lastError ? (
              <p className="break-words text-xs text-destructive" role="alert">
                {gateway.lastError}
              </p>
            ) : null}
            {gateway.source === "environment" ? (
              <p className="text-xs text-muted-foreground">
                Host key managed on the server
              </p>
            ) : null}
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (apiKey.trim()) void run("save");
              }}
            >
              <SettingsRow label="Team ID or slug" htmlFor="gateway-team">
                <Input
                  id="gateway-team"
                  className="w-full"
                  value={team}
                  disabled={disabled}
                  onChange={(event) => setTeam(event.target.value)}
                  placeholder="Optional"
                  autoComplete="off"
                  spellCheck={false}
                />
              </SettingsRow>
              <SettingsRow
                label={gateway.configured ? "Replace key" : "API key"}
                hint="Encrypted when saved · never shown again"
                htmlFor="gateway-key"
                stacked
              >
                <div className="flex w-full items-center gap-2">
                  <Input
                    id="gateway-key"
                    type="password"
                    className="min-w-0 flex-1"
                    value={apiKey}
                    disabled={disabled}
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={disabled || !apiKey.trim()}
                  >
                    {action === "save" ? <Spinner /> : null}{" "}
                    {gateway.configured ? "Replace key" : "Save key"}
                  </Button>
                </div>
              </SettingsRow>
            </form>
            {data.vercelOAuthAvailable && client.endpointUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => void run("authorize")}
                >
                  {action === "authorize" ? <Spinner /> : null} Connect Vercel
                </Button>
                <span className="text-xs text-muted-foreground">
                  Refresh after signing in
                </span>
              </div>
            ) : null}
          </>
        ) : null}
      </SettingsGroup>
      <AiSubscriptionsSection />
    </>
  );
}
