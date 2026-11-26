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

export function PromptDialog({
  title,
  description,
  label,
  initial = "",
  placeholder,
  maxLength = 120,
  confirmLabel = "Save",
  onSubmit,
  onClose,
}: {
  title: string;
  description?: string;
  label: string;
  initial?: string;
  placeholder?: string;
  maxLength?: number;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="prompt-dialog">
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmed) return;
            onSubmit(trimmed.slice(0, maxLength));
            onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <label className="field">
            <span>{label}</span>
            <Input
              autoFocus
              value={value}
              maxLength={maxLength}
              placeholder={placeholder}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="prompt-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} autoFocus>
            Cancel
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
