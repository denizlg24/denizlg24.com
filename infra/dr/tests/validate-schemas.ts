import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

const root = join(import.meta.dir, "..");
const schemaDirectory = join(root, "schemas");
const fixtureDirectory = join(import.meta.dir, "fixtures");
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const schemaFiles = (await readdir(schemaDirectory))
  .filter((name) => name.endsWith(".schema.json"))
  .sort();

if (schemaFiles.length === 0) throw new Error("No DR schemas found");

for (const schemaFile of schemaFiles) {
  const name = schemaFile.replace(/\.schema\.json$/, "");
  const schema = JSON.parse(
    await readFile(join(schemaDirectory, schemaFile), "utf8"),
  );
  const document = JSON.parse(
    await readFile(join(fixtureDirectory, `${name}.valid.json`), "utf8"),
  );
  const validate = ajv.compile(schema);
  if (!validate(document)) {
    throw new Error(
      `${basename(schemaFile)} rejected its valid fixture: ${ajv.errorsText(validate.errors)}`,
    );
  }

  const wrongVersion = { ...document, schemaVersion: 999 };
  if (validate(wrongVersion)) {
    throw new Error(`${basename(schemaFile)} accepted a wrong schema version`);
  }

  for (const required of schema.required as string[]) {
    const missingRequired = structuredClone(document);
    delete missingRequired[required];
    if (validate(missingRequired)) {
      throw new Error(
        `${basename(schemaFile)} accepted missing required field ${required}`,
      );
    }
  }

  if (schema.additionalProperties === false) {
    const unexpectedProperty = {
      ...structuredClone(document),
      __unexpectedDrContractField: true,
    };
    if (validate(unexpectedProperty)) {
      throw new Error(
        `${basename(schemaFile)} accepted an unexpected top-level field`,
      );
    }
  }

  if (name === "ready-manifest" || name === "completion-manifest") {
    const mismatchedProfile = {
      ...structuredClone(document),
      profile: "forge",
    };
    if (validate(mismatchedProfile)) {
      throw new Error(
        `${basename(schemaFile)} accepted a profile that disagrees with its host`,
      );
    }

    const duplicateObject = structuredClone(document);
    duplicateObject.objects.push(structuredClone(duplicateObject.objects[0]));
    if (validate(duplicateObject)) {
      throw new Error(
        `${basename(schemaFile)} accepted a duplicate repository object`,
      );
    }
  }

  if (name === "snapshot-manifest") {
    const mismatchedProfile = {
      ...structuredClone(document),
      profile: "forge",
    };
    if (validate(mismatchedProfile)) {
      throw new Error(
        `${basename(schemaFile)} accepted a profile that disagrees with its host`,
      );
    }

    const unsafeArtifact = structuredClone(document);
    unsafeArtifact.artifacts[0].path = "artifacts/../recovery-secret";
    if (validate(unsafeArtifact)) {
      throw new Error(
        `${basename(schemaFile)} accepted an unsafe artifact path`,
      );
    }

    const wrongFootprint = structuredClone(document);
    wrongFootprint.restoreFootprint[0].method = "restored-files";
    if (validate(wrongFootprint)) {
      throw new Error(
        `${basename(schemaFile)} accepted a mismatched restore-footprint method`,
      );
    }

    const forge = structuredClone(document);
    forge.host = "forge";
    forge.profile = "forge";
    forge.snapshotId = "forge-20260831T100000Z";
    forge.images[0].deploymentId = "11111111-1111-4111-8111-111111111111";
    forge.images[0].domain = "app.denizlg24.com";
    forge.images[0].platform = "linux/amd64";
    forge.images[0].environmentHmacSha256 = "e".repeat(64);
    forge.images[0].environmentCipher = {
      encrypted: "encrypted-value",
      iv: "nonce",
      authTag: "authentication-tag",
    };
    forge.forgeControlPlane = [
      {
        deploymentId: forge.images[0].deploymentId,
        imageReference: forge.images[0].reference,
        imageDigest: forge.images[0].digest,
        hostname: forge.images[0].domain,
      },
    ];
    forge.restoreFootprint = document.restoreFootprint.filter(
      (entry: { component: string }) =>
        entry.component === "config" || entry.component === "recovery-host",
    );
    forge.totals.restoredBytes = forge.restoreFootprint.reduce(
      (total: number, entry: { bytes: number }) => total + entry.bytes,
      0,
    );
    if (!validate(forge)) {
      throw new Error(
        `${basename(schemaFile)} rejected its Forge environment fingerprint contract: ${ajv.errorsText(validate.errors)}`,
      );
    }
    delete forge.images[0].environmentHmacSha256;
    if (validate(forge)) {
      throw new Error(
        `${basename(schemaFile)} accepted a Forge image without an environment fingerprint`,
      );
    }
    forge.images[0].environmentHmacSha256 = "e".repeat(64);
    delete forge.images[0].environmentCipher;
    if (validate(forge)) {
      throw new Error(
        `${basename(schemaFile)} accepted a Forge image without encrypted recovery environment`,
      );
    }
    forge.images[0].environmentCipher = {
      encrypted: "encrypted-value",
      iv: "nonce",
      authTag: "authentication-tag",
    };
    delete forge.forgeControlPlane[0].hostname;
    if (validate(forge)) {
      throw new Error(
        `${basename(schemaFile)} accepted an incomplete Forge control-plane pairing inventory`,
      );
    }
  }

  if (name === "rehearsal-report") {
    const missedRpo = structuredClone(document);
    missedRpo.objectives.rpoMet = false;
    if (validate(missedRpo)) {
      throw new Error(
        `${basename(schemaFile)} accepted a passed rehearsal that missed its RPO`,
      );
    }

    const missingMetrics = structuredClone(document);
    missingMetrics.objectives.resourceMetrics = null;
    if (validate(missingMetrics)) {
      throw new Error(
        `${basename(schemaFile)} accepted a passed rehearsal without resource measurements`,
      );
    }

    const invalidMetrics = structuredClone(document);
    invalidMetrics.objectives.resourceMetrics.samples = 0;
    if (validate(invalidMetrics)) {
      throw new Error(
        `${basename(schemaFile)} accepted invalid rehearsal resource measurements`,
      );
    }

    const missingFailure = structuredClone(document);
    missingFailure.result = "failed";
    missingFailure.failure = null;
    if (validate(missingFailure)) {
      throw new Error(
        `${basename(schemaFile)} accepted failed evidence without a failure record`,
      );
    }

    const secondWithoutClone = structuredClone(document);
    secondWithoutClone.rehearsal = 2;
    secondWithoutClone.freshClone = null;
    if (validate(secondWithoutClone)) {
      throw new Error(
        `${basename(schemaFile)} accepted rehearsal 2 without a fresh clone`,
      );
    }
  }

  if (name === "recovery-report") {
    const missingMetrics = structuredClone(document);
    missingMetrics.resourceMetrics = null;
    if (validate(missingMetrics)) {
      throw new Error(
        `${basename(schemaFile)} accepted a completed recovery without resource measurements`,
      );
    }

    const invalidMetrics = structuredClone(document);
    invalidMetrics.resourceMetrics.physicalInterfaceCount = 0;
    if (validate(invalidMetrics)) {
      throw new Error(
        `${basename(schemaFile)} accepted invalid recovery resource measurements`,
      );
    }
  }
}

console.log(
  `Validated ${schemaFiles.length} DR schemas, every required field, and closed top-level shapes`,
);
