import type {
  MacrosDistributionAccessResponse,
  MacrosDistributionDecisionBody,
  MacrosDistributionDecisionResponse,
  MacrosDistributionRequest,
  MacrosDistributionRequestsResponse,
} from "@repo/schemas/macros";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type DeviceRequest = MacrosDistributionRequest;

export const distributionKeys = {
  access: ["distribution", "access"] as const,
  requests: ["distribution", "requests"] as const,
};

/** Whether the signed-in account is in `MACROS_OWNER_EMAILS`. */
export function useDistributionAccess() {
  return useQuery({
    queryKey: distributionKeys.access,
    queryFn: ({ signal }) =>
      api<MacrosDistributionAccessResponse>("/api/distribution/access", {
        signal,
      }),
    staleTime: 60 * 60_000,
  });
}

export function useDeviceRequests() {
  return useQuery({
    queryKey: distributionKeys.requests,
    queryFn: ({ signal }) =>
      api<MacrosDistributionRequestsResponse>("/api/distribution/requests", {
        signal,
      }).then((response) => response.requests),
  });
}

export function useDecideDeviceRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    // A decision replayed later could approve a phone after the owner had
    // moved on; fail now instead of queueing it.
    networkMode: "always",
    mutationFn: ({
      id,
      action,
    }: MacrosDistributionDecisionBody & { id: string }) =>
      api<MacrosDistributionDecisionResponse>(
        `/api/distribution/requests/${id}`,
        { method: "PATCH", body: { action } },
      ),
    onSuccess: ({ request }) => {
      queryClient.setQueryData<DeviceRequest[]>(
        distributionKeys.requests,
        (current) =>
          current?.map((item) => (item.id === request.id ? request : item)),
      );
    },
  });
}
