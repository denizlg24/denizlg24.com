import { z } from "zod";
import { currentUser, json, sameOrigin } from "@/lib/auth";
import { readWorkspace, saveWorkspace } from "@/lib/db";
import {
  deleteChannel,
  markChannel,
  publicChannel,
  readChannel,
  renameChannel,
} from "@/lib/notify/store";
import { allowTest, readBody, tryDeliver } from "@/lib/notify/channel-api";

async function owner(request: Request) {
  if (!sameOrigin(request))
    return { response: json({ error: "Origin not allowed" }, 403) };
  const user = await currentUser();
  if (!user) return { response: json({ error: "Sign in first." }, 401) };
  return { user };
}

/** Sends a test message. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/alerts/channels/[id]">,
) {
  const { user, response } = await owner(request);
  if (!user) return response;
  const { id } = await ctx.params;
  const channel = await readChannel(user.id, id);
  if (!channel) return json({ error: "Channel not found." }, 404);
  if (!channel.config) return json({ error: channel.error }, 422);
  if (!allowTest(user.id))
    return json(
      { error: "Too many test messages. Wait a few minutes and try again." },
      429,
    );
  const failed = await tryDeliver(channel.config, channel.label);
  await markChannel(user.id, id, failed);
  const updated = await readChannel(user.id, id);
  return json(
    { channel: updated ? publicChannel(updated) : null, error: failed },
    failed ? 422 : 200,
  );
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/alerts/channels/[id]">,
) {
  const { user, response } = await owner(request);
  if (!user) return response;
  const { id } = await ctx.params;
  const parsed = z
    .object({ label: z.string().trim().min(1).max(60) })
    .safeParse(await readBody(request));
  if (!parsed.success) return json({ error: "Enter a name." }, 400);
  if (!(await readChannel(user.id, id)))
    return json({ error: "Channel not found." }, 404);
  await renameChannel(user.id, id, parsed.data.label);
  const updated = await readChannel(user.id, id);
  return json({ channel: updated ? publicChannel(updated) : null });
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/alerts/channels/[id]">,
) {
  const { user, response } = await owner(request);
  if (!user) return response;
  const { id } = await ctx.params;
  await deleteChannel(user.id, id);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readWorkspace(user.id);
    if (!current.data.alerts.some((alert) => alert.channels.includes(id)))
      break;
    const alerts = current.data.alerts.map((alert) => ({
      ...alert,
      channels: alert.channels.filter((channel) => channel !== id),
    }));
    if (
      await saveWorkspace(user.id, current.revision, {
        ...current.data,
        alerts,
      })
    )
      break;
  }
  return json({ ok: true });
}
