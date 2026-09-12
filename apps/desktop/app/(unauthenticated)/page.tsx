"use client";

import { Button } from "@repo/ui/button";
import { MoveRight } from "lucide-react";
import { cancelSignIn, signIn } from "@/lib/auth/session";
import { useAuthStore } from "@/stores/auth";

const PHASE_LABEL = {
  idle: "Sign in",
  waiting: "Waiting for the browser…",
  exchanging: "Signing in…",
} as const;

export default function UnauthenticatedPage() {
  const phase = useAuthStore((state) => state.signIn);
  const error = useAuthStore((state) => state.error);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6">
      <h1 className="font-calistoga text-3xl">denizlg24</h1>
      <div className="flex w-full max-w-xs flex-col items-center gap-2">
        <Button
          className="w-full"
          onClick={() => void signIn()}
          disabled={phase !== "idle"}
        >
          {PHASE_LABEL[phase]}
          {phase === "idle" ? <MoveRight /> : null}
        </Button>
        {phase === "waiting" ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={cancelSignIn}
          >
            Cancel
          </Button>
        ) : null}
        {error ? (
          <p className="text-center text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
