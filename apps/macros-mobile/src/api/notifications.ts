import type {
  MacrosNotificationPreferences,
  MacrosNotificationPreferencesResponse,
  MacrosOkResponse,
  MacrosPushDeviceResponse,
  macrosRegisterPushDeviceBodySchema,
  macrosUpdateNotificationPreferencesBodySchema,
} from "@repo/schemas/macros";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { api } from "@/lib/api";

export type NotificationPreferences = MacrosNotificationPreferences;
export type UpdateNotificationPreferencesInput = z.input<
  typeof macrosUpdateNotificationPreferencesBodySchema
>;
export type RegisterPushDeviceInput = z.input<
  typeof macrosRegisterPushDeviceBodySchema
>;

export const notificationKeys = {
  all: ["notifications"] as const,
  preferences: ["notifications", "preferences"] as const,
};

export function useNotificationPreferences(enabled = true) {
  return useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: ({ signal }) =>
      api<MacrosNotificationPreferencesResponse>(
        "/api/notifications/preferences",
        { signal },
      ).then((body) => body.preferences),
    enabled,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateNotificationPreferencesInput) =>
      api<MacrosNotificationPreferencesResponse>(
        "/api/notifications/preferences",
        { method: "PATCH", body: input },
      ).then((body) => body.preferences),
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: notificationKeys.preferences,
      });
      const previous = queryClient.getQueryData<NotificationPreferences>(
        notificationKeys.preferences,
      );
      if (previous) {
        queryClient.setQueryData<NotificationPreferences>(
          notificationKeys.preferences,
          { ...previous, ...input },
        );
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          notificationKeys.preferences,
          context.previous,
        );
      }
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(notificationKeys.preferences, preferences);
    },
  });
}

export function registerPushDevice(input: RegisterPushDeviceInput) {
  return api<MacrosPushDeviceResponse>("/api/push/devices", {
    method: "POST",
    body: input,
  }).then((body) => body.device);
}

export function unregisterPushDevice(token: string, signal?: AbortSignal) {
  return api<MacrosOkResponse>("/api/push/devices", {
    method: "DELETE",
    body: { token },
    signal,
  });
}
