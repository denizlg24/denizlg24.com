/**
 * Prints what each tool surface costs a model: `bun run scripts/tool-surface.ts`.
 */
import {
  compactOf,
  type ListedTool,
  listProfile,
  sizeOf,
} from "../src/tools/surface-measure.test-util";

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function row(label: string, tools: readonly ListedTool[]) {
  const size = sizeOf(tools);
  console.log(
    `${label.padEnd(28)} ${String(size.tools).padStart(4)} tools  list ${kb(size.listBytes).padStart(9)}  model ${kb(size.modelBytes).padStart(9)}  ≈${size.approxTokens.toLocaleString("en")} tokens`,
  );
}

const full = await listProfile("full");
const compact = await listProfile("compact");

row("full profile", full);
for (const app of ["web", "cloud", "forge", "storage", "status", "catalog"]) {
  row(
    `  ${app}_*`,
    full.filter((tool) => tool.name.startsWith(`${app}_`)),
  );
}
row("compact profile", compact);
row("web per turn (compact of full)", compactOf(full));

console.log("\nLargest in the full profile:");
for (const tool of [...full]
  .sort((a, b) => sizeOf([b]).modelBytes - sizeOf([a]).modelBytes)
  .slice(0, 8)) {
  console.log(`  ${tool.name.padEnd(28)} ${kb(sizeOf([tool]).modelBytes)}`);
}

console.log("\nCompact surface:");
for (const tool of compact) {
  console.log(`  ${tool.name.padEnd(36)} ${kb(sizeOf([tool]).modelBytes)}`);
}
