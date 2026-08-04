/**
 * Builds one loadable extension directory per browser.
 *
 * Three artifacts have to line up: the page bundles (Vite MPA), the background
 * bundle (one classic script, see below) and a generated manifest. Running them
 * from a single script keeps the manifest honest about what was emitted.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type InlineConfig } from "vite";
import { generateIcons } from "./generate-icons.ts";
import {
  buildManifest,
  type ExtensionTarget,
  toMatchPattern,
} from "./manifest.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface BuildOptions {
  target: ExtensionTarget;
  apiBaseUrl: string;
  outDir: string;
  watch: boolean;
}

function parseArgs(argv: string[]): BuildOptions {
  const flag = (name: string) =>
    argv
      .find((arg) => arg.startsWith(`--${name}=`))
      ?.slice(name.length + 3)
      .trim();

  const target = flag("target") === "firefox" ? "firefox" : "chrome";

  return {
    target,
    apiBaseUrl:
      flag("api-base-url") ??
      process.env.EXT_API_BASE_URL ??
      "https://denizlg24.com/api/admin",
    outDir: flag("out-dir") ?? `dist/${target}`,
    watch: argv.includes("--watch"),
  };
}

/**
 * The background bundle is deliberately a standalone IIFE. Chrome runs it as an
 * MV3 service worker and Firefox as an event page; a single classic script is
 * the one shape both accept without module-loading differences, and it also
 * means the background never depends on the page chunks.
 */
function backgroundConfig(
  options: BuildOptions,
  version: string,
): InlineConfig {
  return {
    configFile: false,
    root: ROOT,
    define: {
      __EXT_TARGET__: JSON.stringify(options.target),
      __EXT_VERSION__: JSON.stringify(version),
      __DEFAULT_API_BASE_URL__: JSON.stringify(options.apiBaseUrl),
    },
    resolve: {
      alias: { "@": resolve(ROOT, "src") },
    },
    build: {
      outDir: options.outDir,
      emptyOutDir: false,
      minify: true,
      sourcemap: options.watch,
      target: "es2022",
      copyPublicDir: false,
      lib: {
        entry: resolve(ROOT, "src/background/index.ts"),
        formats: ["iife"],
        name: "AuthenticatorBackground",
        fileName: () => "background.js",
      },
      watch: options.watch ? {} : null,
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pkg = (await import("../package.json", { with: { type: "json" } })) as {
    default: { version: string };
  };
  const version = pkg.default.version;

  generateIcons();

  process.env.EXT_TARGET = options.target;
  process.env.EXT_API_BASE_URL = options.apiBaseUrl;
  process.env.EXT_OUT_DIR = options.outDir;
  process.env.EXT_WATCH = options.watch ? "1" : "0";

  // Emptied here rather than by Vite: the pages build would otherwise wipe
  // background.js and manifest.json on every rebuild in watch mode.
  const outDir = resolve(ROOT, options.outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  await build({
    configFile: resolve(ROOT, "vite.config.ts"),
    build: { emptyOutDir: false, watch: options.watch ? {} : null },
  });

  await build(backgroundConfig(options, version));

  const manifest = buildManifest({
    target: options.target,
    version,
    apiOrigin: toMatchPattern(options.apiBaseUrl),
  });

  writeFileSync(
    resolve(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(
    `Built ${options.target} extension v${version} → ${options.outDir}`,
  );
  if (options.watch) console.log("Watching for changes…");
}

await main();
