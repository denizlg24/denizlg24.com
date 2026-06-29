import { rm } from "node:fs/promises";

await rm(".next/dev/types", { force: true, recursive: true });
