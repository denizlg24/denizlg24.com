import { BellRing, CircleAlert } from "lucide-react";
import type { AlertEvent } from "@/lib/models";
import type { Channel } from "@/lib/notify/types";
import { channelMeta } from "./channel-guide";

/** Where an alert or signal delivers: always in the app, plus its chosen channels. */
export function DeliveryRoute({
  ids,
  channels,
  last,
}: {
  ids: string[];
  channels: Map<string, Channel>;
  last?: AlertEvent;
}) {
  const failed = new Set(
    last?.deliveries.filter((item) => !item.ok).map((item) => item.channel),
  );
  const routed = ids.flatMap((id) => {
    const channel = channels.get(id);
    return channel ? [channel] : [];
  });
  return (
    <ul className="route" aria-label="Delivers to">
      <li>
        <BellRing size={12} aria-hidden /> App
      </li>
      {routed.map((channel) => {
        const Icon = channelMeta[channel.kind].icon;
        const broken = channel.status === "error" || failed.has(channel.id);
        const reason = broken
          ? (last?.deliveries.find((item) => item.channel === channel.id)
              ?.error ??
            channel.error ??
            "Last delivery failed")
          : undefined;
        return (
          <li
            key={channel.id}
            data-broken={broken || undefined}
            title={reason ? `${channel.label}: ${reason}` : channel.label}
          >
            {broken ? (
              <CircleAlert size={12} aria-hidden />
            ) : (
              <Icon size={12} aria-hidden />
            )}
            <span className="route-name">{channel.label}</span>
            {broken ? (
              <span className="sr-only">, last delivery failed</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
