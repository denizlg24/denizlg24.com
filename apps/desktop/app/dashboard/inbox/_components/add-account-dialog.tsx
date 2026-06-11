"use client";

import { Info, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { denizApi } from "@/lib/api-wrapper";

interface FormData {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  inboxName: string;
}

const IMAP_PRESETS = [
  { label: "Gmail", host: "imap.gmail.com", port: 993, secure: true },
  { label: "Outlook", host: "outlook.office365.com", port: 993, secure: true },
  { label: "Yahoo", host: "imap.mail.yahoo.com", port: 993, secure: true },
  { label: "iCloud", host: "imap.mail.me.com", port: 993, secure: true },
];

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: denizApi;
  onAccountAdded: () => void;
}

export function AddAccountDialog({
  open,
  onOpenChange,
  api,
  onAccountAdded,
}: AddAccountDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      host: "",
      port: 993,
      secure: true,
      user: "",
      password: "",
      inboxName: "INBOX",
    },
  });

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    setError(null);

    const result = await api.POST<{ account: unknown }>({
      endpoint: "email-accounts",
      body: data,
    });

    if ("code" in result) {
      setError(result.message);
    } else {
      toast.success("Account added successfully");
      reset();
      onOpenChange(false);
      onAccountAdded();
    }
    setLoading(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!loading) {
      if (!newOpen) {
        reset();
        setError(null);
      }
      onOpenChange(newOpen);
    }
  };

  const handlePresetSelect = (preset: (typeof IMAP_PRESETS)[0]) => {
    setValue("host", preset.host);
    setValue("port", preset.port);
    setValue("secure", preset.secure);
  };

  const secure = watch("secure");

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto p-0 gap-0">
        <DialogTitle className="sr-only">Add Email Account</DialogTitle>
        <DialogDescription className="sr-only">
          Connect an IMAP email account
        </DialogDescription>

        <div className="px-5 py-4 border-b">
          <h2 className="text-sm font-semibold">Add Email Account</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Connect via IMAP. Make sure IMAP access is enabled in your provider
            settings.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="px-5 py-4 space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Quick Setup</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {IMAP_PRESETS.map((preset) => (
                <Badge
                  key={preset.label}
                  variant="outline"
                  className="cursor-pointer hover:bg-accent text-xs"
                  onClick={() => handlePresetSelect(preset)}
                >
                  {preset.label}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="user" className="text-xs">
              Email Address
            </Label>
            <Input
              id="user"
              type="email"
              placeholder="you@example.com"
              className="h-9 text-sm"
              {...register("user", { required: "Email is required" })}
            />
            {errors.user && (
              <p className="text-xs text-destructive">{errors.user.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              placeholder="App password or email password"
              className="h-9 text-sm"
              {...register("password", { required: "Password is required" })}
            />
            {errors.password && (
              <p className="text-xs text-destructive">
                {errors.password.message}
              </p>
            )}
            <div className="flex items-start gap-2 p-2 rounded-md bg-muted text-[11px]">
              <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-muted-foreground">
                For Gmail, use an App Password from Google Account → Security →
                2-Step Verification → App passwords
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="host" className="text-xs">
              IMAP Host
            </Label>
            <Input
              id="host"
              placeholder="imap.gmail.com"
              className="h-9 text-sm"
              {...register("host", { required: "Host is required" })}
            />
            {errors.host && (
              <p className="text-xs text-destructive">{errors.host.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="port" className="text-xs">
                Port
              </Label>
              <Input
                id="port"
                type="number"
                className="h-9 text-sm"
                {...register("port", {
                  valueAsNumber: true,
                  required: "Port is required",
                  min: { value: 1, message: "Invalid port" },
                  max: { value: 65535, message: "Invalid port" },
                })}
              />
              {errors.port && (
                <p className="text-xs text-destructive">
                  {errors.port.message}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inboxName" className="text-xs">
                Inbox Name
              </Label>
              <Input
                id="inboxName"
                className="h-9 text-sm"
                {...register("inboxName", {
                  required: "Inbox name is required",
                })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="secure" className="text-xs cursor-pointer">
              Use SSL/TLS
            </Label>
            <Switch
              id="secure"
              checked={secure}
              onCheckedChange={(checked) => setValue("secure", checked)}
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-md bg-destructive/10 text-destructive text-xs">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              type="submit"
              disabled={loading}
              className="flex-1 text-xs"
              size="sm"
            >
              {loading && (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              )}
              {loading ? "Testing connection..." : "Add Account"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
              size="sm"
              className="text-xs"
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
