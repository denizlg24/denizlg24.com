export {};

const result = await Bun.build({
  entrypoints: ["scripts/worker.ts"],
  outdir: "dist",
  naming: "worker.mjs",
  target: "node",
  format: "esm",
  external: ["next", "next/*"],
  plugins: [
    {
      name: "server-only",
      setup(build) {
        build.onResolve({ filter: /^server-only$/ }, () => ({
          path: "server-only",
          namespace: "stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: "export {};",
          loader: "js",
        }));
      },
    },
  ],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const output = await Bun.file("dist/worker.mjs").text();
const nextImports = [...output.matchAll(/from\s*"(next[^"]*)"/g)].map(
  (match) => match[1],
);
if (nextImports.length) {
  console.error(`The worker must not import Next: ${nextImports.join(", ")}`);
  process.exit(1);
}
console.log(`dist/worker.mjs ${(output.length / 1024 / 1024).toFixed(1)} MB`);
