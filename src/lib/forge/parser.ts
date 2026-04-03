import fs from 'fs';
import path from 'path';

export interface ForgeSession {
  id: string;
  title?: string;
  context?: {
    messages: Array<{
      role: string;
      content: string | any;
      timestamp?: string;
    }>;
  };
  metrics?: {
    started_at?: string;
    ended_at?: string;
    total_tokens?: number;
  };
  metadata?: {
    model?: string;
    cwd?: string;
  };
}

export interface ForgeSessionWithMeta extends ForgeSession {
  fullPath: string;
}

export function scanForgeSessions(conversationsDir: string): ForgeSessionWithMeta[] {
  if (!fs.existsSync(conversationsDir)) return [];

  const sessions: ForgeSessionWithMeta[] = [];
  const files = fs.readdirSync(conversationsDir).filter(f => f.endsWith('.json') && !f.startsWith('.'));

  for (const file of files) {
    const filePath = path.join(conversationsDir, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as ForgeSession;
      if (data.id) {
        sessions.push({
          ...data,
          fullPath: filePath,
        });
      }
    } catch {
      // skip malformed
    }
  }

  return sessions;
}
