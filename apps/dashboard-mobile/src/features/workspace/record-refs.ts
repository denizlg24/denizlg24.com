import { type Block, parseEntityRef } from "@repo/schemas";

/** Collect once per document so embeds never make a request per row. */
export function collectRecordRefs(blocks: readonly Block[]): string[] {
  const refs = new Set<string>();
  const pending = [...blocks];
  while (pending.length) {
    const block = pending.pop()!;
    if (block.type === "record" && parseEntityRef(block.ref))
      refs.add(block.ref);
    if ("children" in block) pending.push(...block.children);
  }
  return [...refs].sort();
}
