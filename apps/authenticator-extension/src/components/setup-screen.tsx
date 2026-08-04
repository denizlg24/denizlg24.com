import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { KeyRound, Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { verifyCredentials } from "../lib/api";
import { hasHostPermission, requestHostPermission } from "../lib/browser";
import { send } from "../lib/messages";
import { DEFAULT_PREFERENCES } from "../lib/types";

interface SetupScreenProps {
  onDone: () => void;
}

/**
 * First-run setup. Lives on the options page rather than the popup because
 * granting a host permission opens a browser prompt, and a popup closes the
 * moment focus leaves it.
 */
export function SetupScreen({ onDone }: SetupScreenProps) {
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_PREFERENCES.apiBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirmation.length > 0 && passphrase !== confirmation;
  const ready =
    apiKey.trim().length > 0 &&
    passphrase.length >= 8 &&
    !mismatch &&
    confirmation.length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const url = apiBaseUrl.trim().replace(/\/$/, "");
      new URL(url);

      if (!(await hasHostPermission(url))) {
        const granted = await requestHostPermission(url);
        if (!granted) {
          setError("Permission to reach that server was declined");
          return;
        }
      }

      await verifyCredentials({ baseUrl: url, apiKey: apiKey.trim() });
      await send({
        type: "setup",
        apiBaseUrl: url,
        apiKey: apiKey.trim(),
        passphrase,
      });

      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="max-w-md mx-auto px-6 py-10 space-y-5">
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold text-accent-strong">Setup</h1>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="api-base-url" className="text-xs">
          API base URL
        </Label>
        <Input
          id="api-base-url"
          value={apiBaseUrl}
          onChange={(event) => setApiBaseUrl(event.target.value)}
          className="h-8 text-sm font-mono"
          spellCheck={false}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="api-key" className="text-xs">
          API key
        </Label>
        <Input
          id="api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          className="h-8 text-sm font-mono"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="passphrase" className="text-xs">
          Vault passphrase
        </Label>
        <Input
          id="passphrase"
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          className="h-8 text-sm"
          autoComplete="new-password"
        />
        <Input
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder="Repeat"
          aria-label="Repeat passphrase"
          className="h-8 text-sm"
          autoComplete="new-password"
        />
        <p className="text-[11px] text-muted-foreground/70">
          Minimum 8 characters. It encrypts the vault and cannot be recovered —
          losing it means re-running setup against the server.
        </p>
      </div>

      {mismatch && (
        <p className="text-xs text-destructive">Passphrases do not match</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button type="submit" size="sm" disabled={busy || !ready}>
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        Connect and pull accounts
      </Button>
    </form>
  );
}
