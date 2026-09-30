import type {
  MacrosCaloriePreference,
  MacrosCaloriePreferenceResponse,
  MacrosProfile,
  MacrosProfileResponse,
  MacrosTimezoneResponse,
} from "@repo/schemas/macros";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "./keys";

export type Profile = MacrosProfile;

export function useProfile(enabled = true) {
  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: ({ signal }) =>
      api<MacrosProfileResponse>("/api/profile", { signal }).then(
        (body) => body.profile,
      ),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateTimezone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (timezone: string) =>
      api<MacrosTimezoneResponse>("/api/profile/timezone", {
        method: "PUT",
        body: { timezone },
      }),
    onSuccess: ({ timezone }) => {
      queryClient.setQueryData<Profile>(queryKeys.profile, (profile) =>
        profile ? { ...profile, timezone } : profile,
      );
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["food-log"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.body }),
      ]);
    },
  });
}

export function useUpdateCaloriePreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (caloriePreference: MacrosCaloriePreference) =>
      api<MacrosCaloriePreferenceResponse>("/api/profile/preferences", {
        method: "PUT",
        body: { caloriePreference },
      }),
    onSuccess: ({ caloriePreference }) => {
      queryClient.setQueryData<Profile>(queryKeys.profile, (profile) =>
        profile ? { ...profile, caloriePreference } : profile,
      );
      return queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
