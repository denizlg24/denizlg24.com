"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Info, Loader2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const emailAccountSchema = z.object({
  host: z.string().min(1, "Host is required"),
  port: z.number().min(1, "Port must be greater than 0").max(65535),
  secure: z.boolean(),
  user: z.string().email("Must be a valid email address"),
  password: z.string().min(1, "Password is required"),
  inboxName: z.string().min(1, "Inbox name is required"),
});

type EmailAccountFormData = z.infer<typeof emailAccountSchema>;

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccountAdded: () => void;
}

const IMAP_PRESETS = [
  { label: "Gmail", host: "imap.gmail.com", port: 993, secure: true },
  { label: "Outlook", host: "outlook.office365.com", port: 993, secure: true },
  { label: "Yahoo", host: "imap.mail.yahoo.com", port: 993, secure: true },
  { label: "iCloud", host: "imap.mail.me.com", port: 993, secure: true },
];

export function AddAccountDialog({
  open,
  onOpenChange,
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
  } = useForm<EmailAccountFormData>({
    resolver: zodResolver(emailAccountSchema),
    defaultValues: {
      host: "",
      port: 993,
      secure: true,
      user: "",
      password: "",
      inboxName: "INBOX",
    },
  });

  const onSubmit = async (data: EmailAccountFormData) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/email-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to add email account");
      }

      reset();
      onOpenChange(false);
      onAccountAdded();
    } catch (err) {
      console.error("Error adding email account:", err);
      setError(
        err instanceof Error ? err.message : "Failed to add email account",
      );
    } finally {
      setLoading(false);
    }
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
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base sm:text-lg">
            Add Email Account
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Connect your email account using IMAP. Make sure IMAP access is
            enabled in your email provider settings.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-3 sm:space-y-4 mt-4"
        >
          <div>
            <FieldLabel className="mb-2 text-xs sm:text-sm">
              Quick Setup
            </FieldLabel>
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
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

          <Field data-invalid={!!errors.user}>
            <FieldLabel htmlFor="user" className="text-xs sm:text-sm">
              Email Address
            </FieldLabel>
            <Input
              id="user"
              type="email"
              placeholder="your.email@example.com"
              className="text-sm"
              {...register("user")}
            />
            {errors.user && (
              <FieldError className="text-xs">{errors.user.message}</FieldError>
            )}
          </Field>

          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password" className="text-xs sm:text-sm">
              Password
            </FieldLabel>
            <Input
              id="password"
              type="password"
              placeholder="Your email password or app password"
              className="text-sm"
              {...register("password")}
            />
            {errors.password && (
              <FieldError className="text-xs">
                {errors.password.message}
              </FieldError>
            )}
            <div className="flex items-start gap-2 mt-2 p-2 rounded-md bg-muted text-[10px] sm:text-xs">
              <Info className="w-3 h-3 sm:w-4 sm:h-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="font-medium mb-1">For Gmail users:</p>
                <p className="text-muted-foreground">
                  Use an App Password instead of your regular password. Generate
                  one at: Google Account → Security → 2-Step Verification → App
                  passwords
                </p>
              </div>
            </div>
          </Field>

          <Field data-invalid={!!errors.host}>
            <FieldLabel htmlFor="host" className="text-xs sm:text-sm">
              IMAP Host
            </FieldLabel>
            <Input
              id="host"
              type="text"
              placeholder="imap.gmail.com"
              className="text-sm"
              {...register("host")}
            />
            {errors.host && (
              <FieldError className="text-xs">{errors.host.message}</FieldError>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <Field data-invalid={!!errors.port}>
              <FieldLabel htmlFor="port" className="text-xs sm:text-sm">
                Port
              </FieldLabel>
              <Input
                id="port"
                type="number"
                className="text-sm"
                {...register("port", { valueAsNumber: true })}
              />
              {errors.port && (
                <FieldError className="text-xs">
                  {errors.port.message}
                </FieldError>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="inboxName" className="text-xs sm:text-sm">
                Inbox Name
              </FieldLabel>
              <Input
                id="inboxName"
                type="text"
                className="text-sm"
                {...register("inboxName")}
              />
              {errors.inboxName && (
                <FieldError className="text-xs">
                  {errors.inboxName.message}
                </FieldError>
              )}
            </Field>
          </div>

          <Field>
            <div className="flex items-center gap-2">
              <Checkbox
                id="secure"
                checked={secure}
                onCheckedChange={(checked) =>
                  setValue("secure", checked === true)
                }
              />
              <FieldLabel
                htmlFor="secure"
                className="cursor-pointer text-xs sm:text-sm"
              >
                Use SSL/TLS (Recommended)
              </FieldLabel>
            </div>
          </Field>

          {error && (
            <div className="p-2 sm:p-3 rounded-md bg-destructive/10 text-destructive text-xs sm:text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-3 sm:pt-4">
            <Button
              type="submit"
              disabled={loading}
              className="flex-1 text-xs sm:text-sm"
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {loading ? "Testing..." : "Add Account"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={loading}
              className="text-xs sm:text-sm"
            >
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
