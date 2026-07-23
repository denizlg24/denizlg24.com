import type {
  ApiKey,
  Project,
  ProjectCollection,
  ScheduledTask,
  TaskRun,
  User,
} from "../db/schema";

export type SafeUserRecord = Omit<User, "passwordHash">;
export type SafeApiKeyRecord = Omit<ApiKey, "keyHash">;
export type SafeProjectRecord = Project;
export type SafeProjectCollectionRecord = ProjectCollection;
export type SafeScheduledTaskRecord = ScheduledTask;
export type SafeTaskRunRecord = TaskRun;
