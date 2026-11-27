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
  /** One-click connections whose app credentials are configured. */
  connect: { telegram: boolean; discord: boolean; slack: boolean };
  /** VAPID public key for browser push, or null when push is off. */
  push: { publicKey: string | null };
  demo: boolean;
};
