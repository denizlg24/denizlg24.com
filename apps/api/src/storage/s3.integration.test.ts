import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import {
  initializeS3,
  type ResolvedS3Credential,
  type S3CredentialProvider,
  s3Routes,
} from "@repo/cloud-core/storage";
import { Hono } from "hono";

const REGION = "eu-west-1";
const LEGACY_ACCESS_KEY = "DCS3LEGACYTEST";
const LEGACY_SECRET = "legacy-secret-access-key";
const PROJECT_ONE_ACCESS_KEY = "DCS3PROJECTONETEST";
const PROJECT_ONE_SECRET = "project-one-secret";
const PROJECT_TWO_ACCESS_KEY = "DCS3PROJECTTWOTEST";
const PROJECT_TWO_SECRET = "project-two-secret";

class MemoryCredentialProvider implements S3CredentialProvider {
  readonly credentials = new Map<string, ResolvedS3Credential>();
  readonly revoked = new Set<string>();

  async resolve(accessKeyId: string): Promise<ResolvedS3Credential | null> {
    if (this.revoked.has(accessKeyId)) return null;
    return this.credentials.get(accessKeyId) ?? null;
  }

  markUsed(): void {}
}

function client(
  endpoint: string,
  accessKeyId: string,
  secretAccessKey: string,
): S3Client {
  return new S3Client({
    endpoint,
    forcePathStyle: true,
    region: REGION,
    maxAttempts: 1,
    credentials: { accessKeyId, secretAccessKey },
  });
}

