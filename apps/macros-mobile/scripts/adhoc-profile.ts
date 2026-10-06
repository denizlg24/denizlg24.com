/**
 * Registers every approved UDID with the developer account and writes a fresh
 * ad-hoc provisioning profile for each signed target (the app and its widget
 * extension) that includes them. Runs in macros-mobile.yml's
 * release-ios-adhoc job; the App Store Connect key lives only in its
 * `macros-release` environment.
 *
 *   bun scripts/adhoc-profile.ts --certificate dist.pem \
 *     --out-dir build/profiles --summary build/profile.json
 *
 * The summary lists `udids` and one `profiles` entry per target (`target`,
 * `bundleIdentifier`, `name`, `uuid`, `file`).
 *
 * Env: APPLE_ASC_KEY_ID, APPLE_ASC_ISSUER_ID, APPLE_ASC_PRIVATE_KEY,
 * MACROS_DISTRIBUTION_SECRET, MACROS_API_URL (default production).
 */
import { parseArgs } from "node:util";
import {
  type MacrosDistributionRegistration,
  macrosDistributionApprovedResponseSchema,
} from "@repo/schemas/macros";
import { z } from "zod";
import {
  type AscCertificate,
  type AscDevice,
  createAscToken,
  DEVICE_YEARLY_CAP,
  deviceName,
  findCertificate,
  missingCapabilities,
  planRegistrations,
  profileDevices,
  SIGNING_TARGETS,
  type SigningTarget,
} from "./app-store-connect";

const ASC_BASE = "https://api.appstoreconnect.apple.com";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const { values } = parseArgs({
  options: {
    certificate: { type: "string" },
    "out-dir": { type: "string" },
    summary: { type: "string" },
  },
});
if (!values.certificate || !values["out-dir"] || !values.summary) {
  throw new Error("--certificate, --out-dir and --summary are required");
}
const outDir = values["out-dir"];

const keyId = requiredEnv("APPLE_ASC_KEY_ID");
const issuerId = requiredEnv("APPLE_ASC_ISSUER_ID");
const privateKey = requiredEnv("APPLE_ASC_PRIVATE_KEY");
const distributionSecret = requiredEnv("MACROS_DISTRIBUTION_SECRET");
const macrosApi = (
  process.env.MACROS_API_URL?.trim() || "https://macros.denizlg24.com"
).replace(/\/+$/, "");

class AscError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    path: string,
  ) {
    super(`App Store Connect ${status} on ${path}: ${body}`);
  }
}

async function asc(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const url = path.startsWith("http") ? path : `${ASC_BASE}${path}`;
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      authorization: `Bearer ${createAscToken({ keyId, issuerId, privateKey })}`,
      "content-type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  if (!response.ok) throw new AscError(response.status, text, path);
  return text ? JSON.parse(text) : null;
}

const linksSchema = z.object({ next: z.string().optional() }).optional();

async function ascList<T extends z.ZodType>(
  path: string,
  item: T,
): Promise<z.infer<T>[]> {
  const page = z.object({ data: z.array(item), links: linksSchema });
  const items: z.infer<T>[] = [];
  let next: string | undefined = path;
  while (next) {
    const parsed = page.parse(await asc(next));
    items.push(...parsed.data);
    next = parsed.links?.next;
  }
  return items;
}

const deviceResource = z
  .object({
    id: z.string(),
    attributes: z.object({
      udid: z.string(),
      status: z.enum(["ENABLED", "DISABLED", "PROCESSING"]),
      platform: z.string(),
      deviceClass: z.string().optional(),
    }),
  })
  .transform(
    ({ id, attributes }): AscDevice => ({
      id,
      udid: attributes.udid,
      status: attributes.status,
      platform: attributes.platform,
      deviceClass: attributes.deviceClass,
    }),
  );

const listDevices = () =>
  ascList("/v1/devices?filter[platform]=IOS&limit=200", deviceResource);

async function registerDevice(name: string, udid: string): Promise<AscDevice> {
  try {
    const created = await asc("/v1/devices", {
      method: "POST",
      body: {
        data: {
          type: "devices",
          attributes: { name: deviceName(name), platform: "IOS", udid },
        },
      },
    });
    return z.object({ data: deviceResource }).parse(created).data;
  } catch (error) {
    // Registered by hand, or by a run that died before reporting back.
    if (!(error instanceof AscError) || error.status !== 409) throw error;
    const [existing] = await ascList(
      `/v1/devices?filter[udid]=${encodeURIComponent(udid)}&limit=1`,
      deviceResource,
    );
    if (!existing) throw error;
    return existing;
  }
}

