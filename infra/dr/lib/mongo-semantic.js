// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: mongosh receives these in a private --env-file outside Turborepo.
const uri =
  process.env.DR_MONGO_URI ??
  `mongodb://${encodeURIComponent(process.env.DR_MONGO_USER)}:${encodeURIComponent(process.env.DR_MONGO_PASSWORD)}@127.0.0.1:27017/?authSource=admin&replicaSet=rs0`;
const connection = new Mongo(uri);
const admin = connection.getDB("admin");
const databases = admin
  .adminCommand({ listDatabases: 1 })
  .databases.filter(({ name }) => !["admin", "config", "local"].includes(name))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(({ name }) => {
    const database = connection.getDB(name);
    return {
      name,
      collections: database
        .getCollectionInfos({ type: "collection" })
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ name: collectionName }) => ({
          name: collectionName,
          documents: database.getCollection(collectionName).countDocuments({}),
          indexes: database
            .getCollection(collectionName)
            .getIndexes()
            .map(
              ({
                name: indexName,
                key,
                unique,
                sparse,
                expireAfterSeconds,
              }) => ({
                name: indexName,
                key,
                unique: !!unique,
                sparse: !!sparse,
                expireAfterSeconds: expireAfterSeconds ?? null,
              }),
            )
            .sort((a, b) => a.name.localeCompare(b.name)),
        })),
    };
  });

const roleOrder = (a, b) =>
  `${a.db}.${a.role}`.localeCompare(`${b.db}.${b.role}`);
const canonicalRestrictions = (restrictions = []) =>
  restrictions
    .map(({ clientSource = [], serverAddress = [] }) => ({
      clientSource: [...clientSource].sort(),
      serverAddress: [...serverAddress].sort(),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const canonicalPrivileges = (privileges = []) =>
  privileges
    .map(({ resource, actions = [] }) => ({
      resource: Object.fromEntries(Object.entries(resource ?? {}).sort()),
      actions: [...actions].sort(),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const users = admin
  .runCommand({ usersInfo: { forAllDBs: true }, showCredentials: false })
  .users.map(
    ({
      user,
      db,
      roles,
      mechanisms,
      authenticationRestrictions,
      customData,
    }) => ({
      user,
      db,
      roles: (roles ?? []).sort(roleOrder),
      mechanisms: (mechanisms ?? []).sort(),
      authenticationRestrictions: canonicalRestrictions(
        authenticationRestrictions,
      ),
      customData: customData ?? null,
    }),
  )
  .sort((a, b) => `${a.db}.${a.user}`.localeCompare(`${b.db}.${b.user}`));
const roleDatabases = [
  ...new Set([
    "admin",
    ...admin
      .adminCommand({ listDatabases: 1 })
      .databases.map(({ name }) => name),
  ]),
].sort();
const roles = roleDatabases
  .flatMap(
    (databaseName) =>
      connection.getDB(databaseName).runCommand({
        rolesInfo: 1,
        showPrivileges: true,
        showAuthenticationRestrictions: true,
        showBuiltinRoles: false,
      }).roles,
  )
  .map(
    ({
      role,
      db,
      roles: inheritedRoles,
      privileges,
      authenticationRestrictions,
    }) => ({
      role,
      db,
      roles: (inheritedRoles ?? []).sort(roleOrder),
      privileges: canonicalPrivileges(privileges),
      authenticationRestrictions: canonicalRestrictions(
        authenticationRestrictions,
      ),
    }),
  )
  .sort(roleOrder);

print(JSON.stringify({ databases, users, roles }));
