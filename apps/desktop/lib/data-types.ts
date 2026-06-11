export interface IBlog {
  _id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  timeToRead: number;
  media?: string[];
  tags?: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IBlogComment {
  _id: string;
  blogId: string;
  commentId?: string;
  authorName: string;
  content: string;
  sessionId?: string;
  isApproved: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IBlogView {
  _id: string;
  blogId: string;
  views: number;
  createdAt: string;
  updatedAt: string;
}

export interface ICalendarEvent {
  _id: string;
  date: string;
  calendarDate: string;
  isAllDay: boolean;
  kind: "manual" | "holiday" | "birthday";
  source?: {
    provider: "nager-date" | "people";
    providerKey: string;
    countryCode?: string;
    personId?: string;
    generatedYear?: number;
    isCustomized: boolean;
    isSuppressed: boolean;
    metadata?: Record<string, unknown>;
  };
  title: string;
  place?: string;
  links: {
    _id: string;
    label: string;
    icon?: string;
    url: string;
  }[];
  status: "scheduled" | "completed" | "canceled";
  notifyBySlack: boolean;
  isNotificationSent: boolean;
  notifyBeforeMinutes: number;
  notifyAt?: string;
}

export interface ICalendarSettings {
  _id: "singleton";
  holidayCountryCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ICountryOption {
  countryCode: string;
  name: string;
}

export interface IContact {
  _id: string;
  ticketId: string;
  name: string;
  email: string;
  message: string;
  ipAddress: string;
  userAgent: string;
  status: "pending" | "read" | "responded" | "archived";
  emailSent: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IEmail {
  _id: string;
  accountId: string;
  messageId: string;
  subject: string;
  from: { name: string | undefined; address: string }[];
  date: string;
  seen: boolean;
  uid: number;
}

export interface IEmailAccount {
  _id: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  imapPassword: {
    ciphertext: string;
    iv: string;
    authTag: string;
  };
  inboxName: string;
  lastUid: number;
  emails?: IEmail[];
}

export interface IFullEmail extends IEmail {
  textBody?: string;
  htmlBody?: string;
}

export interface IEmailAttachment {
  index: number;
  filename: string;
  contentType: string;
  size: number;
}

export interface INote {
  _id: string;
  title: string;
  content: string;
  url?: string;
  description?: string;
  siteName?: string;
  favicon?: string;
  image?: string;
  publishedDate?: string;
  tags: string[];
  groupIds: string[];
  manualGroupIds?: string[];
  status: "open" | "archived";
  class?: string;
  semanticKeywords?: string[];
  semanticSummary?: string;
  semanticModel?: string;
  semanticStatus?: "pending" | "embedded" | "stale" | "failed";
  semanticContentHash?: string;
  semanticUpdatedAt?: string;
  semanticError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface INoteGroup {
  _id: string;
  name: string;
  description?: string;
  color?: string;
  parentId?: string | null;
  autoCreated: boolean;
  kind?: "manual" | "generated" | "system";
  source?: "user" | "llm" | "semantic" | "migration";
  lockedByUser?: boolean;
  semanticRunId?: string;
  semanticClusterKey?: string;
  confidence?: number;
  aliases?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface INoteEdge {
  _id: string;
  from: string;
  to: string;
  strength: number;
  reason?: string;
  source?: "manual" | "llm" | "semantic" | "migration";
  model?: string;
  runId?: string;
  metadata?: {
    similarity?: number;
    sharedGroupIds?: string[];
    explanation?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface INoteGraph {
  notes: INote[];
  groups: INoteGroup[];
  edges: INoteEdge[];
  stats: {
    total: number;
    groups: number;
    edges: number;
    semanticPending?: number;
    semanticStale?: number;
    suggestionsPending?: number;
  };
  semantic?: {
    latestRun?: {
      _id: string;
      status: "running" | "completed" | "failed";
      model: string;
      completedAt?: string;
      edgeCount: number;
      clusterCount: number;
    };
  };
}

export interface ISemanticRun {
  _id: string;
  status: "running" | "completed" | "failed";
  model: string;
  initiatedBy: "desktop" | "script";
  noteCount: number;
  embeddedCount: number;
  staleCount: number;
  edgeCount: number;
  clusterCount: number;
  parameters: {
    topK: number;
    minSimilarity: number;
    strongSimilarity: number;
    clusterMinSize: number;
    maxGroupsPerNote: number;
  };
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface ISemanticSuggestion {
  _id: string;
  runId: string;
  type:
    | "join-group"
    | "create-group"
    | "rename-group"
    | "move-group"
    | "add-tags"
    | "add-edge"
    | "archive-edge"
    | "cluster-label";
  status: "pending" | "accepted" | "dismissed" | "superseded";
  noteId?: string;
  groupId?: string;
  targetGroupId?: string;
  proposedParentId?: string | null;
  proposedName?: string;
  proposedDescription?: string;
  proposedTags?: string[];
  proposedRelatedNoteIds?: string[];
  confidence: number;
  reason: string;
  source: "semantic" | "llm-label";
  createdAt: string;
  updatedAt: string;
}

export interface BirthdayParts {
  month: number;
  day: number;
  year?: number | null;
}

export interface IPersonSocial {
  platform: string;
  handle: string;
  url?: string;
}

export interface IPerson {
  _id: string;
  name: string;
  birthday?: BirthdayParts | null;
  placeMet?: string;
  notes: string;
  photos: string[];
  groupIds: string[];
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  socials: IPersonSocial[];
  createdAt: string;
  updatedAt: string;
}

export interface IPersonGroup {
  _id: string;
  name: string;
  description?: string;
  color?: string;
  parentId?: string | null;
  autoCreated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IPersonEdge {
  _id: string;
  from: string;
  to: string;
  strength: number;
  reason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IPersonGraph {
  people: IPerson[];
  groups: IPersonGroup[];
  edges: IPersonEdge[];
  stats: { total: number; groups: number; edges: number };
}

export interface INowPage {
  _id: string;
  content: string;
  updatedAt: string;
  createdAt: string;
}

export interface IProject {
  _id: string;
  title: string;
  subtitle: string;
  images: string[];
  media?: string[];
  links: {
    _id: string;
    label: string;
    url: string;
    icon: "external" | "github" | "notepad";
  }[];
  markdown: string;
  tags: string[];
  isActive: boolean;
  isFeatured: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface ITimelineItem {
  _id: string;
  title: string;
  subtitle: string;
  logoUrl?: string;
  dateFrom: string;
  dateTo?: string;
  topics: string[];
  category: "work" | "education" | "personal";
  order: number;
  links?: {
    label: string;
    url: string;
    icon: "external" | "github" | "notepad";
  }[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const TIMETABLE_COLORS = [
  "background",
  "surface",
  "muted",
  "accent",
  "accent-strong",
  "foreground",
  "destructive",
] as const;

export type TimetableColor = (typeof TIMETABLE_COLORS)[number];

export interface ITimetableEntry {
  _id: string;
  title: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  place?: string;
  links: {
    _id: string;
    label: string;
    url: string;
    icon?: string;
  }[];
  color: TimetableColor;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IWhiteboardElement {
  id: string;
  type: "drawing" | "component";
  componentType?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  data: Record<string, unknown>;
  zIndex: number;
}

export interface IWhiteboard {
  _id: string;
  name: string;
  elements: IWhiteboardElement[];
  viewState: { x: number; y: number; zoom: number };
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface IWhiteboardMeta {
  _id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface IKanbanBoard {
  _id: string;
  title: string;
  description?: string;
  color?: string;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type KanbanPriority = "none" | "low" | "medium" | "high" | "urgent";
export interface IKanbanCard {
  _id: string;
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  order: number;
  labels: string[];
  priority: KanbanPriority;
  dueDate?: Date;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IKanbanColumn {
  _id: string;
  boardId: string;
  title: string;
  color?: string;
  icon?: string;
  order: number;
  wipLimit?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgentServiceMetrics {
  cpuUsagePercent: number | null;
  memoryUsagePercent: number | null;
  diskUsagePercent: number | null;
}

export interface IAgentService {
  enabled: boolean;
  nodeId: string;
  lastCheckedAt: string | null;
  lastStatus: "healthy" | "degraded" | "unreachable" | null;
  lastMetrics: IAgentServiceMetrics | null;
}

export interface ICapability {
  _id: string;
  type: string;
  label: string;
  baseUrl: string;
  config: Record<string, unknown>;
  isActive: boolean;
}

export interface IResource {
  _id: string;
  name: string;
  description: string;
  url: string;
  type: "pi" | "vps" | "api" | "service";
  isActive: boolean;
  agentService: IAgentService;
  capabilities: ICapability[];
  uptime: ResourceUptimeData | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyUptimeEntry {
  date: string;
  totalChecks: number;
  healthyChecks: number;
  avgResponseTimeMs: number | null;
  status: "up" | "degraded" | "down" | "unknown";
}

export interface ResourceUptimeData {
  resourceId: string;
  uptimePercentage: number;
  dailyHistory: DailyUptimeEntry[];
}

export interface ISubResourceHttpCheck {
  type: "http";
  url: string;
  expectStatus: number | null;
  expectJsonPath: string | null;
  expectEquals: string | null;
}

export interface ISubResourceTcpCheck {
  type: "tcp";
  host: string;
  port: number;
}

export type SubResourceCheck = ISubResourceHttpCheck | ISubResourceTcpCheck;

export interface ISubResource {
  _id: string;
  parentResourceId: string;
  name: string;
  description: string;
  isActive: boolean;
  isPublic: boolean;
  check: SubResourceCheck;
  lastCheckedAt: string | null;
  lastStatus: "healthy" | "unhealthy" | null;
  lastResponseTimeMs: number | null;
  uptime: ResourceUptimeData | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface PiCronJob {
  id: string;
  name: string;
  expression: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  enabled: boolean;
  timeout: number;
  created_at: string;
  updated_at: string;
  last_status: number | null;
  last_run: string | null;
  last_error: string | null;
  next_run: string | null;
}

export interface PiCronStats {
  total_jobs: number;
  active_jobs: number;
  total_executions: number;
  failed_executions_24h: number;
}

export interface PiCronHistoryEntry {
  id: string;
  job_id: string;
  status: number;
  duration_ms: number;
  response: string;
  error: string;
  started_at: string;
}

export interface ILlmUsage {
  _id: string;
  llmModel: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  systemPrompt: string;
  userPrompt: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

export type IChatContentSegment =
  | { type: "text"; text: string }
  | { type: "tool_group"; calls: IChatToolCall[] };

export interface IChatAttachment {
  id: string;
  file: File;
  name: string;
  type: "image" | "pdf";
  previewUrl?: string;
  uploadedUrl?: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

export interface IChatMessageAttachment {
  type: "image" | "pdf";
  url: string;
  name: string;
}

export interface IChatClientToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export interface IChatMessage {
  role: "user" | "assistant";
  content: string | unknown[];
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
  toolCalls?: IChatToolCall[];
  segments?: IChatContentSegment[];
  pendingActions?: IChatPendingAction[];
  clientToolResults?: IChatClientToolResult[];
  error?: string;
  attachments?: IChatMessageAttachment[];
  createdAt: string;
}

export interface IChatToolCall {
  toolId: string;
  toolName: string;
  input: unknown;
  result?: string;
  isError?: boolean;
  status: "calling" | "done" | "error" | "pending_approval";
}

export interface IChatPendingAction {
  toolId: string;
  toolName: string;
  input: unknown;
  status: "pending" | "approved" | "denied";
}

export interface IConversation {
  _id: string;
  title: string;
  llmModel: string;
  messages: IChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface IConversationMeta {
  _id: string;
  title: string;
  llmModel: string;
  updatedAt: string;
}
export interface IJournalLog {
  _id: string;
  date: Date;
  content: string;
  whiteboard?: IWhiteboard;
  events: ICalendarEvent[];
  notes: string[];
}

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface IAuthenticatorAccount {
  _id: string;
  label: string;
  issuer: string;
  accountName: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  createdAt: string;
  updatedAt: string;
}

export interface IAuthenticatorCode {
  _id: string;
  code: string;
  period: number;
  remaining: number;
}

export interface ISpreadsheet {
  _id: string;
  title: string;
  description?: string;
  tags: string[];
  pinataHash: string;
  pinataFileId?: string;
  pinataUrl: string;
  sizeBytes: number;
  sheetCount: number;
  rowCount: number;
  colCount: number;
  lastOpenedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FortuneSheetCellValue {
  v?: string | number | boolean | null;
  m?: string;
  ct?: { fa?: string; t?: string };
  bg?: string;
  fc?: string;
  ff?: string | number;
  fs?: number;
  bl?: number;
  it?: number;
  cl?: number;
  un?: number;
  ht?: number;
  vt?: number;
  tb?: string;
  mc?: { r: number; c: number; rs?: number; cs?: number };
}

export interface FortuneSheetCellData {
  r: number;
  c: number;
  v: FortuneSheetCellValue | null;
}

export interface FortuneSheet {
  name: string;
  celldata?: FortuneSheetCellData[];
  row?: number;
  column?: number;
  order?: number;
  status?: number;
  config?: {
    merge?: Record<string, { r: number; c: number; rs: number; cs: number }>;
    rowlen?: Record<string, number>;
    columnlen?: Record<string, number>;
    rowhidden?: Record<string, number>;
    colhidden?: Record<string, number>;
  };
}

export type FortuneSheetBook = FortuneSheet[];

export interface IDashboardStats {
  contacts: {
    total: number;
    unread: number;
    recent: Array<{
      _id: string;
      name: string;
      email: string;
      createdAt: string;
      status: string;
    }>;
  };
  projects: {
    total: number;
    featured: number;
  };
  blogs: {
    total: number;
    published: number;
  };
  calendar: {
    todayEvents: number;
    upcomingEvents: number;
    events: Array<{
      _id: string;
      title: string;
      date: string;
      status: string;
    }>;
  };
  comments: {
    total: number;
    pending: number;
  };
  timetable: Array<{
    _id: string;
    title: string;
    startTime: string;
    endTime: string;
    place?: string;
    color: string;
  }>;
  resources: Array<{
    _id: string;
    name: string;
    type: string;
    status: "healthy" | "degraded" | "unreachable" | null;
    lastCheckedAt: string | null;
  }>;
  emails: {
    total: number;
    unread: number;
  };
  triage: {
    actionRequired: number;
  };
  notes: {
    total: number;
    recent: Array<{
      _id: string;
      title: string;
      updatedAt: string;
    }>;
  };
  llm: {
    todayCost: number;
    todayRequests: number;
    todayInputTokens: number;
    todayOutputTokens: number;
  };
}

export type TriageCategory =
  | "spam"
  | "newsletter"
  | "promo"
  | "purchases"
  | "fyi"
  | "action-needed"
  | "scheduled";

export type TriageSuggestionStatus = "pending" | "accepted" | "dismissed";
export type TriagePriority = "none" | "low" | "medium" | "high" | "urgent";

export interface ITriageTaskSuggestion {
  _id: string;
  title: string;
  description?: string;
  priority: TriagePriority;
  dueDate?: string;
  kanbanBoardId?: string;
  kanbanBoardTitle?: string;
  kanbanColumnId?: string;
  kanbanColumnTitle?: string;
  status: TriageSuggestionStatus;
  acceptedCardId?: string;
}

export interface ITriageEventSuggestion {
  _id: string;
  title: string;
  date: string;
  place?: string;
  status: TriageSuggestionStatus;
  acceptedEventId?: string;
}

export interface IEmailTriage {
  _id: string;
  emailId: string;
  accountId: string;
  stage: "prefilter" | "full";
  category: TriageCategory;
  confidence: number;
  summary?: string;
  suggestedTasks: ITriageTaskSuggestion[];
  suggestedEvents: ITriageEventSuggestion[];
  userStatus: "pending" | "reviewed" | "archived";
  modelUsed: string;
  triagedAt: string;
  email: {
    subject: string;
    from: { name?: string; address: string }[];
    date: string;
    threadId?: string;
  } | null;
}

export interface ITriageCategoryRouting {
  autoCreateCard: boolean;
  autoAcceptThreshold: number;
}

export interface ITriageSettings {
  _id: string;
  enabled: boolean;
  runIntervalMinutes: number;
  prefilterModel: string;
  fullModel: string;
  categoryRouting: Record<TriageCategory, ITriageCategoryRouting>;
  lastRunAt?: string;
}
