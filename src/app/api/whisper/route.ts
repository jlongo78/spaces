import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/whisper — transcribe audio via OpenAI Whisper API (or Groq).
 * Accepts multipart form data with an "audio" field (webm/opus blob).
 *
 * Checks for keys in order: GROQ_API_KEY (faster, free tier), OPENAI_API_KEY.
 */
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const audioFile = form.get('audio');
    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Determine which API to use
    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!groqKey && !openaiKey) {
      return NextResponse.json(
        { error: 'No transcription API key configured. Set GROQ_API_KEY or OPENAI_API_KEY.' },
        { status: 500 }
      );
    }

    // Build the upstream request
    const upstream = new FormData();
    upstream.append('file', audioFile, 'audio.webm');
    upstream.append('model', groqKey ? 'whisper-large-v3' : 'whisper-1');
    upstream.append('response_format', 'json');

    const apiUrl = groqKey
      ? 'https://api.groq.com/openai/v1/audio/transcriptions'
      : 'https://api.openai.com/v1/audio/transcriptions';
    const apiKey = groqKey || openaiKey;

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: upstream,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => 'Unknown error');
      console.error(`[Whisper] ${res.status}: ${err}`);
      return NextResponse.json({ error: 'Transcription failed' }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json({ text: data.text || '' });
  } catch (err: any) {
    console.error('[Whisper] Error:', err.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
