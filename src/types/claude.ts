// Types matching Claude Code's actual data structures

export interface SessionIndex {
  version: number;
  entries: SessionEntry[];
}

export interface SessionEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}

export type MessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'summary'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'progress'
  | 'bash_progress'
  | 'file-history-snapshot'
  | 'queue-operation';

export interface BaseMessage {
  type: MessageType;
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  isSidechain: boolean;
}

export interface UserMessage extends BaseMessage {
  type: 'user';
  userType: 'external' | 'internal';
  cwd: string;
  version: string;
  gitBranch: string;
  message: {
    role: 'user';
    content: string;
  };
}

export interface ContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text?: string;
  thinking?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string | ContentBlock[];
  tool_use_id?: string;
  is_error?: boolean;
}

export interface AssistantMessage extends BaseMessage {
  type: 'assistant';
  message: {
    model: string;
    id: string;
    type: 'message';
    role: 'assistant';
    content: ContentBlock[];
    stop_reason?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  costUSD?: number;
  durationMs?: number;
}

export interface SummaryMessage {
  type: 'summary';
  summary: string;
  leafUuid: string;
}

export interface SystemMessage extends BaseMessage {
  type: 'system';
  message: {
    role: 'system';
    content: string;
  };
}

export type ParsedMessage = UserMessage | AssistantMessage | SystemMessage | SummaryMessage;

// Stats cache format
export interface StatsCache {
  version: number;
  lastComputedDate: string;
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: Record<string, ModelUsage>;
}

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface DailyModelTokens {
  date: string;
  tokensByModel: Record<string, number>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests?: number;
}

// Spaces internal types
export interface Project {
  id: string;
  name: string;
  path: string;
  claudePath: string;
  sessionCount: number;
  lastActivity: string;
}

export interface SessionWithMeta {
  id: string;
  sessionId: string;
  projectId: string;
  projectName: string;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  fullPath: string;
  starred: boolean;
  customName: string | null;
  notes: string | null;
  tags: string[];
}

export interface Workspace {
  id: number;
  name: string;
  description: string;
  color: string;
  created: string;
  sessionCount?: number;
  isActive?: boolean;
  paneCount?: number;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface SearchResult {
  sessionId: string;
  snippet: string;
  rank: number;
  projectName: string;
  firstPrompt: string;
  created: string;
}

export interface AnalyticsOverview {
  totalSessions: number;
  totalMessages: number;
  totalProjects: number;
  estimatedCost: number;
  modelUsage: Record<string, ModelUsage>;
  recentSessions: SessionWithMeta[];
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
}
