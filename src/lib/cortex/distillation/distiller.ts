import crypto from 'crypto';
import type { CortexStore } from '../store';
import type { EmbeddingProvider } from '../embeddings';
import type { KnowledgeUnit } from '../knowledge/types';
import { PROMPTS, type DistillationPrompt } from './prompts';
import { cortexDebug } from '../debug';

export interface DistillationResult {
  unitsCreated: number;
  errors: string[];
}

export class Distiller {
  constructor(
    private store: CortexStore,
    private embedding: EmbeddingProvider,
    private callLLM: (system: string, user: string) => Promise<string>,
  ) {}

  async distill(
    chunkTexts: string[],
    layerKey: string,
    context: { workspaceId: number | null; agentType: string },
  ): Promise<DistillationResult> {
    const result: DistillationResult = { unitsCreated: 0, errors: [] };
    if (chunkTexts.length === 0) return result;

    cortexDebug(`[Distill] Starting ${Object.keys(PROMPTS).length} passes on ${chunkTexts.length} chunks → ${layerKey}`);

    for (const [name, prompt] of Object.entries(PROMPTS)) {
      try {
        const userMessage = prompt.userTemplate(chunkTexts);
        const response = await this.callLLM(prompt.systemPrompt, userMessage);

        let extracted: any[];
        try {
          // Strip markdown code fences if Haiku wraps response
          let json = response.trim();
          const fenceMatch = json.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
          if (fenceMatch) json = fenceMatch[1].trim();
          extracted = JSON.parse(json);
          if (!Array.isArray(extracted)) extracted = [];
        } catch {
          console.warn(`[Cortex Distill] ${name}: failed to parse JSON — response: ${response.slice(0, 120)}`);
          result.errors.push(`Failed to parse ${name} response as JSON`);
          continue;
        }

        for (const item of extracted) {
          const text = item.text || '';
          if (!text) continue;

          const [vector] = await this.embedding.embed([text]);
          const unit: KnowledgeUnit = {
            id: crypto.randomUUID(),
            vector,
            text,
            type: prompt.outputType,
            layer: layerKey.startsWith('workspace/') ? 'workspace' : 'personal',
            workspace_id: context.workspaceId,
            session_id: null,
            agent_type: context.agentType as any,
            project_path: null,
            file_refs: [],
            confidence: (item.confidence ?? 0.8) * 1.0,
            created: new Date().toISOString(),
            source_timestamp: new Date().toISOString(),
            stale_score: 0,
            access_count: 0,
            last_accessed: null,
            metadata: { source: 'distillation', prompt_type: name },
          };

          await this.store.add(layerKey, unit);
          result.unitsCreated++;
        }

        cortexDebug(`[Distill] ${name}: extracted ${extracted.length} items (${result.unitsCreated} stored)`);
      } catch (err) {
        console.error(`[Cortex Distill] ${name}: error — ${err}`);
        result.errors.push(`Distillation ${name} failed: ${err}`);
      }
    }

    console.log(`[Cortex Distill] Done: ${result.unitsCreated} units created, ${result.errors.length} errors`);
    return result;
  }
}
