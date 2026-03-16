import type { SignalAdapter, SignalEnvelope } from '../types';

export class ConversationAdapter implements SignalAdapter {
  name = 'conversation';
  schedule = 'realtime' as const;

  async *extract(): AsyncIterable<SignalEnvelope> {
    // No-op — conversations ingested via learn hook
  }

  async healthCheck(): Promise<boolean> { return true; }

  static fromQA(question: string, answer: string, sessionId: string, type: string = 'conversation'): SignalEnvelope {
    return {
      text: `Q: ${question}\nA: ${answer}`,
      origin: { source_type: 'conversation', source_ref: sessionId, creator_entity_id: 'person-default-user' },
      entities: [],
      suggested_type: type as any,
      suggested_sensitivity: 'internal',
      raw_metadata: { session_id: sessionId },
    };
  }
}
