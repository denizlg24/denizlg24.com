"use client";

import useSWR from "swr";
import type { ChannelsResponse } from "@/lib/notify/types";
import { api } from "../shared";

const empty: ChannelsResponse = {
  channels: [],
  email: { ready: false, address: null },
  connect: { telegram: false, discord: false, slack: false },
  push: { publicKey: null },
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
