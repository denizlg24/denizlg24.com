/**
 * Creates App Store provisioning profiles for the app and widget extension.
 * The App Store Connect key is available only in the approved release job.
 *
 *   bun scripts/store-profile.ts --certificate dist.pem \
 *     --out-dir build/profiles --summary build/profile.json
 *
 * Env: APPLE_ASC_KEY_ID, APPLE_ASC_ISSUER_ID, APPLE_ASC_PRIVATE_KEY.
 */
import { mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  type AscCertificate,
  createAscToken,
  findCertificate,
  missingCapabilities,
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

async function asc(
  path: string,
  init: { method?: string; body?: object } = {},
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
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`App Store Connect ${response.status} on ${path}: ${body}`);
  }
  return body ? JSON.parse(body) : null;
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
            attributes: { identifier, name: target.name, platform: "IOS" },
          },
        },
      }),
    ).data.id;
  if (!bundle) console.log(`Created bundle id ${identifier}`);

  // A relationship endpoint, unpaginated: App Store Connect refuses `limit` here.
  const present = await ascList(
    `/v1/bundleIds/${bundleId}/bundleIdCapabilities`,
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

async function createProfile(target: SigningTarget, certificateId: string) {
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
              profileType: "IOS_APP_STORE",
            },
            relationships: {
              bundleId: { data: { type: "bundleIds", id: bundleId } },
              certificates: {
                data: [{ type: "certificates", id: certificateId }],
              },
            },
          },
        },
      }),
    ).data.attributes;

  const file = `${outDir}/${target.target}.mobileprovision`;
  await Bun.write(file, Buffer.from(created.profileContent, "base64"));
  console.log(`${target.profileName} ${created.uuid}`);
  return {
    target: target.target,
    bundleIdentifier: target.bundleIdentifier,
    name: target.profileName,
    uuid: created.uuid,
    file,
  };
}

const certificatePem = await Bun.file(values.certificate).text();
const certificate = await distributionCertificate(certificatePem);
await mkdir(outDir, { recursive: true });
const profiles = [];
for (const target of SIGNING_TARGETS) {
  profiles.push(await createProfile(target, certificate.id));
}
await Bun.write(values.summary, `${JSON.stringify({ profiles }, null, 2)}\n`);
