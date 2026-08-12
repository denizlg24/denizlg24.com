import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const schema = join(appDirectory, "prisma", "schema.prisma");

// Forge deliberately copies only install manifests before `bun install` so
// that source changes can reuse the dependency layer. In that phase the Prisma
// schema is not present yet. The build script runs `prisma generate` again
// after the complete checkout is copied, so skipping here is both safe and what
// keeps an unrelated workspace postinstall from breaking every monorepo image.
if (!existsSync(schema)) {
  process.stdout.write(
    "[envoy] Prisma schema is outside the install layer; generation deferred to build.\n",
  );
  process.exit(0);
}

const result = spawnSync("bunx", ["prisma", "generate"], {
  cwd: appDirectory,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
