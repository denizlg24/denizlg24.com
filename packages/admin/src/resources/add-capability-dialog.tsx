"use client";

import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { useState } from "react";

const CAPABILITY_TYPES = [{ value: "picron", label: "PiCron" }];

export function AddCapabilityDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    type: string;
    label: string;
    baseUrl: string;
    config: Record<string, unknown>;
  }) => Promise<void>;
}) {
  const [type, setType] = useState("picron");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const needsCredentials = type === "picron";
  const ready =
    label.trim() !== "" &&
    baseUrl.trim() !== "" &&
    (!needsCredentials || (username.trim() !== "" && password.trim() !== ""));

  const resetForm = () => {
    setType("picron");
    setLabel("");
    setBaseUrl("");
    setUsername("");
    setPassword("");
  };

  const handleSubmit = async () => {
    if (!ready) return;
    setSubmitting(true);
    try {
      const config: Record<string, unknown> = {};
      if (needsCredentials) {
        config.username = username;
        config.password = password;
      }
      await onSubmit({
        type,
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        config,
      });
      resetForm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
      title="Add capability"
      onSubmit={handleSubmit}
      submitLabel="Add"
      submitDisabled={!ready}
      pending={submitting}
    >
      <FormGrid>
        <FormField label="Type">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CAPABILITY_TYPES.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField label="Label" htmlFor="cap-label">
          <Input
            id="cap-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Cron scheduler"
            autoFocus
          />
        </FormField>
        <FormField
          label="Base URL"
          htmlFor="cap-base-url"
          className="sm:col-span-2"
        >
          <Input
            id="cap-base-url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="http://raspberrypi.local:8080"
            className="font-mono"
          />
        </FormField>
        {needsCredentials && (
          <>
            <FormField label="Username" htmlFor="cap-user">
              <Input
                id="cap-user"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="off"
                className="font-mono"
              />
            </FormField>
            <FormField label="Password" htmlFor="cap-pass">
              <Input
                id="cap-pass"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="off"
                className="font-mono"
              />
            </FormField>
          </>
        )}
      </FormGrid>
    </FormDialog>
  );
}
