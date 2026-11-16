// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: credentials and plan are private restore inputs.
const fs = require("node:fs");
const plan = JSON.parse(fs.readFileSync(process.env.DR_MONGO_TTL_PLAN, "utf8"));
const uri = `mongodb://${encodeURIComponent(process.env.DR_MONGO_USER)}:${encodeURIComponent(process.env.DR_MONGO_PASSWORD)}@127.0.0.1:27017/?authSource=admin&replicaSet=rs0`;
const connection = new Mongo(uri);
const admin = connection.getDB("admin");
if (
  admin.runCommand({ getParameter: 1, ttlMonitorEnabled: 1 })
    .ttlMonitorEnabled !== false
) {
  throw new Error("TTL cleanup must be paused before baseline reconciliation");
}
const captured = new Date(plan.capturedAt);
if (!Number.isFinite(captured.getTime()))
  throw new Error("invalid backup timestamp");
const operations = plan.collections.map((item) => {
  const collection = connection
    .getDB(item.database)
    .getCollection(item.collection);
  const index = collection
    .getIndexes()
    .find((candidate) => candidate.name === item.index.name);
  if (
    !index ||
    index.partialFilterExpression ||
    JSON.stringify(index.key) !== JSON.stringify(item.index.key) ||
    index.expireAfterSeconds !== item.index.expireAfterSeconds ||
    !Number.isFinite(index.expireAfterSeconds) ||
    index.expireAfterSeconds < 0
  ) {
    throw new Error(
      "TTL index differs from the signed reference or is unsupported",
    );
  }
  const query = {
    [item.field]: {
      $lte: new Date(captured.getTime() - index.expireAfterSeconds * 1000),
    },
  };
  const remove = item.before - item.expected;
  if (
    remove <= 0 ||
    collection.countDocuments({}) !== item.before ||
    collection.countDocuments(query) !== remove
  ) {
    throw new Error(
      "expired records do not exactly explain the signed baseline difference",
    );
  }
  return { collection, query, remove, expected: item.expected };
});
let expiredDocumentsRemoved = 0;
if (process.env.DR_MONGO_TTL_APPLY === "true") {
  for (const operation of operations) {
    const result = operation.collection.deleteMany(operation.query);
    if (
      result.deletedCount !== operation.remove ||
      operation.collection.countDocuments({}) !== operation.expected
    ) {
      throw new Error(
        "TTL reconciliation did not reach the exact signed count",
      );
    }
    expiredDocumentsRemoved += result.deletedCount;
  }
}
print(
  JSON.stringify({
    snapshotId: plan.snapshotId,
    capturedAt: plan.capturedAt,
    expectedSha256: plan.expectedSha256,
    expiredDocumentsRemoved,
    wouldExpireDocuments: operations.reduce(
      (sum, operation) => sum + operation.remove,
      0,
    ),
  }),
);
