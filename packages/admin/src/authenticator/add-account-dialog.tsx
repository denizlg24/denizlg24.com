"use client";

import type { IAuthenticatorAccount, TotpAlgorithm } from "@repo/schemas";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { useEffect, useState } from "react";

const ALGORITHMS: { value: TotpAlgorithm; label: string }[] = [
  { value: "SHA1", label: "SHA-1" },
  { value: "SHA256", label: "SHA-256" },
  { value: "SHA512", label: "SHA-512" },
];

function isAlgorithm(value: string): value is TotpAlgorithm {
  return ALGORITHMS.some((option) => option.value === value);
}

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

  useEffect(() => {
    if (!open) return;
    setLabel(editing?.label ?? "");
    setIssuer(editing?.issuer ?? "");
    setAccountName(editing?.accountName ?? "");
    setSecret("");
    setAlgorithm(editing?.algorithm ?? "SHA1");
    setDigits(editing?.digits ?? 6);
    setPeriod(editing?.period ?? 30);
  }, [open, editing]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit({
        label: label.trim(),
        issuer: issuer.trim(),
        accountName: accountName.trim(),
        secret: isEditing ? undefined : secret,
        algorithm,
        digits,
        period,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = isEditing
    ? label.trim().length > 0
    : label.trim().length > 0 &&
      /^[A-Z2-7]+=*$/.test(secret) &&
      Number.isInteger(period) &&
      period > 0;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Edit account" : "Add account"}
      onSubmit={handleSubmit}
      submitLabel={isEditing ? "Save" : "Add"}
      submitDisabled={!canSubmit}
      pending={submitting}
    >
      <FormGrid>
        <FormField label="Label" htmlFor="totp-label">
          <Input
            id="totp-label"
            placeholder="GitHub"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField label="Issuer" htmlFor="totp-issuer">
          <Input
            id="totp-issuer"
            placeholder="GitHub"
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
          />
        </FormField>
        <FormField
          label="Account"
          htmlFor="totp-account"
          className="sm:col-span-2"
        >
          <Input
            id="totp-account"
            placeholder="user@example.com"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
          />
        </FormField>
        {!isEditing && (
          <FormField
            label="Secret (base32)"
            htmlFor="totp-secret"
            className="sm:col-span-2"
          >
            <Input
              id="totp-secret"
              placeholder="JBSWY3DPEHPK3PXP"
              value={secret}
              onChange={(e) =>
                setSecret(e.target.value.toUpperCase().replace(/[\s-]/g, ""))
              }
              autoComplete="off"
              spellCheck={false}
              className="font-mono tracking-wider"
            />
          </FormField>
        )}
        <FormField label="Algorithm">
          <Select
            value={algorithm}
            onValueChange={(value) => {
              if (isAlgorithm(value)) setAlgorithm(value);
            }}
            disabled={isEditing}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALGORITHMS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Digits">
            <Select
              value={String(digits)}
              onValueChange={(value) => setDigits(Number(value))}
              disabled={isEditing}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6</SelectItem>
                <SelectItem value="8">8</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Period (s)" htmlFor="totp-period">
            <Input
              id="totp-period"
              type="number"
              min={1}
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
              disabled={isEditing}
              className="font-mono"
            />
          </FormField>
        </div>
      </FormGrid>
    </FormDialog>
  );
}
