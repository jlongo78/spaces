import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, withUser } from '@/lib/auth';
import { getUserPaths } from '@/lib/config';

export const dynamic = 'force-dynamic';

const SYSTEM_PROMPT = `You are a project planning assistant for Agent Spaces — a workspace manager for AI coding agents.

Your job: help the user plan a new project workspace through conversation. Ask 1-2 questions at a time (not a wall). Converge toward a concrete plan.

Available agent types:
- claude: Claude Code — best for complex coding, architecture, debugging
- codex: Codex CLI — good for quick code generation
- gemini: Gemini CLI — Google's coding assistant
- aider: Aider — git-aware pair programming
- shell: Plain terminal/bash — for manual commands, scripts, builds
- custom: Custom command — user specifies the command

After each exchange, output an updated project plan as a JSON block. Format:

\`\`\`json
{
  "workspace": { "name": "...", "description": "...", "color": "#6366f1" },
  "panes": [
    { "title": "...", "agentType": "claude", "cwd": "...", "initialPrompt": "...", "description": "..." }
  ],
  "summary": "One paragraph summary"
}
\`\`\`

Guidelines:
- Ask about: project purpose, tech stack, scope, working directory, what agents would help
- Suggest agent configurations based on the project description
- Use sensible defaults (color #6366f1, cwd based on project name)
- Keep pane count reasonable (2-5 for most projects)
- For initialPrompt, write what the agent should start working on
- When the plan looks solid, suggest the user review it`;

export async function POST(request: NextRequest) {
  const user = getAuthUser(request);
  return withUser(user, async () => {
    const { configPath } = getUserPaths(user);
    let config: any = {};
    try {
      const { readCortexConfig } = await import('@/lib/cortex/config');
      config = readCortexConfig(configPath);
    } catch {}

    const anthropicKey = config.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return NextResponse.json(
        { error: 'No API key configured. Add your Anthropic key in Settings > Cortex.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { messages, currentPlan } = body;

    // Build messages for Claude API
    const apiMessages = messages.map((m: any) => ({
      role: m.role,
      content: m.content,
    }));

    let systemPrompt = SYSTEM_PROMPT;
    if (currentPlan) {
      systemPrompt += `\n\nCurrent plan state:\n\`\`\`json\n${JSON.stringify(currentPlan, null, 2)}\n\`\`\``;
    }

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system: systemPrompt,
          messages: apiMessages,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: `API error: ${res.status}` }, { status: 502 });
      }

      const data = await res.json();
      const reply = data.content?.[0]?.text || '';

      // Extract JSON plan block from the reply
      let plan = currentPlan;
      const jsonMatch = reply.match(/```json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          plan = JSON.parse(jsonMatch[1]);
        } catch { /* keep current plan if parse fails */ }
      }

      // Strip the JSON block from the conversational reply
      const cleanReply = reply.replace(/```json[\s\S]*?```/g, '').trim();

      return NextResponse.json({ reply: cleanReply, plan });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  });
}
