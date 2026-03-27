import { NextResponse } from 'next/server';
import { readCortexConfig } from '@/lib/cortex/config';
import { getUserPaths } from '@/lib/config';

export const dynamic = 'force-dynamic';

/**
 * GET /api/whisper/config — returns Groq/OpenAI key + endpoint for direct browser calls.
 * Checks cortex config first (user settings), then falls back to env vars.
 */
export async function GET() {
  // Try cortex config first (user-configured keys in settings)
  let configGroq = '';
  let configOpenai = '';
  try {
    const { configPath } = getUserPaths('admin');
    const cortexCfg = readCortexConfig(configPath);
    configGroq = cortexCfg.groq_api_key || '';
    configOpenai = cortexCfg.openai_api_key || '';
  } catch {}

  const groqKey = configGroq || process.env.GROQ_API_KEY;
  const openaiKey = configOpenai || process.env.OPENAI_API_KEY;

  if (groqKey) {
    return NextResponse.json({
      apiKey: groqKey,
      apiUrl: 'https://api.groq.com/openai/v1/audio/transcriptions',
      model: 'whisper-large-v3-turbo',
      backend: 'groq',
    });
  }
  if (openaiKey) {
    return NextResponse.json({
      apiKey: openaiKey,
      apiUrl: 'https://api.openai.com/v1/audio/transcriptions',
      model: 'whisper-1',
      backend: 'openai',
    });
  }
  return NextResponse.json({ error: 'No API key configured' }, { status: 500 });
}
