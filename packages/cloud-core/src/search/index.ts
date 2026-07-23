export { createMeiliClient, type MeiliSearch } from "./client";
export {
  createProjectIndex,
  deleteAllProjectIndexes,
  deleteProjectIndex,
  getProjectIndexes,
  parseScopedIndexName,
  scopedIndexName,
} from "./indexes";
export {
  buildFileDocument,
  buildFolderDocument,
  ensureStorageSearchIndex,
  indexStorageDocuments,
  removeStorageDocuments,
  STORAGE_INDEX_UID,
  type StorageSearchDocument,
  type StorageSearchResult,
  searchStorageIndex,
} from "./storage";
export {
  createProjectSearchKey,
  deleteProjectSearchKey,
  generateProjectToken,
  type TenantSearchRules,
  validateSearchRules,
} from "./tokens";
