"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { IAuthenticatorAccount, TotpAlgorithm } from "../types";

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    label: string;
    issuer: string;
    accountName: string;
    secret?: string;
    algorithm: TotpAlgorithm;
    digits: number;
    period: number;
  }) => Promise<void>;
  editing?: IAuthenticatorAccount | null;
}

export function AddAccountDialog({
  open,
  onOpenChange,
  onSubmit,
  editing,
}: AddAccountDialogProps) {
  const [label, setLabel] = useState(editing?.label ?? "");
  const [issuer, setIssuer] = useState(editing?.issuer ?? "");
  const [accountName, setAccountName] = useState(editing?.accountName ?? "");
  const [secret, setSecret] = useState("");
  const [algorithm, setAlgorithm] = useState<TotpAlgorithm>(
    editing?.algorithm ?? "SHA1",
  );
  const [digits, setDigits] = useState(editing?.digits ?? 6);
  const [period, setPeriod] = useState(editing?.period ?? 30);
  const [submitting, setSubmitting] = useState(false);

  const isEditing = !!editing;

  const handleSubmit = async () => {
    setSubmitting(true);
    await onSubmit({
      label,
      issuer,
      accountName,
      secret: isEditing ? undefined : secret,
      algorithm,
      digits,
      period,
    });
    setSubmitting(false);
  };

  const canSubmit = isEditing
    ? label.trim().length > 0
    : label.trim().length > 0 && secret.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Account" : "Add Account"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the account details."
              : "Enter the TOTP secret and account details."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2 min-w-0">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              placeholder="e.g. GitHub"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issuer">Issuer</Label>
            <Input
              id="issuer"
              placeholder="e.g. GitHub"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="accountName">Account</Label>
            <Input
              id="accountName"
              placeholder="e.g. user@example.com"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
            />
          </div>

          {!isEditing && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="secret">Secret (Base32)</Label>
              <Input
                id="secret"
                placeholder="JBSWY3DPEHPK3PXP"
                value={secret}
                onChange={(e) =>
                  setSecret(e.target.value.toUpperCase().replace(/\s/g, ""))
                }
                className="font-mono tracking-wider overflow-hidden text-ellipsis"
              />
            </div>
          )}

          <div className="flex gap-3">
            <div className="flex flex-col gap-1.5 flex-1">
              <Label>Algorithm</Label>
              <Select
                value={algorithm}
                onValueChange={(v) => setAlgorithm(v as TotpAlgorithm)}
                disabled={isEditing}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SHA1">SHA-1</SelectItem>
                  <SelectItem value="SHA256">SHA-256</SelectItem>
                  <SelectItem value="SHA512">SHA-512</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5 w-20">
              <Label htmlFor="digits">Digits</Label>
              <Select
                value={String(digits)}
                onValueChange={(v) => setDigits(Number(v))}
                disabled={isEditing}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="6">6</SelectItem>
                  <SelectItem value="8">8</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5 w-20">
              <Label htmlFor="period">Period</Label>
              <Input
                id="period"
                type="number"
                value={period}
                onChange={(e) => setPeriod(Number(e.target.value))}
                disabled={isEditing}
                className="font-mono"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !canSubmit}>
            {submitting
              ? isEditing
                ? "Saving..."
                : "Adding..."
              : isEditing
                ? "Save"
                : "Add Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
