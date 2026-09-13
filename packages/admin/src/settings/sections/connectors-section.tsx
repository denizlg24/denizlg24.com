"use client";

import {
  type Connector,
  type ConnectorApproval,
  type ConnectorAuth,
  type ConnectorAuthorizeResponse,
  type ConnectorDetail,
  type ConnectorTool,
  connectorApprovalSchema,
  connectorSlugSchema,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { RadioGroup, RadioGroupItem } from "@repo/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { Switch } from "@repo/ui/switch";
import { cn } from "@repo/ui/utils";
import { ChevronRight } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { useConnectors } from "../../agent/use-connectors";
import { AdminApiError } from "../../client";
import { useAdmin } from "../../provider";
import { SettingsGroup } from "../settings-shell";

const APPROVAL_LABEL: Record<ConnectorApproval, string> = {
  "reads-auto": "Reads run, writes ask",
  "always-ask": "Always ask",
  "never-ask": "Never ask",
};

const STATUS_TONE: Record<Connector["status"], StatusTone> = {
  ready: "good",
  "needs-auth": "warning",
  error: "critical",
  unconfigured: "muted",
};

const STATUS_LABEL: Record<Connector["status"], string> = {
  ready: "Ready",
  "needs-auth": "Needs auth",
  error: "Error",
  unconfigured: "Unconfigured",
};

function relativeTime(value: string | null): string | null {
  if (!value) return null;
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1_000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof AdminApiError || cause instanceof Error
    ? cause.message
    : fallback;
}

function toolFlags(tool: ConnectorTool): string {
  if (tool.actions) {
    const entries = Object.entries(tool.actions);
    const writes = entries.filter(([, flags]) => !flags.readOnly).length;
    return `${entries.length} actions · ${writes} write`;
  }
  if (tool.destructive) return "destructive";
  return tool.readOnly ? "read" : "write";
}

function ConnectorTools({
  connector,
  onChange,
}: {
  connector: Connector;
  onChange: (connector: Connector) => void;
}) {
  const { client } = useAdmin();
  const [tools, setTools] = useState<ConnectorTool[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .get<ConnectorDetail>(`connectors/${connector.id}`)
      .then((detail) => {
        if (!cancelled) setTools(detail.tools);
      })
      .catch(() => {
        if (!cancelled) setTools([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client, connector.id]);

  const toggle = async (name: string, enabled: boolean) => {
    const disabledTools = enabled
      ? connector.disabledTools.filter((tool) => tool !== name)
      : [...connector.disabledTools, name];
    setSaving(name);
    try {
      const detail = await client.patch<ConnectorDetail>(
        `connectors/${connector.id}`,
        { disabledTools },
      );
      onChange(detail.connector);
      setTools(detail.tools);
    } catch (cause) {
      toast.error(errorText(cause, "Failed to update tool"));
    } finally {
      setSaving(null);
    }
  };

  if (!tools) {
    return (
      <div className="space-y-2 py-2">
        {[64, 48, 56].map((width) => (
          <Skeleton
            key={width}
            className="h-3"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
    );
  }
  if (tools.length === 0) {
    return <p className="py-2 text-xs text-muted-foreground">—</p>;
  }
  return (
    <ul className="divide-y divide-border/60">
      {tools.map((tool) => {
        const enabled = !connector.disabledTools.includes(tool.name);
        return (
          <li
            key={tool.name}
            className="flex min-w-0 items-center gap-3 py-1.5 text-xs"
          >
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <span
                  className={cn(
                    "truncate font-mono text-[11px]",
                    !enabled && "text-muted-foreground line-through",
                  )}
                >
                  {tool.name}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {toolFlags(tool)}
                </span>
              </div>
              {tool.title || tool.description ? (
                <p className="truncate text-[11px] text-muted-foreground">
                  {tool.title ?? tool.description}
                </p>
              ) : null}
            </div>
            {saving === tool.name ? <Spinner className="size-3" /> : null}
            <Switch
              size="sm"
              checked={enabled}
              aria-label={`${enabled ? "Disable" : "Enable"} ${tool.name}`}
              disabled={saving !== null}
              onCheckedChange={(checked) => void toggle(tool.name, checked)}
            />
          </li>
        );
      })}
    </ul>
  );
}

function ConnectorRow({
  connector,
  onChange,
  onRemove,
}: {
  connector: Connector;
  onChange: (connector: Connector) => void;
  onRemove: (id: string) => void;
}) {
  const { client, platform } = useAdmin();
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    try {
      await action();
    } catch (cause) {
      toast.error(errorText(cause, `${label} failed`));
    } finally {
      setBusy(null);
    }
  };

  const patch = (body: Partial<Pick<Connector, "enabled" | "approval">>) =>
    run("Update", async () => {
      const detail = await client.patch<ConnectorDetail>(
        `connectors/${connector.id}`,
        body,
      );
      onChange(detail.connector);
    });

  const refresh = () =>
    run("Refresh", async () => {
      const detail = await client.post<ConnectorDetail>(
        `connectors/${connector.id}/refresh`,
      );
      onChange(detail.connector);
    });

  const authorize = () =>
    run("Authorize", async () => {
      const result = await client.post<ConnectorAuthorizeResponse>(
        `connectors/${connector.id}/authorize`,
      );
      if (result.status === "redirect") {
        await platform.openExternal(result.authorizationUrl);
        return;
      }
      const detail = await client.post<ConnectorDetail>(
        `connectors/${connector.id}/refresh`,
      );
      onChange(detail.connector);
    });

  const disconnect = () =>
    run("Disconnect", async () => {
      const result = await client.del<{ connector: Connector }>(
        `connectors/${connector.id}/authorize`,
      );
      onChange(result.connector);
    });

  const remove = () => {
    if (!window.confirm(`Delete ${connector.name}?`)) return;
    void run("Delete", async () => {
      await client.del(`connectors/${connector.id}`);
      onRemove(connector.id);
    });
  };

  const checked = relativeTime(connector.lastCheckedAt);

  return (
    <li className="space-y-2 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <StatusDot
          tone={connector.enabled ? STATUS_TONE[connector.status] : "muted"}
          label={STATUS_LABEL[connector.status]}
          className="mt-1.5"
        />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-medium">
              {connector.name}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              {connector.slug}
            </span>
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {connector.url}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground tabular-nums">
            <span
              className={cn(connector.status === "error" && "text-destructive")}
            >
              {connector.statusDetail ?? STATUS_LABEL[connector.status]}
            </span>
            <span>·</span>
            <span>
              {connector.toolCount}{" "}
              {connector.toolCount === 1 ? "tool" : "tools"}
            </span>
            {checked ? (
              <>
                <span>·</span>
                <span>checked {checked}</span>
              </>
            ) : null}
          </p>
        </div>
        {busy ? <Spinner className="mt-1 size-3.5" /> : null}
        <Switch
          checked={connector.enabled}
          aria-label={`${connector.enabled ? "Disable" : "Enable"} ${connector.name}`}
          disabled={busy !== null}
          onCheckedChange={(enabled) => void patch({ enabled })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-5">
        <Select
          value={connector.approval}
          onValueChange={(value) => {
            const approval = connectorApprovalSchema.safeParse(value);
            if (approval.success) void patch({ approval: approval.data });
          }}
          disabled={busy !== null}
        >
          <SelectTrigger
            size="sm"
            className="h-7 w-auto gap-1.5 text-xs shadow-none"
            aria-label="Approval"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {connectorApprovalSchema.options.map((approval) => (
              <SelectItem key={approval} value={approval} className="text-xs">
                {APPROVAL_LABEL[approval]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          className="h-7 px-2 text-xs"
          disabled={busy !== null}
          onClick={() => void refresh()}
        >
          Refresh
        </Button>
        {connector.auth === "oauth" ? (
          <>
            <Button
              variant="ghost"
              className="h-7 px-2 text-xs"
              disabled={busy !== null}
              onClick={() => void authorize()}
            >
              Authorize
            </Button>
            {connector.hasSecret ? (
              <Button
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={busy !== null}
                onClick={() => void disconnect()}
              >
                Disconnect
              </Button>
            ) : null}
          </>
        ) : null}
        {connector.builtIn ? null : (
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            disabled={busy !== null}
            onClick={remove}
          >
            Delete
          </Button>
        )}
        <Button
          variant="ghost"
          className="ml-auto h-7 gap-1 px-2 text-xs text-muted-foreground"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          Tools
          <ChevronRight
            className={cn(
              "size-3 transition-transform",
              expanded && "rotate-90",
            )}
          />
        </Button>
      </div>
      {expanded ? (
        <div className="ml-5 border-l pl-3">
          <ConnectorTools connector={connector} onChange={onChange} />
        </div>
      ) : null}
    </li>
  );
}

const AUTH_OPTIONS: Array<{
  value: Exclude<ConnectorAuth, "service">;
  label: string;
}> = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer token" },
  { value: "oauth", label: "OAuth" },
];

function AddConnectorForm({
  onCreated,
  onCancel,
}: {
  onCreated: (connector: Connector) => void;
  onCancel: () => void;
}) {
  const { client } = useAdmin();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<Exclude<ConnectorAuth, "service">>("none");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  const slugValid = connectorSlugSchema.safeParse(slug).success;
  const urlValid = URL.canParse(url);
  const ready =
    slugValid &&
    name.trim().length > 0 &&
    urlValid &&
    (auth !== "bearer" || token.trim().length > 0);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    setSaving(true);
    const base = { slug, name: name.trim(), url: url.trim() };
    try {
      const { connector } = await client.post<{ connector: Connector }>(
        "connectors",
        auth === "bearer"
          ? { ...base, auth, token: token.trim() }
          : { ...base, auth },
      );
      onCreated(connector);
    } catch (cause) {
      toast.error(errorText(cause, "Failed to add connector"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 border-y py-4 sm:grid-cols-2"
      aria-label="Add connector"
    >
      <div className="space-y-1.5">
        <Label htmlFor="connector-slug" className="text-xs">
          Slug
        </Label>
        <Input
          id="connector-slug"
          value={slug}
          onChange={(event) => setSlug(event.target.value.toLowerCase())}
          aria-invalid={slug.length > 0 && !slugValid}
          className="h-8 font-mono text-xs"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="connector-name" className="text-xs">
          Name
        </Label>
        <Input
          id="connector-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-8 text-xs"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="connector-url" className="text-xs">
          URL
        </Label>
        <Input
          id="connector-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          aria-invalid={url.length > 0 && !urlValid}
          placeholder="https://"
          className="h-8 font-mono text-xs"
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <span className="text-xs font-medium">Auth</span>
        <RadioGroup
          value={auth}
          onValueChange={(value) => {
            const option = AUTH_OPTIONS.find((entry) => entry.value === value);
            if (option) setAuth(option.value);
          }}
          className="flex flex-wrap gap-4"
        >
          {AUTH_OPTIONS.map((option) => (
            <Label
              key={option.value}
              className="gap-1.5 text-xs font-normal"
              htmlFor={`connector-auth-${option.value}`}
            >
              <RadioGroupItem
                id={`connector-auth-${option.value}`}
                value={option.value}
              />
              {option.label}
            </Label>
          ))}
        </RadioGroup>
      </div>
      {auth === "bearer" ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="connector-token" className="text-xs">
            Token
          </Label>
          <Input
            id="connector-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="h-8 font-mono text-xs"
            autoComplete="off"
          />
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 sm:col-span-2">
        <Button
          type="button"
          variant="ghost"
          className="h-8 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          className="h-8 text-xs"
          disabled={!ready || saving}
        >
          {saving ? <Spinner className="size-3.5" /> : null}
          Add
        </Button>
      </div>
    </form>
  );
}

function useOAuthReturnNotice() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("connector");
    if (!value) return;
    const [kind, ...rest] = value.split(":");
    const detail = rest.join(":");
    if (kind === "authorized") toast.success(`Authorized ${detail}`);
    else if (kind === "denied") toast.error(`Authorization denied: ${detail}`);
    else if (kind === "failed") toast.error(`Authorization failed: ${detail}`);
    else toast.error("Authorization failed");
    params.delete("connector");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  }, []);
}

export function ConnectorsSection() {
  const { connectors, loading, error, refresh, replace, drop } = useConnectors({
    refreshOnFocus: true,
  });
  const [adding, setAdding] = useState(false);
  useOAuthReturnNotice();

  return (
    <SettingsGroup
      label="Connectors"
      actions={
        adding ? null : (
          <Button
            variant="outline"
            className="h-7 px-2.5 text-xs shadow-none"
            onClick={() => setAdding(true)}
          >
            Add
          </Button>
        )
      }
    >
      {adding ? (
        <AddConnectorForm
          onCancel={() => setAdding(false)}
          onCreated={(connector) => {
            replace(connector);
            setAdding(false);
          }}
        />
      ) : null}
      {loading ? (
        <div className="space-y-3">
          {[70, 55].map((width) => (
            <Skeleton
              key={width}
              className="h-4"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-xs text-destructive">
          {error}
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => void refresh()}
          >
            Retry
          </Button>
        </div>
      ) : (connectors ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="divide-y">
          {(connectors ?? []).map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              onChange={replace}
              onRemove={drop}
            />
          ))}
        </ul>
      )}
    </SettingsGroup>
  );
}
