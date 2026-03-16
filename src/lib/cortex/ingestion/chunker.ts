import type { RawChunk, AgentType } from '../knowledge/types';

const MAX_CHUNK_LENGTH = 4000;

export interface SessionMessage {
  role: string;
  content: string;
  timestamp: string;
  hasToolUse?: boolean;
}

export interface ChunkContext {
  sessionId: string;
  workspaceId: number | null;
  agentType: AgentType;
  projectPath: string | null;
}

export function chunkMessages(messages: SessionMessage[], ctx: ChunkContext): RawChunk[] {
  const chunks: RawChunk[] = [];

  // Group messages into turns (human + assistant pairs)
  const turns: SessionMessage[][] = [];
  let current: SessionMessage[] = [];

  for (const msg of messages) {
    if ((msg.role === 'human' || msg.role === 'user') && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) turns.push(current);

  // Process each turn
  for (const turn of turns) {
    const turnText = turn.map(m => `[${m.role}]: ${m.content}`).join('\n\n');
    const timestamp = turn[turn.length - 1].timestamp;

    // Create conversation chunk with code kept inline
    const truncated = turnText.slice(0, MAX_CHUNK_LENGTH);
    if (truncated.trim()) {
      chunks.push({
        text: truncated,
        type: 'conversation',
        layer: 'workspace',
        workspace_id: ctx.workspaceId,
        session_id: ctx.sessionId,
        agent_type: ctx.agentType,
        project_path: ctx.projectPath,
        file_refs: extractFileRefs(turnText),
        source_timestamp: timestamp,
        metadata: {},
      });
    }
  }

  return chunks;
}


function extractFileRefs(text: string): string[] {
  const FILE_REF_REGEX = /(?:^|\s)((?:\.{0,2}\/)?(?:src|lib|tests?|app|bin|config|docs|scripts)\/[\w./-]+\.\w+)/gm;
  const refs = new Set<string>();
  let match;
  while ((match = FILE_REF_REGEX.exec(text)) !== null) {
    refs.add(match[1].trim());
  }
  return Array.from(refs);
}

export { extractFileRefs };
