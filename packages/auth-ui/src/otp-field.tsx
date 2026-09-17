"use client";

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@repo/ui/input-otp";
import { cn } from "@repo/ui/utils";

export const OTP_LENGTH = 6;

/**
 * Six digit slots for an authenticator code. `onComplete` fires on the sixth
 * digit so a step can submit without a second tap; `autoComplete` lets a
 * phone offer the code it just received.
 */
export function OtpField({
  id,
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  autoFocus = false,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  describedBy?: string;
}) {
  return (
    <InputOTP
      id={id}
      maxLength={OTP_LENGTH}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      autoFocus={autoFocus}
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="one-time-code"
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      containerClassName="w-full"
    >
      <InputOTPGroup className="w-full">
        {Array.from({ length: OTP_LENGTH }, (_, index) => (
          <InputOTPSlot
            key={index}
            index={index}
            aria-invalid={invalid || undefined}
            className={cn(
              "h-12 flex-1 text-lg tabular-nums",
              invalid && "border-destructive",
            )}
          />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
