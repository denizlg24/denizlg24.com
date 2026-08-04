import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

const root = fileURLToPath(new URL(".", import.meta.url));

const target = process.env.EXT_TARGET === "firefox" ? "firefox" : "chrome";
const apiBaseUrl =
  process.env.EXT_API_BASE_URL ?? "https://denizlg24.com/api/admin";
const outDir = process.env.EXT_OUT_DIR ?? `dist/${target}`;
const watching = process.env.EXT_WATCH === "1";

/**
 * Extension pages (popup + options). The background bundle is built separately
 * by scripts/build.ts because it must be one self-contained classic script:
 * Chrome loads it as a service worker and Firefox as an event page, and only a
 * single non-module file is accepted by both without further ceremony.
 */
export default defineConfig({
  root,
  base: "./",
  define: {
    __EXT_TARGET__: JSON.stringify(target),
    __EXT_VERSION__: JSON.stringify(pkg.version),
    __DEFAULT_API_BASE_URL__: JSON.stringify(apiBaseUrl),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir,
    // scripts/build.ts owns emptying the directory; see the note there.
    emptyOutDir: false,
    // The popup has to paint immediately, so shipped builds are minified and
    // carry no sourcemaps; reviewers get the buildable source archive instead
    // (scripts/package.ts).
    minify: true,
    sourcemap: watching,
    target: "es2022",
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL("./popup.html", import.meta.url)),
        options: fileURLToPath(new URL("./options.html", import.meta.url)),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/chunk-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
