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
import { Input } from "@repo/ui/input";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../../provider";
import { SettingsGroup } from "../settings-shell";

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
      toast.error("Clipboard unavailable — select the value manually");
    }
  };

  return (
    <div className="flex items-center gap-2 border-l-2 border-status-warning bg-status-warning/5 py-2 pl-3 pr-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Shown once
        </div>
        <code className="mt-0.5 block truncate font-mono text-xs">
          {secret}
        </code>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Copy key"
        className="size-7 shrink-0"
        onClick={() => void copy()}
      >
        {copied ? (
          <Check className="size-3.5 text-status-good" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 text-xs"
        onClick={onDismiss}
      >
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
    <div className="group flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs">{apiKey.name}</div>
        <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
          {formatDate(apiKey.createdAt)}
        </div>
      </div>

      <ConfirmButton
        title={`Rotate ${apiKey.name}?`}
        description="The current key stops working immediately. The replacement is shown once."
        actionLabel="Rotate"
        onConfirm={async () => {
          setBusy(true);
          await onRotate(apiKey.id);
          setBusy(false);
        }}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            aria-label={`Rotate ${apiKey.name}`}
            className="size-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </Button>
        }
      />

      <ConfirmButton
        title={`Delete ${apiKey.name}?`}
        description="Anything signing with this key stops working immediately."
        actionLabel="Delete"
        onConfirm={() => onDelete(apiKey.id)}
        trigger={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${apiKey.name}`}
            className="size-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" />
          </Button>
        }
      />
    </div>
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
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {keys.length}
          </span>
        )
      }
    >
      <div className="space-y-3">
        {secret && (
          <SecretReveal secret={secret} onDismiss={() => setSecret(null)} />
        )}

        <div className="flex items-center gap-2">
          <Input
            value={name}
            placeholder="New key name"
            className="h-8 min-w-0 flex-1 text-xs"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void create();
            }}
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Create API key"
            className="size-8 shrink-0"
            disabled={creating || !name.trim()}
            onClick={() => void create()}
          >
            {creating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
          </Button>
        </div>

        {keys === null ? (
          <div className="space-y-2 pt-1">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : keys.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">—</p>
        ) : (
          <div className="divide-y">
            {keys.map((apiKey) => (
              <ApiKeyRow
                key={apiKey.id}
                apiKey={apiKey}
                onRotate={rotate}
                onDelete={remove}
              />
            ))}
          </div>
        )}
      </div>
    </SettingsGroup>
  );
}

function InstagramGroup() {
  const { client, platform } = useAdmin();
  const [status, setStatus] = useState<InstagramTokenStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setStatus(await client.get<InstagramTokenStatus>("instagram-token"));
    } catch {
      toast.error("Failed to load Instagram token");
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
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {status?.token ? (
            <>
              <Badge
                variant={
                  days === null || days < 0
                    ? "destructive"
                    : days <= 7
                      ? "outline"
                      : "secondary"
                }
                className={cn(
                  "shrink-0 tabular-nums",
                  days !== null &&
                    days >= 0 &&
                    days <= 7 &&
                    "border-status-warning text-status-warning",
                )}
              >
                {days !== null && days < 0 ? "Expired" : `Expires in ${days}d`}
              </Badge>
              <span className="min-w-0 flex-1 truncate text-[11px] tabular-nums text-muted-foreground">
                {formatDate(status.token.expiresAt)}
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1 text-xs text-muted-foreground">
              Not linked
            </span>
          )}

          {authorizeUrl && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5 text-xs"
              onClick={() => void platform.openExternal(authorizeUrl)}
            >
              <ExternalLink className="size-3.5" />
              {status?.token ? "Relink" : "Link"}
            </Button>
          )}

          {status?.token && (
            <ConfirmButton
              title="Delete Instagram token?"
              description="The public feed stops updating until a new token is linked."
              actionLabel="Delete"
              onConfirm={remove}
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete Instagram token"
                  className="size-8 shrink-0"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              }
            />
          )}
        </div>
      )}
      {!loading && !authorizeUrl && (
        <p className="text-[11px] text-muted-foreground">
          INSTAGRAM_APP_ID / INSTAGRAM_REDIRECT_URI unset on the server.
        </p>
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
