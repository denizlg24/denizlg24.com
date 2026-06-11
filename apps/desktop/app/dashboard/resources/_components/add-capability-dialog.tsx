"use client";

import { useState } from "react";
import { toast } from "sonner";
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

const CAPABILITY_TYPES = [{ value: "picron", label: "PiCron (Cron Jobs)" }];

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

  const resetForm = () => {
    setType("picron");
    setLabel("");
    setBaseUrl("");
    setUsername("");
    setPassword("");
  };

  const handleSubmit = async () => {
    if (!label.trim()) return;
    if (!baseUrl.trim()) {
      toast.error("Base URL is required.");
      return;
    }
    if (type === "picron" && (!username.trim() || !password.trim())) {
      toast.error("Username and password are required for PiCron.");
      return;
    }
    setSubmitting(true);
    try {
      const config: Record<string, unknown> = {};
      if (type === "picron") {
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
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) resetForm();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Capability</DialogTitle>
          <DialogDescription>
            Attach a new capability to this resource.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAPABILITY_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cap-label">Label</Label>
            <Input
              id="cap-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Cron Scheduler"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cap-base-url">Base URL</Label>
            <Input
              id="cap-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://raspberrypi.local:8080"
              className="font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground/60">
              The base URL for this capability&apos;s API.
            </p>
          </div>

          {type === "picron" && (
            <div className="border-t pt-3 flex flex-col gap-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
                PiCron Credentials
              </p>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cap-user" className="text-xs">
                  Username
                </Label>
                <Input
                  id="cap-user"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="font-mono text-xs h-8"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cap-pass" className="text-xs">
                  Password
                </Label>
                <Input
                  id="cap-pass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="font-mono text-xs h-8"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !label.trim()}>
            {submitting ? "Adding..." : "Add Capability"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
