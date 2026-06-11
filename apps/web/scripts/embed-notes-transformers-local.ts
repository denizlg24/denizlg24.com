import path from "node:path";
import { pathToFileURL } from "node:url";
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { type ILeanNote, Note } from "@/models/Note";
import { NoteEmbedding } from "@/models/NoteEmbedding";
import { type ILeanNoteGroup, NoteGroup } from "@/models/NoteGroup";

const MODEL = "Xenova/multilingual-e5-small";
const DIMENSION = 384;
const BATCH_SIZE = 16;
const DEFAULT_TRANSFORMERS_ENTRY = path.resolve(
  process.cwd(),
  "..",
  "denizlg24-app",
  "node_modules",
  "@xenova",
  "transformers",
  "src",
  "transformers.js",
);

type FeatureExtractionPipeline = (
  text: string,
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array | number[] }>;

function normalizeText(value?: string) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function safeDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function pathForGroup(
  groupId: string,
  groupsById: Map<string, ILeanNoteGroup>,
) {
  const parts: string[] = [];
  let current: ILeanNoteGroup | undefined = groupsById.get(groupId);
  const seen = new Set<string>();

  while (current && !seen.has(String(current._id))) {
    seen.add(String(current._id));
    parts.unshift(current.name);
    current = current.parentId
      ? groupsById.get(String(current.parentId))
      : undefined;
  }

  return parts.join(" > ");
}

function buildSemanticInput(note: ILeanNote, groups: ILeanNoteGroup[]) {
  const groupsById = new Map(groups.map((group) => [String(group._id), group]));
  const groupPaths = (note.groupIds ?? [])
    .map((groupId) => pathForGroup(String(groupId), groupsById))
    .filter(Boolean);
  const domain = note.url ? safeDomain(note.url) : "";

  return [
    `passage: ${normalizeText(note.title)}`,
    normalizeText(note.description),
    normalizeText(note.siteName),
    domain,
    normalizeText(note.content).slice(0, 4000),
    note.tags.length > 0 ? `tags: ${[...note.tags].sort().join(", ")}` : "",
    groupPaths.length > 0 ? `groups: ${groupPaths.join(" | ")}` : "",
    note.class ? `class: ${normalizeText(note.class)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildContentHash(
  note: ILeanNote,
  groups: ILeanNoteGroup[],
  input: string,
) {
  const payload = JSON.stringify({
    model: MODEL,
    title: note.title,
    content: note.content,
    url: note.url,
    description: note.description,
    siteName: note.siteName,
    tags: [...note.tags].sort(),
    groupIds: [...(note.groupIds ?? [])].map(String).sort(),
    class: note.class,
    input,
  });

  return `${hashString(payload)}-${payload.length}`;
}

async function loadExtractor() {
  const modulePath =
    process.env.TRANSFORMERS_ENTRY_PATH ?? DEFAULT_TRANSFORMERS_ENTRY;
  const { env, pipeline } = (await import(pathToFileURL(modulePath).href)) as {
    env: {
      allowLocalModels: boolean;
      allowRemoteModels: boolean;
      cacheDir?: string;
    };
    pipeline: (
      task: "feature-extraction",
      model: string,
    ) => Promise<FeatureExtractionPipeline>;
  };

  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  if (process.env.TRANSFORMERS_CACHE_DIR) {
    env.cacheDir = process.env.TRANSFORMERS_CACHE_DIR;
  }

  return pipeline("feature-extraction", MODEL);
}

async function main() {
  await connectDB();

  const [notes, groups] = await Promise.all([
    Note.find().sort({ createdAt: 1 }).lean<ILeanNote[]>().exec(),
    NoteGroup.find().sort({ name: 1 }).lean<ILeanNoteGroup[]>().exec(),
  ]);
  const extractor = await loadExtractor();

  let embedded = 0;
  for (let index = 0; index < notes.length; index += BATCH_SIZE) {
    const batch = notes.slice(index, index + BATCH_SIZE);

    await Promise.all(
      batch.map(async (note) => {
        const input = buildSemanticInput(note, groups);
        const output = await extractor(input, {
          pooling: "mean",
          normalize: true,
        });
        const vector = Array.from(output.data);

        if (vector.length !== DIMENSION) {
          throw new Error(
            `Expected ${DIMENSION} dimensions for ${note._id}, got ${vector.length}`,
          );
        }

        const contentHash = buildContentHash(note, groups, input);
        await NoteEmbedding.updateOne(
          { noteId: note._id, model: MODEL },
          {
            $set: {
              noteId: note._id,
              model: MODEL,
              dimension: DIMENSION,
              vector,
              contentHash,
              inputTextPreview: input.slice(0, 500),
            },
          },
          { upsert: true },
        );

        await Note.updateOne(
          { _id: note._id },
          {
            $set: {
              semanticStatus: "embedded",
              semanticContentHash: contentHash,
              semanticUpdatedAt: new Date(),
            },
            $unset: { semanticError: "" },
          },
        );
      }),
    );

    embedded += batch.length;
    console.log(`Embedded ${embedded}/${notes.length}`);
  }

  console.log(
    JSON.stringify(
      {
        model: MODEL,
        dimension: DIMENSION,
        embedded,
      },
      null,
      2,
    ),
  );
}

main()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Local transformer embedding failed:", error);
    await mongoose.disconnect();
    process.exit(1);
  });
