import "server-only";
import { readWorkspace, saveWorkspace } from "./db";
import type { Workspace } from "./models";
import { listChannels, markChannel } from "./notify/store";
import { deliver, type Message } from "./notify/send";
import { reason } from "./notify/channel-api";

/** Re-reads and re-applies `update` until the workspace saves without a revision conflict. */
export async function persist(
  userId: string,
  update: (workspace: Workspace) => boolean,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await readWorkspace(userId);
    if (!update(current.data)) return true;
    if (await saveWorkspace(userId, current.revision, current.data))
      return true;
  }
  return false;
}

export type Channels = Awaited<ReturnType<typeof listChannels>>;

export const channelsFor = async (userId: string, wanted: Set<string>) =>
  wanted.size
    ? (await listChannels(userId)).filter((item) => wanted.has(item.id))
    : [];

/** Sends one message to each selected channel and records the outcome on the channel. */
export function deliverTo(
  userId: string,
  channels: Channels,
  selected: string[],
  content: Message,
) {
  return Promise.all(
    channels
      .filter((channel) => selected.includes(channel.id))
      .map(async (channel) => {
        let error: string | null = null;
        try {
          if (!channel.config) throw new Error(channel.error ?? "Unreadable.");
          await deliver(channel.config, content);
        } catch (cause) {
          error = reason(cause);
        }
        await markChannel(userId, channel.id, error).catch(() => undefined);
        return {
          channel: channel.id,
          kind: channel.kind,
          label: channel.label,
          ok: error === null,
          error,
        };
      }),
  );
}
