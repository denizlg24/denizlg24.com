import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { Database } from "../../db";
import {
  folders,
  projects,
  type S3Credential,
  s3Credentials,
} from "../../db/schema";
import { NotFoundError } from "../../errors";

export interface ResolvedS3Credential {
  id: string;
  accessKeyId: string;
  secretAccessKey: string;
  projectId: string | null;
  allowedBucket: string | null;
}

export interface S3CredentialProvider {
  resolve(accessKeyId: string): Promise<ResolvedS3Credential | null>;
  markUsed(credentialId: string): void;
}

interface EncryptedSecret {
  encrypted: string;
  iv: string;
  authTag: string;
}

function encryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function hashS3Secret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function encryptS3Secret(
  secret: string,
  keyEncryptionSecret: string,
): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    encryptionKey(keyEncryptionSecret),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptS3Secret(
  encrypted: string,
  iv: string,
  authTag: string,
  keyEncryptionSecret: string,
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(keyEncryptionSecret),
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function newAccessKeyId(): string {
  return `DCS3${randomBytes(12).toString("hex").toUpperCase()}`;
}

function newSecretAccessKey(): string {
  return randomBytes(32).toString("base64url");
}

export async function issueS3Credential(
  db: Database,
  input: {
    projectId: string | null;
    label: string;
    keyEncryptionSecret: string;
  },
): Promise<{ credential: S3Credential; secretAccessKey: string }> {
  const secretAccessKey = newSecretAccessKey();
  const encrypted = encryptS3Secret(secretAccessKey, input.keyEncryptionSecret);
  const [credential] = await db
    .insert(s3Credentials)
    .values({
      projectId: input.projectId,
      accessKeyId: newAccessKeyId(),
      secretAccessKeyHash: hashS3Secret(secretAccessKey),
      encryptedSecretAccessKey: encrypted.encrypted,
      secretIv: encrypted.iv,
      secretAuthTag: encrypted.authTag,
      label: input.label,
    })
    .returning();
  if (!credential) {
    throw new Error("Failed to issue S3 credential");
  }
  return { credential, secretAccessKey };
}

export type ProjectS3CredentialMetadata = Pick<
  S3Credential,
  | "id"
  | "projectId"
  | "accessKeyId"
  | "label"
  | "createdAt"
  | "lastUsedAt"
  | "revokedAt"
>;

export async function listProjectS3Credentials(
  db: Database,
  projectId: string,
): Promise<ProjectS3CredentialMetadata[]> {
  return db
    .select({
      id: s3Credentials.id,
      projectId: s3Credentials.projectId,
      accessKeyId: s3Credentials.accessKeyId,
      label: s3Credentials.label,
      createdAt: s3Credentials.createdAt,
      lastUsedAt: s3Credentials.lastUsedAt,
      revokedAt: s3Credentials.revokedAt,
    })
    .from(s3Credentials)
    .where(eq(s3Credentials.projectId, projectId))
    .orderBy(s3Credentials.createdAt);
}

export async function revokeProjectS3Credential(
  db: Database,
  projectId: string,
  credentialId: string,
): Promise<{ accessKeyId: string }> {
  const [revoked] = await db
    .update(s3Credentials)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(s3Credentials.id, credentialId),
        eq(s3Credentials.projectId, projectId),
      ),
    )
    .returning({ accessKeyId: s3Credentials.accessKeyId });
  if (!revoked) {
    throw new NotFoundError(
      "S3 credential not found",
      "S3_CREDENTIAL_NOT_FOUND",
    );
  }
  return revoked;
}

function assertLegacyCredential(
  credential: Pick<
    S3Credential,
    "accessKeyId" | "projectId" | "secretAccessKeyHash"
  >,
  secretAccessKey: string,
): void {
  if (credential.projectId !== null) {
    throw new Error(
      `Legacy S3 access key ${credential.accessKeyId} is already assigned to a project`,
    );
  }
  if (credential.secretAccessKeyHash !== hashS3Secret(secretAccessKey)) {
    throw new Error(
      `Legacy S3 access key ${credential.accessKeyId} has a different secret`,
    );
  }
}

