import type {
  MacrosOkResponse,
  MacrosUpsertWeighInBody,
  MacrosWeighInItem,
  MacrosWeighInResponse,
  MacrosWeightOverviewResponse,
} from "@repo/schemas/macros";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  dismissImportedWeighIn,
  getHealthState,
} from "@/features/health/health-state";
import { oldestImportable } from "@/features/health/import-body";
import { api, errorMessage } from "@/lib/api";
import { deviceTimeZone, isoToday } from "@/lib/day";
import { recordFailedWrite } from "@/lib/failed-writes";
import { invalidateAfterWeighIn } from "./keys";

export const weightKeys = {
  overview: ["weight", "overview"] as const,
};

export const weighInMutationKey = ["weight", "weigh-in"] as const;

/** One weigh-in per day: posting the same `logDate` again replaces it. */
export function upsertWeighIn(body: MacrosUpsertWeighInBody) {
  return api<MacrosWeighInResponse>("/api/weight/weigh-ins", {
    method: "POST",
    body,
  });
}

export function registerWeightMutationDefaults(queryClient: QueryClient) {
  queryClient.setMutationDefaults(weighInMutationKey, {
    mutationFn: upsertWeighIn,
    onSuccess: () => invalidateAfterWeighIn(queryClient),
    onError: (error: Error) => {
      recordFailedWrite("A weigh-in", errorMessage(error));
    },
  });
}

export function useWeightOverview() {
  return useQuery({
    queryKey: weightKeys.overview,
    queryFn: ({ signal }) =>
      api<MacrosWeightOverviewResponse>("/api/weight/overview", {
        signal,
      }).then((body) => body.overview),
  });
}

export function useUpsertWeighIn() {
  return useMutation<MacrosWeighInResponse, Error, MacrosUpsertWeighInBody>({
    mutationKey: weighInMutationKey,
  });
}

type DeletedWeighIn = Pick<MacrosWeighInItem, "id" | "logDate" | "weightKg">;

export function useDeleteWeighIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeletedWeighIn) =>
      api<MacrosOkResponse>(`/api/weight/weigh-ins/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_response, weighIn) => {
      if (getHealthState().enabled) {
        dismissImportedWeighIn(
          { logDate: weighIn.logDate, weightKg: weighIn.weightKg },
          oldestImportable(isoToday(deviceTimeZone())),
        );
      }
      return invalidateAfterWeighIn(queryClient);
    },
  });
}
