"use client";

import useSWR from "swr";
import { api } from "../shared";
import type { ChannelsResponse } from "@/lib/notify/types";

const empty: ChannelsResponse = {
  channels: [],
  email: { ready: false, address: null },
  demo: false,
};

export function useChannels() {
  const { data, error, mutate, isLoading } = useSWR<ChannelsResponse>(
    "/api/alerts/channels",
    api,
    { revalidateOnFocus: false },
  );
  return { data: data ?? empty, error, mutate, isLoading };
}
