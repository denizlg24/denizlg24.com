import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { KeyRound, Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";

interface UnlockScreenProps {
  onUnlock: (passphrase: string) => Promise<void>;
  compact?: boolean;
}

export function UnlockScreen({ onUnlock, compact = false }: UnlockScreenProps) {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onUnlock(passphrase);
      setPassphrase("");
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === "WrongPassphraseError"
          ? "Wrong passphrase"
          : "Could not unlock",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className={`flex flex-col items-center justify-center gap-3 ${
        compact ? "px-6 py-10" : "px-6 py-16"
      }`}
    >
      <KeyRound className="size-6 text-muted-foreground/40" />
      <Input
        autoFocus
        type="password"
        value={passphrase}
        onChange={(event) => setPassphrase(event.target.value)}
        placeholder="Passphrase"
        aria-label="Passphrase"
        className="h-8 text-sm text-center max-w-[220px]"
        autoComplete="current-password"
      />
      <Button
        type="submit"
        size="sm"
        disabled={busy || passphrase.length === 0}
        className="w-[220px]"
      >
        {busy && <Loader2 className="size-3.5 animate-spin" />}
        Unlock
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}
