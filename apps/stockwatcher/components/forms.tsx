"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Failure } from "./shared";

export type Save = (
  update: (
    workspace: import("@/lib/models").Workspace,
  ) => import("@/lib/models").Workspace,
) => Promise<void>;

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function FormDialog({
  title,
  description,
  children,
  close,
  submit,
  label = "Save",
  danger,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  close: () => void;
  submit: (fields: FormData) => Promise<void>;
  label?: string;
  danger?: boolean;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<Error>();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setWorking(true);
    setError(undefined);
    try {
      await submit(values);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Unable to save."));
    } finally {
      setWorking(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !working) close();
      }}
    >
      <DialogContent showCloseButton={!working}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="form-stack">
          {children}
          <Failure error={error} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={danger ? "destructive" : "default"}
              disabled={working}
            >
              {working ? "Saving…" : label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoveDialog({
  item,
  close,
  remove,
}: {
  item: string;
  close: () => void;
  remove: () => Promise<void>;
}) {
  return (
    <FormDialog
      title={`Delete ${item}?`}
      description="This removes it from your workspace."
      label="Delete"
      danger
      close={close}
      submit={remove}
    />
  );
}

export const value = (fields: FormData, key: string) =>
  String(fields.get(key) ?? "").trim();
