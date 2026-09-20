"use client";

import {
  StepActions,
  StepAlert,
  StepButton,
  StepHeading,
  TextAction,
} from "./flow-step";

/**
 * Shown once between a password sign-in and the app the visitor was heading
 * to, when nothing suggests this device already holds a passkey. Three ways
 * out, all of which end at the destination.
 */
export function PasskeyOfferStep({
  busy,
  error,
  destinationName,
  onAdd,
  onLater,
  onNever,
}: {
  busy: boolean;
  error?: string | null;
  destinationName: string;
  onAdd: () => void;
  onLater: () => void;
  onNever: () => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <StepHeading lede="A passkey signs you in on this device with Face ID, Touch ID, Windows Hello or your device PIN — no password, no code. It takes a few seconds and doesn't change how you sign in elsewhere.">
        Sign in faster next time?
      </StepHeading>
      {error ? <StepAlert>{error}</StepAlert> : null}
      <div className="flex flex-col gap-5">
        <StepButton type="button" busy={busy} onClick={onAdd}>
          Add a passkey
        </StepButton>
        <StepActions>
          <TextAction disabled={busy} onClick={onLater}>
            Not now, take me to {destinationName}
          </TextAction>
          <TextAction disabled={busy} onClick={onNever}>
            Don't ask again
          </TextAction>
        </StepActions>
      </div>
    </div>
  );
}
