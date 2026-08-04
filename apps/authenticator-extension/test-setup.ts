/**
 * Stands in for Vite's `define` when the modules run under `bun test` instead of
 * through a build.
 */

const globals = globalThis as Record<string, unknown>;

globals.__EXT_TARGET__ ??= "chrome";
globals.__EXT_VERSION__ ??= "0.0.0-test";
globals.__DEFAULT_API_BASE_URL__ ??= "https://denizlg24.com/api/admin";
