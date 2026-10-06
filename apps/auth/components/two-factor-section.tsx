"use client";

import { BackupCodesStep } from "@repo/auth-ui/backup-codes-step";
import { TotpEnrollment } from "@repo/auth-ui/totp-enrollment";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { useState } from "react";
import { toast } from "sonner";
import { useAccount, useRefreshAccount } from "@/components/account-gate";
import { PageSection } from "@/components/shell-frame";
import { enrollmentClient } from "@/lib/auth-client";

type Stage = "password" | "enroll" | "codes";

/**
 * A cloud account always has an authenticator app — sign-in will not finish
 * without one. A public account may add one here, which some apps require and
 * which managing an app always does.
 */
export function TwoFactorSection() {
  const account = useAccount();
  const refreshAccount = useRefreshAccount();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("password");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setStage("password");
    setPassword("");
    setCodes([]);
    setError(null);
  };

  return (
    <PageSection
      id="two-factor"
      title="Authenticator app"
      actions={
        account.twoFactorEnabled ? null : (
          <Button size="sm" onClick={() => setOpen(true)}>
            Set up
          </Button>
        )
      }
    >
      <p className="text-sm text-muted-foreground">
        {account.twoFactorEnabled ? (
          <>
            <Badge variant="secondary" className="mr-2">
              On
            </Badge>
            Signing in asks for a code from your authenticator app after your
            password.
          </>
        ) : (
          "Off. Some apps ask for a code from an authenticator app as well as your password, and managing an app always does."
        )}
      </p>
      <Dialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set up an authenticator app</DialogTitle>
            {stage === "password" ? (
              <DialogDescription>
                Enter your password to start. You'll scan a code with an app
                like 1Password, Google Authenticator or your phone's built-in
                one.
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {stage === "password" ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                setStage("enroll");
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="two-factor-password">Password</Label>
                <Input
                  id="two-factor-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {error ? (
                  <p role="alert" className="text-xs text-destructive">
                    {error}
                  </p>
                ) : null}
              </div>
              <Button type="submit" disabled={password.length === 0}>
                Continue
              </Button>
            </form>
          ) : null}
          {stage === "enroll" ? (
            <TotpEnrollment
              authClient={enrollmentClient}
              password={password}
              onVerified={(backupCodes) => {
                setPassword("");
                setCodes(backupCodes);
                setStage("codes");
              }}
              onFailed={(message) => {
                setPassword("");
                setError(message);
                setStage("password");
              }}
            />
          ) : null}
          {stage === "codes" ? (
            <BackupCodesStep
              codes={codes}
              onContinue={() => {
                close();
                toast.success("Authenticator app is on");
                void refreshAccount();
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}
