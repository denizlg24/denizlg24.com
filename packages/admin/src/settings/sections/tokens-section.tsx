"use client";

import type {
  ApiKeyListResponse,
  ApiKeySecretResponse,
  IApiKeySummary,
  InstagramTokenStatus,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../../provider";
import { SettingsGroup, SettingsRow } from "../settings-shell";

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The minted secret is returned exactly once. It stays pinned above the list
 * until dismissed so a copy failure is recoverable without re-rotating.
 */
function SecretReveal({
  secret,
  onDismiss,
}: {
  secret: string;
  onDismiss: () => void;
}) {
  const { platform } = useAdmin();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await platform.copyText(secret);
      setCopied(true);
    } catch {
      toast.error("Copy failed");
    }
  };

  return (
    <div className="flex items-center gap-2 border-l-2 border-status-warning py-1 pl-3">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-status-warning">
          Shown once
        </div>
        <code className="mt-0.5 block select-all truncate font-mono text-xs text-accent-strong">
          {secret}
        </code>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Copy key"
        onClick={() => void copy()}
      >
        {copied ? <Check className="text-status-good" /> : <Copy />}
      </Button>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Done
      </Button>
    </div>
  );
}

function ApiKeyRow({
  apiKey,
  onRotate,
  onDelete,
}: {
  apiKey: IApiKeySummary;
  onRotate: (id: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <ListRow
      leading={<KeyRound />}
      title={<span className="font-mono">{apiKey.name}</span>}
      meta={formatDate(apiKey.createdAt)}
      trailing={
        <>
          <ConfirmButton
            title={`Rotate ${apiKey.name}?`}
            description="The current key stops working."
            actionLabel="Rotate"
            onConfirm={async () => {
              setBusy(true);
              try {
                await onRotate(apiKey.id);
              } finally {
                setBusy(false);
              }
            }}
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={`Rotate ${apiKey.name}`}
                className="text-muted-foreground"
              >
                {busy ? <Spinner className="size-3.5" /> : <RefreshCw />}
              </Button>
            }
          />
          <ConfirmButton
            title={`Delete ${apiKey.name}?`}
            description="Anything signing with it stops working."
            actionLabel="Delete"
            destructive
            onConfirm={() => onDelete(apiKey.id)}
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${apiKey.name}`}
                className="text-muted-foreground"
              >
                <Trash2 />
              </Button>
            }
          />
        </>
      }
    />
  );
}

function ApiKeysGroup() {
  const { client } = useAdmin();
  const [keys, setKeys] = useState<IApiKeySummary[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await client.get<ApiKeyListResponse>("api-keys");
      setKeys(data.apiKeys);
    } catch {
      toast.error("Failed to load API keys");
      setKeys([]);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const data = await client.post<ApiKeySecretResponse>("api-keys", {
        name: trimmed,
      });
      setSecret(data.apiKey);
      setName("");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Create failed");
    } finally {
      setCreating(false);
    }
  };

  const rotate = async (id: string) => {
    try {
      const data = await client.put<ApiKeySecretResponse>(`api-keys/${id}`);
      setSecret(data.apiKey);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rotate failed");
    }
  };

  const remove = async (id: string) => {
    try {
      await client.del(`api-keys/${id}`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    }
  };

  return (
    <SettingsGroup
      label="API keys"
      actions={
        keys && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {keys.length}
          </span>
        )
      }
    >
      {secret && (
        <SecretReveal secret={secret} onDismiss={() => setSecret(null)} />
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <Input
          value={name}
          placeholder="Key name"
          aria-label="New key name"
          className="min-w-0 flex-1"
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          type="submit"
          variant="outline"
          disabled={creating || !name.trim()}
        >
          {creating ? <Spinner className="size-3.5" /> : <Plus />}
          Create
        </Button>
      </form>

      {keys === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : keys.length === 0 ? (
        <EmptyState compact icon={<KeyRound />} label="No keys" />
      ) : (
        <List divided>
          {keys.map((apiKey) => (
            <ApiKeyRow
              key={apiKey.id}
              apiKey={apiKey}
              onRotate={rotate}
              onDelete={remove}
            />
          ))}
        </List>
      )}
    </SettingsGroup>
  );
}

function InstagramGroup() {
  const { client, platform } = useAdmin();
  const [status, setStatus] = useState<InstagramTokenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setStatus(await client.get<InstagramTokenStatus>("instagram-token"));
    } catch {
      toast.error("Failed to load Instagram token");
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async () => {
    try {
      await client.del("instagram-token");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    }
  };

  const days = status?.token
    ? Math.floor(
        (new Date(status.token.expiresAt).getTime() - Date.now()) / 86_400_000,
      )
    : null;
  const authorizeUrl = status?.authorizeUrl ?? null;

  return (
    <SettingsGroup label="Instagram">
      {loading ? (
        <Skeleton className="h-9 w-full" />
      ) : failed ? (
        <EmptyState
          compact
          label="Load failed"
          action={
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RotateCcw /> Retry
            </Button>
          }
        />
      ) : (
        <SettingsRow
          label="Token"
          hint={status?.token ? formatDate(status.token.expiresAt) : undefined}
        >
          <div className="flex items-center gap-2">
            {status?.token ? (
              <Badge
                variant={
                  days === null || days < 0
                    ? "critical"
                    : days <= 7
                      ? "warning"
                      : "secondary"
                }
              >
                {days !== null && days < 0 ? "Expired" : `${days}d left`}
              </Badge>
            ) : (
              <span className="text-sm text-muted-foreground">Not linked</span>
            )}
            {authorizeUrl ? (
              <Button
                variant="outline"
                onClick={() => void platform.openExternal(authorizeUrl)}
              >
                <ExternalLink />
                {status?.token ? "Relink" : "Link"}
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">
                Linking unavailable
              </span>
            )}
            {status?.token && (
              <ConfirmButton
                title="Delete Instagram token?"
                description="The public feed stops updating."
                actionLabel="Delete"
                destructive
                onConfirm={remove}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete Instagram token"
                    className="text-muted-foreground"
                  >
                    <Trash2 />
                  </Button>
                }
              />
            )}
          </div>
        </SettingsRow>
      )}
    </SettingsGroup>
  );
}

export function TokensSection() {
  return (
    <>
      <ApiKeysGroup />
      <InstagramGroup />
    </>
  );
}
