export interface MetadataServiceConfig {
  namespaceRoot: string;
  socketGid: number;
  socketPath: string;
  token: string;
  witnessPath: string;
  witnessValue: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/**
 * The service refuses to start without a witness, because the failure it is
 * guarding against is starting against an unmounted namespace: an empty host
 * directory would let it answer NOT_FOUND for every entry, which a projector
 * could read as mass deletion.
 */
export function configFromEnv(): MetadataServiceConfig {
  const namespaceRoot = required("STORAGE_NAMESPACE_ROOT");
  if (!namespaceRoot.startsWith("/")) {
    throw new Error("STORAGE_NAMESPACE_ROOT must be absolute");
  }
  const socketPath = required("STORAGE_METADATA_SOCKET");
  if (!socketPath.startsWith("/")) {
    throw new Error("STORAGE_METADATA_SOCKET must be absolute");
  }
  const token = required("STORAGE_METADATA_TOKEN");
  if (token.length < 16) {
    throw new Error("STORAGE_METADATA_TOKEN must be at least 16 characters");
  }
  const rawGid = process.env.STORAGE_METADATA_SOCKET_GID ?? "1000";
  const socketGid = Number(rawGid);
  if (!Number.isInteger(socketGid) || socketGid < 0) {
    throw new Error(
      "STORAGE_METADATA_SOCKET_GID must be a non-negative integer",
    );
  }
  return {
    namespaceRoot,
    socketGid,
    socketPath,
    token,
    witnessPath: required("STORAGE_NAMESPACE_WITNESS_PATH_HOST"),
    witnessValue: required("STORAGE_NAMESPACE_WITNESS_VALUE"),
  };
}
