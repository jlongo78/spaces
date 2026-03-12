import { describe, it, expect } from 'vitest';
import { chunkMessages, type SessionMessage } from '@/lib/cortex/ingestion/chunker';

const makeMsg = (role: string, text: string, toolUse?: boolean): SessionMessage => ({
  role,
  content: text,
  timestamp: new Date().toISOString(),
  hasToolUse: !!toolUse,
});

describe('chunkMessages', () => {
  it('creates chunks at turn boundaries', () => {
    const messages = [
      makeMsg('human', 'Add auth to the API'),
      makeMsg('assistant', 'I will add JWT auth with refresh tokens.'),
      makeMsg('human', 'Now add tests'),
      makeMsg('assistant', 'Writing tests for auth routes.'),
    ];
    const chunks = chunkMessages(messages, {
      sessionId: 'sess-1',
      workspaceId: 1,
      agentType: 'claude',
      projectPath: '/project',
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].text).toContain('Add auth');
    expect(chunks[0].session_id).toBe('sess-1');
  });

  it('extracts code blocks as separate chunks', () => {
    const messages = [
      makeMsg('assistant', 'Here is the code:\n```typescript\nfunction auth() { return true; }\n```'),
    ];
    const chunks = chunkMessages(messages, {
      sessionId: 'sess-1',
      workspaceId: null,
      agentType: 'claude',
      projectPath: null,
    });
    const codeChunks = chunks.filter(c => c.type === 'code_pattern');
    expect(codeChunks.length).toBeGreaterThanOrEqual(1);
    expect(codeChunks[0].text).toContain('function auth');
  });

  it('limits chunk text length', () => {
    const longText = 'x'.repeat(10000);
    const messages = [makeMsg('assistant', longText)];
    const chunks = chunkMessages(messages, {
      sessionId: 's', workspaceId: null, agentType: 'claude', projectPath: null,
    });
    chunks.forEach(c => expect(c.text.length).toBeLessThanOrEqual(4000));
  });
});
