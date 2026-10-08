import {
  MOBILE_INSTALLATION_HEADER,
  type MobileDeviceRegistration,
  type ShiftActivityState,
} from "@repo/schemas";
import { shiftActivityState } from "@repo/utils";
import {
  type ApnsClient,
  type ApnsRequest,
  createApnsClient,
  parseApnsPrivateKey,
} from "@repo/utils/apns";
import { headers } from "next/headers";
import { after } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { type IMobileDevice, MobileDevice } from "@/models/MobileDevice";
import { type IWorkSession, WorkJob, WorkSession } from "@/models/WorkHours";

/**
 * Pushes to the iPhone apps. Today that is one thing: keeping the Hours Live
 * Activity in step with the shift when it changes anywhere but on the phone
 * that holds it — the desktop, the web dashboard, an agent. The phone starts
 * its own activity when it clocks in; every other change reaches it here.
 *
 * Needs the team's APNs key (`APNS_KEY_ID`, `APNS_TEAM_ID`,
 * `APNS_PRIVATE_KEY` — the key Macros uses works, an auth key is team-wide).
 * Without it nothing is sent and nothing fails.
 */

const HOURS_BUNDLE_ID = "com.denizlg24.hours";
const LIVE_ACTIVITY_TOPIC = `${HOURS_BUNDLE_ID}.push-type.liveactivity`;
/** The Swift type name ActivityKit instantiates on push-to-start. */
const ATTRIBUTES_TYPE = "ShiftAttributes";

let client: ApnsClient | null | undefined;

function apns(): ApnsClient | null {
  if (client !== undefined) return client;
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const rawKey = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !rawKey?.trim()) {
    client = null;
    return client;
  }
  try {
    client = createApnsClient({
      keyId,
      teamId,
      privateKey: parseApnsPrivateKey(rawKey),
    });
  } catch (error) {
    console.error("[mobile-push] APNS_PRIVATE_KEY is not a valid key", error);
    client = null;
  }
  return client;
}

export async function registerMobileDevice(
  installationId: string,
  input: MobileDeviceRegistration,
) {
  await connectDB();
  const unset: Record<string, ""> = {};
  if (!input.pushToken) unset.pushToken = "";
  if (!input.liveActivityStartToken) unset.liveActivityStartToken = "";
  if (!input.name) unset.name = "";
  await MobileDevice.updateOne(
    { installationId },
    {
      $set: {
        app: input.app,
        environment: input.environment,
        liveActivities: input.liveActivities,
        ...(input.name ? { name: input.name } : {}),
        ...(input.pushToken ? { pushToken: input.pushToken } : {}),
        ...(input.liveActivityStartToken
          ? { liveActivityStartToken: input.liveActivityStartToken }
          : {}),
      },
      ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
    },
    { upsert: true },
  );
}

export async function forgetMobileDevice(installationId: string) {
  await connectDB();
  await MobileDevice.deleteOne({ installationId });
}

/** The install that made this request, which already knows what it did. */
async function originInstallation(): Promise<string | null> {
  try {
    return (await headers()).get(MOBILE_INSTALLATION_HEADER);
  } catch {
    return null;
  }
}

/**
 * After the response, like the payout re-projection: a tap stays instant, and
 * a lost push only leaves the lock screen behind until the app next opens.
 */
export function scheduleShiftPush() {
  if (!apns()) return;
  try {
    after(async () => pushShiftState(await originInstallation()));
  } catch {
    void pushShiftState(null);
  }
}

function sessionShape(session: IWorkSession) {
  return {
    id: session._id.toString(),
    start: session.start,
    end: session.end ?? null,
    breaks: session.breaks.map((item) => ({
      start: item.start,
      end: item.end ?? null,
    })),
  };
}

function frozen(state: ShiftActivityState | null): ShiftActivityState | null {
  return state ? { ...state, status: "ended", breakFrom: null } : null;
}

async function currentShift(): Promise<{
  state: ShiftActivityState | null;
  final: ShiftActivityState | null;
  jobName: string;
}> {
  const open = await WorkSession.findOne({ openKey: "open" });
  if (open) {
    const job = await WorkJob.findById(open.jobId);
    return {
      state: shiftActivityState(sessionShape(open), job?.breaksPaid ?? false),
      final: null,
      jobName: job?.name ?? "Shift",
    };
  }
  // An activity that ends shows the shift as it closed.
  const last = await WorkSession.findOne({ end: { $exists: true } }).sort({
    end: -1,
  });
  if (!last?.end) return { state: null, final: null, jobName: "Shift" };
  const job = await WorkJob.findById(last.jobId);
  return {
    state: null,
    final: frozen(
      shiftActivityState(
        { ...sessionShape(last), end: null },
        job?.breaksPaid ?? false,
        last.end,
      ),
    ),
    jobName: job?.name ?? "Shift",
  };
}

async function deliver(
  sender: ApnsClient,
  device: IMobileDevice,
  token: string,
  request: Omit<ApnsRequest, "environment" | "token" | "topic" | "pushType">,
): Promise<boolean> {
  try {
    const result = await sender.send({
      ...request,
      environment: device.environment,
      token,
      topic: LIVE_ACTIVITY_TOPIC,
      pushType: "liveactivity",
    });
    if (result.outcome === "sent") return true;
    console.warn(
      `[mobile-push] APNs ${result.status} ${result.reason ?? ""} for ${device.installationId}`,
    );
    if (result.outcome === "disable") {
      await MobileDevice.updateOne(
        { _id: device._id },
        token === device.liveActivityStartToken
          ? { $unset: { liveActivityStartToken: "" } }
          : { $pull: { liveActivities: { token } } },
      );
    }
  } catch (error) {
    console.error(
      `[mobile-push] sending to ${device.installationId} failed`,
      error,
    );
  }
  return false;
}

export async function pushShiftState(origin: string | null) {
  const sender = apns();
  if (!sender) return;
  await connectDB();
  const devices = await MobileDevice.find({ app: "hours" });
  if (devices.length === 0) return;
  const { state, final, jobName } = await currentShift();
  const timestamp = Math.floor(Date.now() / 1000);

  await Promise.all(
    devices.map(async (device) => {
      if (state && device.liveActivities.length > 0) {
        for (const activity of device.liveActivities) {
          await deliver(sender, device, activity.token, {
            priority: 10,
            collapseId: "shift",
            payload: {
              aps: { timestamp, event: "update", "content-state": state },
            },
          });
        }
        return;
      }
      if (state) {
        // The phone that clocked in starts its own; a second one would be a
        // duplicate on its lock screen.
        if (
          !device.liveActivityStartToken ||
          device.installationId === origin
        ) {
          return;
        }
        await deliver(sender, device, device.liveActivityStartToken, {
          priority: 10,
          payload: {
            aps: {
              timestamp,
              event: "start",
              "attributes-type": ATTRIBUTES_TYPE,
              attributes: { jobName },
              "content-state": state,
              alert: { title: "Checked in", body: jobName },
            },
          },
        });
        return;
      }
      for (const activity of device.liveActivities) {
        await deliver(sender, device, activity.token, {
          priority: 10,
          payload: {
            aps: {
              timestamp,
              event: "end",
              "dismissal-date": timestamp + 15 * 60,
              ...(final ? { "content-state": final } : {}),
            },
          },
        });
      }
    }),
  );
}