export async function ensureLegacyS3Credential(
  db: Database,
  input: {
    accessKeyId: string;
    secretAccessKey: string;
    keyEncryptionSecret: string;
  },
): Promise<"created" | "existing"> {
  const existing = await db.query.s3Credentials.findFirst({
    where: eq(s3Credentials.accessKeyId, input.accessKeyId),
  });
  if (existing) {
    assertLegacyCredential(existing, input.secretAccessKey);
    return "existing";
  }

  const encrypted = encryptS3Secret(
    input.secretAccessKey,
    input.keyEncryptionSecret,
  );
  const [created] = await db
    .insert(s3Credentials)
    .values({
      projectId: null,
      accessKeyId: input.accessKeyId,
      secretAccessKeyHash: hashS3Secret(input.secretAccessKey),
      encryptedSecretAccessKey: encrypted.encrypted,
      secretIv: encrypted.iv,
      secretAuthTag: encrypted.authTag,
      label: "Migrated legacy global credential",
    })
    .onConflictDoNothing({ target: s3Credentials.accessKeyId })
    .returning();
  if (created) return "created";

  const concurrent = await db.query.s3Credentials.findFirst({
    where: eq(s3Credentials.accessKeyId, input.accessKeyId),
  });
  if (!concurrent) {
    throw new Error("Failed to migrate the legacy S3 credential");
  }
  assertLegacyCredential(concurrent, input.secretAccessKey);
  return "existing";
}

function allowedBucketForProject(
  slug: string | null,
  storageFolderPath: string | null,
): string | null {
  if (!slug || storageFolderPath !== `/${slug}`) {
    return null;
  }
  return slug;
}

// The resolver is reachable with unauthenticated, attacker-chosen access key
// ids, so the cache must stay bounded and misses must expire fast enough that
// newly issued credentials become visible promptly.
const MAX_CACHE_ENTRIES = 1024;
const NEGATIVE_CACHE_TTL_MS = 5_000;

export class S3CredentialResolver implements S3CredentialProvider {
  readonly #cache = new Map<
    string,
    { expiresAt: number; value: ResolvedS3Credential | null }
  >();

  constructor(
    private readonly db: Database,
    private readonly keyEncryptionSecret: string,
    private readonly cacheTtlMs: number,
  ) {}

  invalidate(accessKeyId?: string): void {
    if (accessKeyId) {
      this.#cache.delete(accessKeyId);
    } else {
      this.#cache.clear();
    }
  }

  async resolve(accessKeyId: string): Promise<ResolvedS3Credential | null> {
    const now = Date.now();
    const cached = this.#cache.get(accessKeyId);
    if (cached && cached.expiresAt > now) {
      this.#cache.delete(accessKeyId);
      this.#cache.set(accessKeyId, cached);
      return cached.value;
    }

    const [record] = await this.db
      .select({
        id: s3Credentials.id,
        accessKeyId: s3Credentials.accessKeyId,
        encryptedSecretAccessKey: s3Credentials.encryptedSecretAccessKey,
        secretIv: s3Credentials.secretIv,
        secretAuthTag: s3Credentials.secretAuthTag,
        projectId: s3Credentials.projectId,
        revokedAt: s3Credentials.revokedAt,
        projectSlug: projects.slug,
        storageFolderPath: folders.path,
      })
      .from(s3Credentials)
      .leftJoin(projects, eq(s3Credentials.projectId, projects.id))
      .leftJoin(folders, eq(projects.storageFolderId, folders.id))
      .where(eq(s3Credentials.accessKeyId, accessKeyId))
      .limit(1);

    let value: ResolvedS3Credential | null = null;
    if (record && record.revokedAt === null) {
      const allowedBucket =
        record.projectId === null
          ? null
          : allowedBucketForProject(
              record.projectSlug,
              record.storageFolderPath,
            );
      if (record.projectId === null || allowedBucket !== null) {
        value = {
          id: record.id,
          accessKeyId: record.accessKeyId,
          secretAccessKey: decryptS3Secret(
            record.encryptedSecretAccessKey,
            record.secretIv,
            record.secretAuthTag,
            this.keyEncryptionSecret,
          ),
          projectId: record.projectId,
          allowedBucket,
        };
      }
    }
    this.#cache.delete(accessKeyId);
    if (this.#cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.#cache.keys().next().value;
      if (oldest !== undefined) {
        this.#cache.delete(oldest);
      }
    }
    this.#cache.set(accessKeyId, {
      expiresAt:
        now +
        (value === null
          ? Math.min(this.cacheTtlMs, NEGATIVE_CACHE_TTL_MS)
          : this.cacheTtlMs),
      value,
    });
    return value;
  }

  markUsed(credentialId: string): void {
    void this.db
      .update(s3Credentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(s3Credentials.id, credentialId))
      .catch((error) => {
        console.error("Failed to update S3 credential last-used time", error);
      });
  }
}
