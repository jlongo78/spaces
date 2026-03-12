import type { RawChunk, AgentType } from '../knowledge/types';

const MAX_CHUNK_LENGTH = 4000;
const CODE_BLOCK_REGEX = /```(\w+)?\n([\s\S]*?)```/g;

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
    if (msg.role === 'human' && current.length > 0) {
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

    // Extract and chunk code blocks
    const codeBlocks = extractCodeBlocks(turnText);
    for (const block of codeBlocks) {
      chunks.push({
        text: block.code,
        type: 'code_pattern',
        layer: 'workspace',
        workspace_id: ctx.workspaceId,
        session_id: ctx.sessionId,
        agent_type: ctx.agentType,
        project_path: ctx.projectPath,
        file_refs: extractFileRefs(turnText),
        source_timestamp: timestamp,
        metadata: { language: block.language },
      });
    }

    // Create conversation chunk from non-code text
    const textWithoutCode = turnText.replace(CODE_BLOCK_REGEX, '[code block]');
    const truncated = textWithoutCode.slice(0, MAX_CHUNK_LENGTH);
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

function extractCodeBlocks(text: string): Array<{ language: string; code: string }> {
  const blocks: Array<{ language: string; code: string }> = [];
  let match;
  const regex = new RegExp(CODE_BLOCK_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    const code = match[2].trim();
    if (code.length > 20) {
      blocks.push({
        language: match[1] || 'unknown',
        code: code.slice(0, MAX_CHUNK_LENGTH),
      });
    }
  }
  return blocks;
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
