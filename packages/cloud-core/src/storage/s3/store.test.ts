import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  createBucket,
  getObjectMetadata,
  initS3Store,
  putObject,
  type S3StoreConfig,
} from "./store";

describe("S3 object store disk contract", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("keeps traversal-looking keys inside the hashed object namespace", async () => {
    root = await mkdtemp(join(tmpdir(), "cloud-s3-store-"));
    const config: S3StoreConfig = {
      rootPath: join(root, "store"),
      tempPath: join(root, "temp"),
      region: "eu-west-1",
    };
    await initS3Store(config);
    await createBucket(config, "path-isolation-test");
    await putObject(
      config,
      "path-isolation-test",
      "../../outside.txt",
      new Request("http://localhost/object", {
        method: "PUT",
        body: "safe",
        headers: { "x-amz-content-sha256": "UNSIGNED-PAYLOAD" },
      }),
    );
    expect(
      (
        await getObjectMetadata(
          config,
          "path-isolation-test",
          "../../outside.txt",
        )
      ).key,
    ).toBe("../../outside.txt");
    await expect(
      stat(join(dirname(config.rootPath), "outside.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
