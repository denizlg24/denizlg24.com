import type {
  MacrosCompleteRegistrationResponse,
  macrosCompleteRegistrationBodySchema,
} from "@repo/schemas/macros";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { ApiError, api } from "@/lib/api";
import { queryKeys } from "./keys";

export type CompleteRegistrationInput = z.input<
  typeof macrosCompleteRegistrationBodySchema
>;

/**
 * Finishes onboarding. The root gate moves into the app once the refetched
 * profile reports `onboardingCompleted`, so success needs no navigation.
 */
export function useCompleteRegistration() {
  const queryClient = useQueryClient();
  const refreshProfile = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.profile });

  return useMutation({
    mutationFn: (body: CompleteRegistrationInput) =>
      api<MacrosCompleteRegistrationResponse>("/api/register/complete", {
        method: "POST",
        body,
      }),
    // Not idempotent and not worth queueing: offline should fail on the spot
    // so the button can say so, rather than pause behind a spinner.
    networkMode: "always",
    retry: false,
    onSuccess: refreshProfile,
    onError: (error) => {
      // Already completed — from another device, or a response lost after the
      // server committed. The profile knows; let the gate follow it.
      if (error instanceof ApiError && error.status === 409) {
        return refreshProfile();
      }
    },
  });
}

export function isAlreadyCompleted(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}
