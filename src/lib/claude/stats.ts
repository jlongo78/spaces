import fs from 'fs';
import path from 'path';
import { getUserPaths } from '../config';
import type { DailyActivity, DailyModelTokens, ModelUsage, StatsCache } from '@/types/claude';

/**
 * Compute fresh stats by scanning session JSONL files.
 * Reads from the Spaces-managed cache first; recomputes if stale (>1h).
 */
export function getOrComputeStats(username: string): StatsCache | null {
  const paths = getUserPaths(username);
  const cachePath = path.join(path.dirname(paths.statsPath), 'spaces-stats-cache.json');

  // Check if our cache is fresh (less than 1 hour old)
  try {
    if (fs.existsSync(cachePath)) {
      const stat = fs.statSync(cachePath);
      const ageMs = Date.now() - stat.mtimeMs;
      if (ageMs < 3600_000) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        if (cached?.version === 3) return cached;
      }
    }
  } catch { /* recompute */ }

  // Also try the Claude Code native cache as a fallback data source
  let nativeCache: StatsCache | null = null;
  try {
    if (fs.existsSync(paths.statsPath)) {
      nativeCache = JSON.parse(fs.readFileSync(paths.statsPath, 'utf-8'));
    }
  } catch { /* ignore */ }

  // Compute from JSONL files by scanning the filesystem directly
  const computed = computeFromJSONL(paths.claudeProjectsDir, nativeCache);

  // Write cache
  try {
    const dir = path.dirname(cachePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(computed, null, 2));
  } catch { /* non-fatal */ }

  return computed;
}

function computeFromJSONL(projectsDir: string, nativeCache: StatsCache | null): StatsCache {
  const dailyActivityMap = new Map<string, DailyActivity>();
  const dailyTokensMap = new Map<string, Record<string, number>>();
  const modelUsageMap = new Map<string, ModelUsage>();

  // Scan all JSONL files in all project directories
  if (fs.existsSync(projectsDir)) {
    try {
      const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
        .filter(d => d.isDirectory());

      for (const dir of projectDirs) {
        const dirPath = path.join(projectsDir, dir.name);
        try {
          const files = fs.readdirSync(dirPath)
            .filter(f => f.endsWith('.jsonl') && !f.startsWith('.'));

          for (const file of files) {
            const filePath = path.join(dirPath, file);
            try {
              // Skip files older than 90 days for perf
              const stat = fs.statSync(filePath);
              const ageMs = Date.now() - stat.mtimeMs;
              if (ageMs > 90 * 86400_000) continue;

              scanSessionFile(filePath, dailyActivityMap, dailyTokensMap, modelUsageMap);
            } catch { /* skip unreadable files */ }
          }
        } catch { /* skip unreadable dirs */ }
      }
    } catch { /* projectsDir unreadable */ }
  }

  // Merge with native cache data for older dates we skipped
  if (nativeCache?.dailyActivity) {
    for (const entry of nativeCache.dailyActivity) {
      if (!dailyActivityMap.has(entry.date)) {
        dailyActivityMap.set(entry.date, entry);
      }
    }
  }
  if (nativeCache?.dailyModelTokens) {
    for (const entry of nativeCache.dailyModelTokens) {
      if (!dailyTokensMap.has(entry.date)) {
        dailyTokensMap.set(entry.date, entry.tokensByModel);
      }
    }
  }
  if (nativeCache?.modelUsage) {
    for (const [model, usage] of Object.entries(nativeCache.modelUsage)) {
      if (!modelUsageMap.has(model)) {
        modelUsageMap.set(model, usage);
      }
    }
  }

  const dailyActivity = Array.from(dailyActivityMap.entries())
    .map(([, data]) => data)
    .sort((a, b) => a.date.localeCompare(b.date));

  const dailyModelTokens: DailyModelTokens[] = Array.from(dailyTokensMap.entries())
    .map(([date, tokensByModel]) => ({ date, tokensByModel }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const modelUsage: Record<string, ModelUsage> = {};
  for (const [model, usage] of modelUsageMap) {
    modelUsage[model] = usage;
  }

  return {
    version: 3 as any,
    lastComputedDate: new Date().toISOString().slice(0, 10),
    dailyActivity,
    dailyModelTokens,
    modelUsage,
  };
}

function scanSessionFile(
  filePath: string,
  activityMap: Map<string, DailyActivity>,
  tokensMap: Map<string, Record<string, number>>,
  modelUsageMap: Map<string, ModelUsage>,
) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const datesInFile = new Set<string>();

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);

      // Track dates for session counting
      if ((msg.type === 'user' || msg.type === 'assistant') && msg.timestamp) {
        const date = msg.timestamp.slice(0, 10);
        if (date.length === 10) datesInFile.add(date);
      }

      if (msg.type !== 'assistant') continue;

      const ts = msg.timestamp || '';
      const date = ts.slice(0, 10);
      if (!date || date.length !== 10) continue;

      const model = msg.message?.model || 'unknown';
      const usage = msg.message?.usage;
      const blocks = msg.message?.content;

      // Count tool calls
      let toolCalls = 0;
      if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block.type === 'tool_use') toolCalls++;
        }
      }

      // Update daily activity
      let activity = activityMap.get(date);
      if (!activity) {
        activity = { date, messageCount: 0, sessionCount: 0, toolCallCount: 0 };
        activityMap.set(date, activity);
      }
      activity.messageCount++;
      activity.toolCallCount += toolCalls;

      // Update daily tokens
      if (usage) {
        const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
        if (!tokensMap.has(date)) tokensMap.set(date, {});
        const dayTokens = tokensMap.get(date)!;
        dayTokens[model] = (dayTokens[model] || 0) + totalTokens;

        // Update model usage aggregate
        if (!modelUsageMap.has(model)) {
          modelUsageMap.set(model, {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          });
        }
        const mu = modelUsageMap.get(model)!;
        mu.inputTokens += usage.input_tokens || 0;
        mu.outputTokens += usage.output_tokens || 0;
        mu.cacheReadInputTokens += usage.cache_read_input_tokens || 0;
        mu.cacheCreationInputTokens += usage.cache_creation_input_tokens || 0;
      }
    } catch {
      // Skip malformed lines
    }
  }

  // Increment sessionCount once per file per date it was active
  for (const date of datesInFile) {
    const activity = activityMap.get(date);
    if (activity) activity.sessionCount++;
  }
}
