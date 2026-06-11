"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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

interface AddCapabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  resourceId: string;
}

export function AddCapabilityDialog({
  open,
  onOpenChange,
  onSuccess,
  resourceId,
}: AddCapabilityDialogProps) {
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState("picron");
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (open) {
      setType("picron");
      setLabel("");
      setBaseUrl("");
      setUsername("");
      setPassword("");
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!label.trim()) {
      toast.error("Label is required.");
      return;
    }

    if (!baseUrl.trim()) {
      toast.error("Base URL is required.");
      return;
    }

    if (type === "picron" && (!username.trim() || !password.trim())) {
      toast.error("Username and password are required for PiCron.");
      return;
    }

    const payload: Record<string, unknown> = { type, label, baseUrl };

    if (type === "picron") {
      payload.username = username;
      payload.password = password;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/resources/${resourceId}/capabilities`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to add capability");
      }

      toast.success("Capability added");
      onOpenChange(false);
      onSuccess();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add capability",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Add Capability</DialogTitle>
        <DialogDescription>
          Add a new capability to this resource.
        </DialogDescription>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="picron">PiCron Scheduler</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input
              placeholder="Cron Scheduler"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input
              placeholder="http://raspberrypi.local:8080"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              The base URL for this capability&apos;s API.
            </p>
          </div>

          {type === "picron" && (
            <>
              <div className="space-y-1.5">
                <Label>Username</Label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              "Add Capability"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