describe("S3 /v2 AWS SDK compatibility and project isolation", () => {
  let root: string;
  let endpoint: string;
  let server: ReturnType<typeof Bun.serve>;
  let credentials: MemoryCredentialProvider;
  let legacy: S3Client;
  let projectOne: S3Client;
  let projectTwo: S3Client;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "cloud-s3-api-"));
    credentials = new MemoryCredentialProvider();
    credentials.credentials.set(LEGACY_ACCESS_KEY, {
      id: "10000000-0000-4000-8000-000000000001",
      accessKeyId: LEGACY_ACCESS_KEY,
      secretAccessKey: LEGACY_SECRET,
      projectId: null,
      allowedBucket: null,
    });
    credentials.credentials.set(PROJECT_ONE_ACCESS_KEY, {
      id: "20000000-0000-4000-8000-000000000002",
      accessKeyId: PROJECT_ONE_ACCESS_KEY,
      secretAccessKey: PROJECT_ONE_SECRET,
      projectId: "30000000-0000-4000-8000-000000000003",
      allowedBucket: "project-one",
    });
    credentials.credentials.set(PROJECT_TWO_ACCESS_KEY, {
      id: "40000000-0000-4000-8000-000000000004",
      accessKeyId: PROJECT_TWO_ACCESS_KEY,
      secretAccessKey: PROJECT_TWO_SECRET,
      projectId: "50000000-0000-4000-8000-000000000005",
      allowedBucket: "project-two",
    });
    const config = {
      rootPath: join(root, "objects"),
      tempPath: join(root, "temp"),
      region: REGION,
      credentials,
    };
    await initializeS3(config);
    const app = new Hono();
    app.route("/v2", s3Routes(config));
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: app.fetch,
    });
    endpoint = `http://127.0.0.1:${server.port}/v2`;
    legacy = client(endpoint, LEGACY_ACCESS_KEY, LEGACY_SECRET);
    projectOne = client(endpoint, PROJECT_ONE_ACCESS_KEY, PROJECT_ONE_SECRET);
    projectTwo = client(endpoint, PROJECT_TWO_ACCESS_KEY, PROJECT_TWO_SECRET);
  });

  afterAll(async () => {
    await legacy
      ?.send(
        new DeleteObjectCommand({
          Bucket: "project-two",
          Key: "private.txt",
        }),
      )
      .catch(() => undefined);
    await legacy
      ?.send(new DeleteBucketCommand({ Bucket: "project-one" }))
      .catch(() => undefined);
    await legacy
      ?.send(new DeleteBucketCommand({ Bucket: "project-two" }))
      .catch(() => undefined);
    legacy?.destroy();
    projectOne?.destroy();
    projectTwo?.destroy();
    server?.stop(true);
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("preserves put/get/range/list/delete and multipart wire behavior", async () => {
    await projectOne.send(new CreateBucketCommand({ Bucket: "project-one" }));
    await projectOne.send(
      new PutObjectCommand({
        Bucket: "project-one",
        Key: "folder/hello.txt",
        Body: "hello from sdk",
        ContentType: "text/plain",
      }),
    );
    const object = await projectOne.send(
      new GetObjectCommand({
        Bucket: "project-one",
        Key: "folder/hello.txt",
      }),
    );
    expect(await object.Body?.transformToString()).toBe("hello from sdk");
    const range = await projectOne.send(
      new GetObjectCommand({
        Bucket: "project-one",
        Key: "folder/hello.txt",
        Range: "bytes=6-9",
      }),
    );
    expect(await range.Body?.transformToString()).toBe("from");
    expect(range.ContentRange).toBe("bytes 6-9/14");
    const list = await projectOne.send(
      new ListObjectsV2Command({
        Bucket: "project-one",
        Delimiter: "/",
      }),
    );
    expect(list.CommonPrefixes?.[0]?.Prefix).toBe("folder/");

    const multipart = await projectOne.send(
      new CreateMultipartUploadCommand({
        Bucket: "project-one",
        Key: "multipart.bin",
      }),
    );
    const part = await projectOne.send(
      new UploadPartCommand({
        Bucket: "project-one",
        Key: "multipart.bin",
        UploadId: multipart.UploadId,
        PartNumber: 1,
        Body: new Uint8Array([1, 2, 3]),
      }),
    );
    await projectOne.send(
      new CompleteMultipartUploadCommand({
        Bucket: "project-one",
        Key: "multipart.bin",
        UploadId: multipart.UploadId,
        MultipartUpload: {
          Parts: [{ PartNumber: 1, ETag: part.ETag }],
        },
      }),
    );
    const completed = await projectOne.send(
      new GetObjectCommand({
        Bucket: "project-one",
        Key: "multipart.bin",
      }),
    );
    expect([...((await completed.Body?.transformToByteArray()) ?? [])]).toEqual(
      [1, 2, 3],
    );
    await projectOne.send(
      new DeleteObjectCommand({
        Bucket: "project-one",
        Key: "folder/hello.txt",
      }),
    );
    await projectOne.send(
      new DeleteObjectCommand({
        Bucket: "project-one",
        Key: "multipart.bin",
      }),
    );
  }, 30_000);

  it("prevents project credentials from crossing bucket boundaries", async () => {
    await projectTwo.send(new CreateBucketCommand({ Bucket: "project-two" }));
    await projectTwo.send(
      new PutObjectCommand({
        Bucket: "project-two",
        Key: "private.txt",
        Body: "two",
      }),
    );
    await expect(
      projectOne.send(
        new GetObjectCommand({
          Bucket: "project-two",
          Key: "private.txt",
        }),
      ),
    ).rejects.toMatchObject({ name: "AccessDenied" });
    const visible = await projectOne.send(new ListBucketsCommand({}));
    expect(visible.Buckets?.map((bucket) => bucket.Name)).toEqual([
      "project-one",
    ]);
  });

  it("keeps the NULL-project legacy row unrestricted and rejects revoked keys", async () => {
    const visible = await legacy.send(new ListBucketsCommand({}));
    expect(visible.Buckets?.map((bucket) => bucket.Name)?.sort()).toEqual([
      "project-one",
      "project-two",
    ]);
    credentials.revoked.add(PROJECT_ONE_ACCESS_KEY);
    await expect(
      projectOne.send(new ListBucketsCommand({})),
    ).rejects.toMatchObject({ name: "InvalidAccessKeyId" });
    credentials.revoked.delete(PROJECT_ONE_ACCESS_KEY);
  });
});
