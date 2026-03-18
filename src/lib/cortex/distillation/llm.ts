type LLMProvider = 'anthropic' | 'openai';

export interface LLMUsage {
  provider: LLMProvider;
  model: string;
  input_tokens: number;
  output_tokens: number;
}

export type OnUsage = (usage: LLMUsage) => void;

export interface LLMKeys {
  anthropic?: string;
  openai?: string;
}

export function detectLLMProvider(keys?: LLMKeys): LLMProvider | null {
  if (keys?.anthropic || process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (keys?.openai || process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

export function createCallLLM(onUsage?: OnUsage, keys?: LLMKeys): ((system: string, user: string) => Promise<string>) | null {
  const provider = detectLLMProvider(keys);
  if (!provider) return null;

  if (provider === 'anthropic') {
    const apiKey = keys?.anthropic || process.env.ANTHROPIC_API_KEY!;
    return async (system: string, user: string) => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
      const data = await res.json();
      if (onUsage && data.usage) {
        onUsage({
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          input_tokens: data.usage.input_tokens || 0,
          output_tokens: data.usage.output_tokens || 0,
        });
      }
      return data.content?.[0]?.text ?? '';
    };
  }

  const openaiKey = keys?.openai || process.env.OPENAI_API_KEY!;
  return async (system: string, user: string) => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 2048,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
    const data = await res.json();
    if (onUsage && data.usage) {
      onUsage({
        provider: 'openai',
        model: 'gpt-4o-mini',
        input_tokens: data.usage.prompt_tokens || 0,
        output_tokens: data.usage.completion_tokens || 0,
      });
    }
    return data.choices?.[0]?.message?.content ?? '';
  };
}
