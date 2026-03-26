import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/whisper/config — returns Groq/OpenAI key + endpoint for direct browser calls.
 * Only accessible from localhost/LAN (enforced by middleware).
 */
export async function GET() {
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

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
