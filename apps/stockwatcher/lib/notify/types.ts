import type { ChannelKind } from "../models";

export type Channel = {
  id: string;
  kind: ChannelKind;
  label: string;
  /** Masked destination, safe to display. */
  target: string;
  status: "active" | "error";
  error: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type ChannelsResponse = {
  channels: Channel[];
  email: { ready: boolean; address: string | null };
  demo: boolean;
};
