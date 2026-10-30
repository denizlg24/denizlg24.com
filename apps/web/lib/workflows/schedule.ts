import {
  InvalidCronExpressionError,
  nextCronOccurrence,
} from "@/lib/agent-tasks/cron";
import { connectDB } from "@/lib/mongodb";
import {
  type IWorkspaceTrigger,
  WorkspaceTriggerModel,
} from "@/models/DomainEvent";
import { emitDomainEvent } from "./events";

/*
 * Schedule triggers (daily notes, weekly reviews) ride the agent-memory job
 * route the external scheduler already calls: no second cron. Each due
 * trigger's slot is claimed by moving its `nextRunAt` forward, then a
 * `schedule.tick` event naming it is emitted, so a schedule fires through the
 * same filter, rate limit and failure rules as any other trigger. Like agent
 * tasks, a missed slot is not replayed: the next one is computed from now.
 */
export async function fireScheduledTriggers(
  now = new Date(),
): Promise<{ fired: number }> {
  await connectDB();
  const due = await WorkspaceTriggerModel.find({
    event: "schedule.tick",
    enabled: true,
    nextRunAt: { $lte: now },
  })
    .limit(50)
    .lean<IWorkspaceTrigger[]>();
  let fired = 0;
  for (const trigger of due) {
    const scheduledFor = trigger.nextRunAt;
    if (!scheduledFor || !trigger.schedule) continue;
    let next: Date | null;
    try {
      next = nextCronOccurrence({
        cron: trigger.schedule.cron,
        timeZone: trigger.schedule.timeZone,
        after: now,
      });
    } catch (error) {
      if (!(error instanceof InvalidCronExpressionError)) throw error;
      next = null;
    }
    const claimed = await WorkspaceTriggerModel.updateOne(
      { _id: trigger._id, nextRunAt: scheduledFor },
      { $set: { nextRunAt: next } },
    ).exec();
    if (claimed.modifiedCount === 0) continue;
    const at = scheduledFor.toISOString();
    const id = await emitDomainEvent(
      {
        type: "schedule.tick",
        payload: { triggerId: trigger._id.toString(), scheduledFor: at },
      },
      { dedupeKey: `schedule:${trigger._id.toString()}:${at}` },
    );
    if (id) fired += 1;
  }
  return { fired };
}
