import {
  type BrokerageSyncInput,
  brokerageOverviewSchema,
  brokerageSyncResultSchema,
} from "@repo/schemas";
import type { AdminClient, AdminRequestOptions } from "../client";

export async function fetchBrokerageOverview(
  client: AdminClient,
  options?: AdminRequestOptions,
) {
  return brokerageOverviewSchema.parse(
    await client.get<unknown>("brokerage", options),
  );
}

export async function syncBrokerage(
  client: AdminClient,
  input: BrokerageSyncInput = {},
) {
  return brokerageSyncResultSchema.parse(
    await client.post<unknown>("brokerage/sync", input),
  );
}
