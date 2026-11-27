"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AccessToken, TokenScope } from "@/lib/mcp/tokens";

const stamp = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

async function send(path: string, init: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : "Something went wrong. Try again.";
    throw new Error(message);
  }
  return data;
}

function readSecret(data: unknown) {
  return data &&
    typeof data === "object" &&
    "secret" in data &&
    typeof data.secret === "string"
    ? data.secret
    : null;
}

export function AccessTokens({
  tokens,
  endpoint,
}: {
  tokens: AccessToken[];
  endpoint: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<TokenScope>("read");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const data = await send("/api/account/tokens", {
        method: "POST",
        body: JSON.stringify({ name, scope }),
      });
      setSecret(readSecret(data));
      setCopied(false);
      setName("");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(false);
    }
  }

  async function revoke(id: string) {
    setError("");
    try {
      await send(`/api/account/tokens/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const command = secret
    ? `claude mcp add --transport http stockwatcher ${endpoint} --header "Authorization: Bearer ${secret}"`
    : "";

  return (
    <div className="access-tokens">
      {secret ? (
        <div className="account-notice" role="status">
          <p>
            <strong>Copy this token now.</strong> It is shown once. Add it to
            your agent as a Bearer token, or run:
          </p>
          <pre className="access-token-command">{command}</pre>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void navigator.clipboard.writeText(command).then(
                () => setCopied(true),
                () => setCopied(false),
              )
            }
          >
            {copied ? "Copied" : "Copy command"}
          </Button>
        </div>
      ) : null}

      <form className="access-token-form" onSubmit={create}>
        <label>
          <span>Name</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Claude Code on my laptop"
            maxLength={60}
            required
          />
        </label>
        <label>
          <span>Access</span>
          <select
            value={scope}
            onChange={(event) =>
              setScope(event.target.value === "write" ? "write" : "read")
            }
          >
            <option value="read">Read market data and my workspace</option>
            <option value="write">
              Also change watchlists, alerts, notes and portfolios
            </option>
          </select>
        </label>
        <Button type="submit" disabled={working || !name.trim()}>
          {working ? "Creating…" : "Create token"}
        </Button>
      </form>
      {error ? (
        <p className="billing-error" role="alert">
          {error}
        </p>
      ) : null}

      {tokens.length ? (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Access</th>
                <th>Token</th>
                <th>Created</th>
                <th>Last used</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id}>
                  <td>{token.name}</td>
                  <td>{token.scope === "write" ? "Read and write" : "Read"}</td>
                  <td>
                    <code>{token.prefix}…</code>
                  </td>
                  <td>{stamp.format(new Date(token.createdAt))}</td>
                  <td>
                    {token.lastUsedAt
                      ? stamp.format(new Date(token.lastUsedAt))
                      : "Never"}
                  </td>
                  <td className="num">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void revoke(token.id)}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty">
          <strong>No tokens.</strong> Create one to let Claude Code, Cursor or
          another MCP client use Stockwatcher.
        </p>
      )}
    </div>
  );
}