async function macros(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${macrosApi}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${distributionSecret}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Macros ${response.status} on ${path}: ${text}`);
  }
  return JSON.parse(text);
}

async function ensureBundleId(target: SigningTarget): Promise<string> {
  const identifier = target.bundleIdentifier;
  const resource = z.object({
    id: z.string(),
    attributes: z.object({ identifier: z.string() }),
  });
  // The identifier filter also matches longer identifiers that contain it.
  const bundle = (
    await ascList(
      `/v1/bundleIds?filter[identifier]=${identifier}&limit=200`,
      resource,
    )
  ).find((candidate) => candidate.attributes.identifier === identifier);

  const bundleId =
    bundle?.id ??
    z.object({ data: resource }).parse(
      await asc("/v1/bundleIds", {
        method: "POST",
        body: {
          data: {
            type: "bundleIds",
            attributes: {
              identifier,
              name: target.name,
              platform: "IOS",
            },
          },
        },
      }),
    ).data.id;
  if (!bundle) console.log(`Created bundle id ${identifier}`);

  const present = await ascList(
    `/v1/bundleIds/${bundleId}/bundleIdCapabilities?limit=200`,
    z.object({ attributes: z.object({ capabilityType: z.string() }) }),
  );
  for (const capability of missingCapabilities(
    present.map((item) => item.attributes.capabilityType),
    target,
  )) {
    await asc("/v1/bundleIdCapabilities", {
      method: "POST",
      body: {
        data: {
          type: "bundleIdCapabilities",
          attributes: { capabilityType: capability },
          relationships: {
            bundleId: { data: { type: "bundleIds", id: bundleId } },
          },
        },
      },
    });
    console.log(`Enabled ${capability} on ${identifier}`);
  }
  return bundleId;
}

async function distributionCertificate(pem: string): Promise<AscCertificate> {
  const certificates = await ascList(
    "/v1/certificates?limit=200",
    z
      .object({
        id: z.string(),
        attributes: z.object({
          certificateType: z.string(),
          certificateContent: z.string(),
        }),
      })
      .transform(
        ({ id, attributes }): AscCertificate => ({ id, ...attributes }),
      ),
  );
  const match = findCertificate(certificates, pem);
  if (!match) {
    throw new Error(
      "No certificate on the account matches MACROS_IOS_DIST_CERT_P12. Export the Apple Distribution certificate the account lists.",
    );
  }
  return match;
}

// 1. Register what the owner approved and tell the server what Apple said.
const approved = macrosDistributionApprovedResponseSchema.parse(
  await macros("/api/distribution/approved"),
).devices;
const before = await listDevices();
const plan = planRegistrations(approved, before);
const reports: MacrosDistributionRegistration[] = plan.known.map(
  ({ request, device }) => ({ id: request.id, appleDeviceId: device.id }),
);
for (const request of plan.missing) {
  try {
    const device = await registerDevice(request.name, request.udid);
    reports.push({ id: request.id, appleDeviceId: device.id });
    console.log(`Registered ${request.udid} (${request.name})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reports.push({ id: request.id, error: message.slice(0, 2000) });
    console.error(`::warning::Could not register ${request.udid}: ${message}`);
  }
}
if (reports.length > 0) {
  await macros("/api/distribution/registered", { items: reports });
}

// 2. One profile per signed target, all with the same devices.
const certificatePem = await Bun.file(values.certificate).text();
const certificate = await distributionCertificate(certificatePem);
const devices = profileDevices(await listDevices());
if (devices.length === 0) {
  throw new Error("No enabled iOS devices on the account to put in a profile");
}

async function createProfile(target: SigningTarget) {
  const bundleId = await ensureBundleId(target);
  const stale = await ascList(
    `/v1/profiles?filter[name]=${encodeURIComponent(target.profileName)}&limit=200`,
    z.object({ id: z.string() }),
  );
  for (const profile of stale) {
    await asc(`/v1/profiles/${profile.id}`, { method: "DELETE" });
  }

  const created = z
    .object({
      data: z.object({
        attributes: z.object({ uuid: z.string(), profileContent: z.string() }),
      }),
    })
    .parse(
      await asc("/v1/profiles", {
        method: "POST",
        body: {
          data: {
            type: "profiles",
            attributes: {
              name: target.profileName,
              profileType: "IOS_APP_ADHOC",
            },
            relationships: {
              bundleId: { data: { type: "bundleIds", id: bundleId } },
              certificates: {
                data: [{ type: "certificates", id: certificate.id }],
              },
              devices: {
                data: devices.map((device) => ({
                  type: "devices",
                  id: device.id,
                })),
              },
            },
          },
        },
      }),
    ).data.attributes;

  const file = `${outDir}/${target.target}.mobileprovision`;
  await Bun.write(file, Buffer.from(created.profileContent, "base64"));
  console.log(
    `${target.profileName} ${created.uuid}: ${devices.length} devices.`,
  );
  return {
    target: target.target,
    bundleIdentifier: target.bundleIdentifier,
    name: target.profileName,
    uuid: created.uuid,
    file,
  };
}

const profiles = [];
for (const target of SIGNING_TARGETS)
  profiles.push(await createProfile(target));

await Bun.write(
  values.summary,
  `${JSON.stringify(
    {
      udids: devices.map((device) => device.udid.toUpperCase()),
      profiles,
    },
    null,
    2,
  )}\n`,
);

const iphones = (await listDevices()).filter(
  (device) =>
    device.deviceClass === undefined || device.deviceClass === "IPHONE",
).length;
console.log(
  `${iphones} of ${DEVICE_YEARLY_CAP} iPhone slots used; the cap is per membership year and disabling a device does not free its slot.`,
);
if (iphones >= DEVICE_YEARLY_CAP - 10) {
  console.log(
    `::warning::${iphones} of ${DEVICE_YEARLY_CAP} iPhone slots are used this membership year.`,
  );
}
