"use client";

import { BackupCodesStep } from "@repo/auth-ui/backup-codes-step";
import { TotpEnrollment } from "@repo/auth-ui/totp-enrollment";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Spinner } from "@repo/ui/spinner";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { useAccount, useRefreshAccount } from "@/components/account-gate";
import { PageSection } from "@/components/shell-frame";
import { enrollmentClient } from "@/lib/auth-client";

type Stage = "password" | "enroll" | "codes";

/**
 * Turning the factor off needs the password. The API refuses it for a cloud
 * account, for someone who manages an app, and while an app they use requires
 * a second factor — its message names the app, so it is shown as is.
 */
function TurnOffDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = (value: boolean) => {
    onOpenChange(value);
    if (!value) {
      setPassword("");
      setError(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: disableError } = await enrollmentClient.twoFactor.disable({
      password,
    });
    setBusy(false);
    if (disableError) {
      setError(
        disableError.code === "INVALID_PASSWORD"
          ? "That isn't your password."
          : (disableError.message ?? "Couldn't turn it off. Try again."),
      );
      return;
    }
    change(false);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">
            Turn off the authenticator app?
          </DialogTitle>
          <DialogDescription>
            Signing in will only ask for your password, and your backup codes
            stop working. You can set it up again at any time.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="two-factor-off-password">Password</Label>
            <Input
              id="two-factor-off-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "two-factor-off-error" : undefined}
              onChange={(event) => setPassword(event.target.value)}
            />
            {error ? (
              <p
                id="two-factor-off-error"
                role="alert"
                className="text-xs text-destructive"
              >
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              onClick={() => change(false)}
            >
              Keep it on
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy || password.length === 0}
              aria-busy={busy || undefined}
            >
              {busy ? <Spinner aria-hidden="true" /> : null}
              Turn off
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A cloud account always has an authenticator app — sign-in will not finish
 * without one. A public account may add one here, which some apps require and
 * which managing an app always does, and turn it off again.
 */
export function TwoFactorSection() {
  const account = useAccount();
  const refreshAccount = useRefreshAccount();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("password");
  const [password, setPassword] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [disabling, setDisabling] = useState(false);

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
        account.twoFactorEnabled ? (
          account.realm === "public" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDisabling(true)}
            >
              Turn off
            </Button>
          ) : null
        ) : (
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
      <TurnOffDialog
        open={disabling}
        onOpenChange={setDisabling}
        onDone={() => {
          toast.success("Authenticator app is off");
          void refreshAccount();
        }}
      />
    </PageSection>
  );
}
