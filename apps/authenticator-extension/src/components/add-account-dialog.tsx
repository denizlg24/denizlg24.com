import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Textarea } from "@repo/ui/textarea";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { EntryEdit, NewAccountInput } from "../lib/entries";
import { parseOtpAuthUri, splitUriList } from "../lib/otpauth-uri";
import type { TotpAlgorithm, VaultEntry } from "../lib/types";

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (inputs: NewAccountInput[]) => Promise<void>;
}

const ALGORITHMS: TotpAlgorithm[] = ["SHA1", "SHA256", "SHA512"];

export function AddAccountDialog({
  open,
  onOpenChange,
  onAdd,
}: AddAccountDialogProps) {
  const [label, setLabel] = useState("");
  const [issuer, setIssuer] = useState("");
  const [accountName, setAccountName] = useState("");
  const [secret, setSecret] = useState("");
  const [algorithm, setAlgorithm] = useState<TotpAlgorithm>("SHA1");
  const [digits, setDigits] = useState("6");
  const [period, setPeriod] = useState("30");
  const [uris, setUris] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setLabel("");
    setIssuer("");
    setAccountName("");
    setSecret("");
    setAlgorithm("SHA1");
    setDigits("6");
    setPeriod("30");
    setUris("");
    setError(null);
  };

  const submit = async (build: () => NewAccountInput[]) => {
    setError(null);
    let inputs: NewAccountInput[];
    try {
      inputs = build();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invalid input");
      return;
    }

    setSaving(true);
    try {
      await onAdd(inputs);
      reset();
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-[340px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Add account</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="manual">
          <TabsList variant="line" className="w-full">
            <TabsTrigger value="manual" className="text-xs">
              Manual
            </TabsTrigger>
            <TabsTrigger value="uri" className="text-xs">
              otpauth://
            </TabsTrigger>
          </TabsList>

          <TabsContent value="manual" className="space-y-2.5 pt-3">
            <div className="space-y-1">
              <Label htmlFor="label" className="text-xs">
                Label
              </Label>
              <Input
                id="label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                className="h-8 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="issuer" className="text-xs">
                  Issuer
                </Label>
                <Input
                  id="issuer"
                  value={issuer}
                  onChange={(event) => setIssuer(event.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="account" className="text-xs">
                  Account
                </Label>
                <Input
                  id="account"
                  value={accountName}
                  onChange={(event) => setAccountName(event.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="secret" className="text-xs">
                Secret
              </Label>
              <Input
                id="secret"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                className="h-8 text-sm font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label htmlFor="algorithm" className="text-xs">
                  Algorithm
                </Label>
                <Select
                  value={algorithm}
                  onValueChange={(value) =>
                    setAlgorithm(value as TotpAlgorithm)
                  }
                >
                  <SelectTrigger id="algorithm" className="h-8! text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALGORITHMS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="digits" className="text-xs">
                  Digits
                </Label>
                <Input
                  id="digits"
                  type="number"
                  min={6}
                  max={10}
                  value={digits}
                  onChange={(event) => setDigits(event.target.value)}
                  className="h-8 text-sm tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="period" className="text-xs">
                  Period
                </Label>
                <Input
                  id="period"
                  type="number"
                  min={10}
                  max={120}
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                  className="h-8 text-sm tabular-nums"
                />
              </div>
            </div>

            <DialogFooter className="pt-1">
              <Button
                size="sm"
                disabled={saving || !label.trim() || !secret.trim()}
                onClick={() =>
                  submit(() => [
                    {
                      label: label.trim(),
                      issuer: issuer.trim(),
                      accountName: accountName.trim(),
                      secret: secret.trim(),
                      algorithm,
                      digits: Number(digits) || 6,
                      period: Number(period) || 30,
                    },
                  ])
                }
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                Add
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="uri" className="space-y-2.5 pt-3">
            <Textarea
              value={uris}
              onChange={(event) => setUris(event.target.value)}
              placeholder="otpauth://totp/..."
              className="h-28 text-xs font-mono resize-none"
              spellCheck={false}
            />
            <DialogFooter>
              <Button
                size="sm"
                disabled={saving || uris.trim().length === 0}
                onClick={() =>
                  submit(() => splitUriList(uris).map(parseOtpAuthUri))
                }
              >
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                Import
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>

        {error && <p className="text-xs text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}

interface EditAccountDialogProps {
  entry: VaultEntry | null;
  onOpenChange: (open: boolean) => void;
  onSave: (edit: EntryEdit) => Promise<void>;
}

/** The server only accepts label changes on update, so the secret is read-only here. */
export function EditAccountDialog({
  entry,
  onOpenChange,
  onSave,
}: EditAccountDialogProps) {
  const [label, setLabel] = useState(entry?.label ?? "");
  const [issuer, setIssuer] = useState(entry?.issuer ?? "");
  const [accountName, setAccountName] = useState(entry?.accountName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[340px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Edit account</DialogTitle>
        </DialogHeader>

        <div className="space-y-2.5">
          <div className="space-y-1">
            <Label htmlFor="edit-label" className="text-xs">
              Label
            </Label>
            <Input
              id="edit-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="edit-issuer" className="text-xs">
                Issuer
              </Label>
              <Input
                id="edit-issuer"
                value={issuer}
                onChange={(event) => setIssuer(event.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-account" className="text-xs">
                Account
              </Label>
              <Input
                id="edit-account"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={saving || !label.trim()}
            onClick={async () => {
              setSaving(true);
              setError(null);
              try {
                await onSave({
                  label: label.trim(),
                  issuer: issuer.trim(),
                  accountName: accountName.trim(),
                });
                onOpenChange(false);
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "Failed to save",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
