export {
  assertPayloadHash,
  extractS3AccessKeyId,
  normalizeS3HeaderValue,
  requestPayloadHash,
  type S3SigningCredential,
  verifyS3Request,
} from "./auth";
export {
  decryptS3Secret,
  encryptS3Secret,
  ensureLegacyS3Credential,
  hashS3Secret,
  issueS3Credential,
  type ResolvedS3Credential,
  type S3CredentialProvider,
  S3CredentialResolver,
} from "./credentials";
export {
  escapeXml,
  S3Error,
  s3ErrorResponse,
  xmlResponse,
} from "./errors";
export {
  initializeS3,
  type S3ApiConfig,
  s3Routes,
} from "./routes";
export {
  createBucket,
  deleteBucket,
  deleteObject,
  getObjectFile,
  getObjectMetadata,
  headBucket,
  initS3Store,
  listBuckets,
  listObjects,
  putObject,
  type S3StoreConfig,
  validateObjectKey,
} from "./store";
export {
  type CompletedPart,
  decodeXml,
  parseCompletedParts,
  parseDeleteObjects,
} from "./xml";
