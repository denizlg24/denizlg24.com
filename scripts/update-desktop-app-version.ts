import path from "path";

const tauriConfFile = path.join(
  __dirname,
  "..",
  "apps",
  "desktop",
  "src-tauri",
  "tauri.conf.json",
);
const cargoTomlFile = path.join(
  __dirname,
  "..",
  "apps",
  "desktop",
  "src-tauri",
  "Cargo.toml",
);
const cargoLockFile = path.join(
  __dirname,
  "..",
  "apps",
  "desktop",
  "src-tauri",
  "Cargo.lock",
);

const cargoSearchString = 'name = "denizlg24"';

function updateVersionInTauriConf(newVersion: string) {
  const tauriConf = require(tauriConfFile);
  tauriConf.version = newVersion;
  const fs = require("fs");
  fs.writeFileSync(tauriConfFile, JSON.stringify(tauriConf, null, 2));
}

function updateVersionInCargo(newVersion: string, cargoFile: string) {
  const fs = require("fs");
  const cargoLockContent = fs.readFileSync(cargoFile, "utf-8");
  const lines = cargoLockContent.split("\n");
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(cargoSearchString)) {
      if (i + 1 < lines.length && lines[i + 1].trim().startsWith("version")) {
        lines[i + 1] = `version = "${newVersion}"`;
        found = true;
        break;
      }
    }
  }
  if (found) {
    fs.writeFileSync(cargoFile, lines.join("\n"));
  }
}

const bumpVersion = (prevVersion: string, versionBump: string): string => {
  const [major, minor, patch] = prevVersion.split(".").map(Number);
  switch (versionBump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid version bump: ${versionBump}`);
  }
};

function main() {
  const prevVersion = require(tauriConfFile).version;

  const versionBump = process.argv[2];
  if (!versionBump) {
    console.error("Please provide a version bump as an argument.");
    process.exit(1);
  }

  const newVersion = bumpVersion(prevVersion, versionBump);

  updateVersionInTauriConf(newVersion);
  updateVersionInCargo(newVersion, cargoTomlFile);
  updateVersionInCargo(newVersion, cargoLockFile);

  console.log(
    `Updated version from ${prevVersion} to ${newVersion} in tauri.conf.json, Cargo.toml, and Cargo.lock`,
  );
}

main();
