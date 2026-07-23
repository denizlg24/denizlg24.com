interface WaitableTask {
  waitTask(): Promise<unknown>;
}

interface IndexListClient {
  getIndexes(options: { limit: number }): Promise<{
    results: Array<{ uid: string }>;
  }>;
}

interface CreateIndexClient {
  createIndex(uid: string, options: { primaryKey: string }): WaitableTask;
}

interface DeleteIndexClient {
  deleteIndex(uid: string): WaitableTask;
}

type IndexAdminClient = IndexListClient & DeleteIndexClient;

export function scopedIndexName(
  projectName: string,
  collectionName: string,
): string {
  return `${projectName}_${collectionName}`;
}

export function parseScopedIndexName(
  indexUid: string,
): { project: string; collection: string } | null {
  const separator = indexUid.indexOf("_");
  if (separator === -1) {
    return null;
  }

  return {
    project: indexUid.slice(0, separator),
    collection: indexUid.slice(separator + 1),
  };
}

export async function getProjectIndexes(
  client: IndexListClient,
  projectName: string,
) {
  const prefix = `${projectName}_`;
  const { results } = await client.getIndexes({ limit: 1000 });
  return results.filter((index) => index.uid.startsWith(prefix));
}

export async function createProjectIndex(
  client: CreateIndexClient,
  projectName: string,
  collectionName: string,
  primaryKey = "id",
): Promise<void> {
  const uid = scopedIndexName(projectName, collectionName);
  await client.createIndex(uid, { primaryKey }).waitTask();
}

export async function deleteProjectIndex(
  client: DeleteIndexClient,
  projectName: string,
  collectionName: string,
): Promise<void> {
  const uid = scopedIndexName(projectName, collectionName);
  await client.deleteIndex(uid).waitTask();
}

export async function deleteAllProjectIndexes(
  client: IndexAdminClient,
  projectName: string,
): Promise<void> {
  const indexes = await getProjectIndexes(client, projectName);
  await Promise.all(
    indexes.map((index) => client.deleteIndex(index.uid).waitTask()),
  );
}
