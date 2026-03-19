'use client';

import { useState, useEffect, useCallback } from 'react';
import { Upload, BarChart3, Search, RefreshCw, Package, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { TYPE_COLORS } from './constants';

type Step = 'seed' | 'assess' | 'review' | 'refine' | 'publish';

interface Workspace {
  id: string;
  name: string;
  color: string;
}

interface SeedResult {
  chunksCreated: number;
  chunksSkipped: number;
  errors: string[];
}

interface AssessResult {
  coverage_score: number;
  total_units: number;
  stale_count: number;
  type_distribution: Record<string, number>;
}

interface ReviewUnit {
  id: string;
  type: string;
  text: string;
  source_ref?: string;
}

interface ReviewResult {
  results: ReviewUnit[];
}

interface RefineResult {
  source_units_found: number;
  distilled_purged: number;
  new_units_created: number;
}

interface PublishResult {
  quality_warning?: string;
  output_path?: string;
  pii_scrub?: { fields_scrubbed: number; records_checked: number };
}

const STEPS: { id: Step; label: string; icon: React.ReactNode }[] = [
  { id: 'seed', label: 'Seed', icon: <Upload className="w-3.5 h-3.5" /> },
  { id: 'assess', label: 'Assess', icon: <BarChart3 className="w-3.5 h-3.5" /> },
  { id: 'review', label: 'Review', icon: <Search className="w-3.5 h-3.5" /> },
  { id: 'refine', label: 'Refine', icon: <RefreshCw className="w-3.5 h-3.5" /> },
  { id: 'publish', label: 'Publish', icon: <Package className="w-3.5 h-3.5" /> },
];

const TYPE_HEX: Record<string, string> = {
  decision: '#3b82f6',
  pattern: '#22c55e',
  preference: '#ec4899',
  error_fix: '#f59e0b',
  context: '#6b7280',
  code_pattern: '#06b6d4',
  command: '#f97316',
  conversation: '#64748b',
  summary: '#8b5cf6',
};

function groupByType(items: ReviewUnit[]): Record<string, ReviewUnit[]> {
  return items.reduce(
    (acc, item) => {
      (acc[item.type] = acc[item.type] || []).push(item);
      return acc;
    },
    {} as Record<string, ReviewUnit[]>,
  );
}

export function CurationTab() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [activeStep, setActiveStep] = useState<Step>('seed');
  const [error, setError] = useState('');

  // Seed state
  const [seedText, setSeedText] = useState('');
  const [seedFormat, setSeedFormat] = useState('auto');
  const [seedSourceRef, setSeedSourceRef] = useState('');
  const [seedDistill, setSeedDistill] = useState(true);
  const [seedLoading, setSeedLoading] = useState(false);
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);

  // Assess state
  const [assessLoading, setAssessLoading] = useState(false);
  const [assessResult, setAssessResult] = useState<AssessResult | null>(null);

  // Review state
  const [reviewTopic, setReviewTopic] = useState('');
  const [reviewLimit, setReviewLimit] = useState('25');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);

  // Refine state
  const [refineDomainContext, setRefineDomainContext] = useState('');
  const [refineTypes, setRefineTypes] = useState({
    decisions: true,
    patterns: true,
    preferences: true,
    error_fixes: true,
  });
  const [refineLoading, setRefineLoading] = useState(false);
  const [refineResult, setRefineResult] = useState<RefineResult | null>(null);

  // Publish state
  const [publishName, setPublishName] = useState('');
  const [publishAuthor, setPublishAuthor] = useState('');
  const [publishDescription, setPublishDescription] = useState('');
  const [publishTags, setPublishTags] = useState('');
  const [publishVersion, setPublishVersion] = useState('1.0.0');
  const [publishLicense, setPublishLicense] = useState('MIT');
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);

  const clearStepResults = useCallback(() => {
    setSeedResult(null);
    setAssessResult(null);
    setReviewResult(null);
    setRefineResult(null);
    setPublishResult(null);
    setError('');
  }, []);

  useEffect(() => {
    fetch(api('/api/workspaces'))
      .then(r => r.json())
      .then((data: Workspace[]) => {
        setWorkspaces(data);
        if (data.length > 0) setWorkspaceId(data[0].id);
      })
      .catch(() => {});
  }, []);

  const handleStepChange = (step: Step) => {
    setActiveStep(step);
    clearStepResults();
  };

  const handleWorkspaceChange = (id: string) => {
    setWorkspaceId(id);
    clearStepResults();
  };

  // --- Seed ---
  const handleSeed = async () => {
    if (!seedText.trim() || !workspaceId) return;
    setSeedLoading(true);
    setError('');
    setSeedResult(null);
    try {
      const res = await fetch(api('/api/cortex/curation/seed'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: seedText,
          format: seedFormat,
          source_ref: seedSourceRef || undefined,
          workspace_id: workspaceId,
          distill: seedDistill,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Seed failed');
      setSeedResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seed failed');
    } finally {
      setSeedLoading(false);
    }
  };

  // --- Assess ---
  const handleAssess = async () => {
    if (!workspaceId) return;
    setAssessLoading(true);
    setError('');
    setAssessResult(null);
    try {
      const res = await fetch(
        api(`/api/cortex/curation/assess?workspace_id=${encodeURIComponent(workspaceId)}`),
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Assessment failed');
      setAssessResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Assessment failed');
    } finally {
      setAssessLoading(false);
    }
  };

  // --- Review ---
  const handleReview = async () => {
    if (!workspaceId) return;
    setReviewLoading(true);
    setError('');
    setReviewResult(null);
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId, limit: reviewLimit });
      if (reviewTopic.trim()) params.set('topic', reviewTopic.trim());
      const res = await fetch(api(`/api/cortex/curation/review?${params}`));
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Review failed');
      setReviewResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setReviewLoading(false);
    }
  };

  // --- Refine ---
  const handleRefine = async () => {
    if (!workspaceId) return;
    setRefineLoading(true);
    setError('');
    setRefineResult(null);
    try {
      const types = (Object.keys(refineTypes) as Array<keyof typeof refineTypes>).filter(
        k => refineTypes[k],
      );
      const res = await fetch(api('/api/cortex/curation/refine'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          domain_context: refineDomainContext || undefined,
          types,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Refine failed');
      setRefineResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refine failed');
    } finally {
      setRefineLoading(false);
    }
  };

  // --- Publish ---
  const handlePublish = async () => {
    if (!workspaceId || !publishName.trim()) return;
    setPublishLoading(true);
    setError('');
    setPublishResult(null);
    try {
      const res = await fetch(api('/api/cortex/curation/publish'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          name: publishName,
          author: publishAuthor || undefined,
          description: publishDescription || undefined,
          tags: publishTags
            ? publishTags
                .split(',')
                .map(t => t.trim())
                .filter(Boolean)
            : [],
          version: publishVersion,
          license: publishLicense,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Publish failed');
      setPublishResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setPublishLoading(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 text-sm bg-white/5 border border-white/10 rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/50';
  const labelClass = 'text-[11px] text-gray-500 mb-1 block';
  const resultPanelClass = 'bg-white/[0.02] border border-white/[0.06] rounded-lg p-4';

  const coverageColor = (score: number) =>
    score > 0.7 ? 'text-green-400' : score > 0.3 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="flex flex-col h-full">
      {/* Workspace selector */}
      <div className="px-4 pt-4 pb-3 border-b border-white/5">
        <label className={labelClass}>Workspace</label>
        <select
          value={workspaceId}
          onChange={e => handleWorkspaceChange(e.target.value)}
          className={`${inputClass} max-w-xs`}
        >
          {workspaces.length === 0 && (
            <option value="" disabled>
              No workspaces found
            </option>
          )}
          {workspaces.map(ws => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </select>
      </div>

      {/* Pipeline bar */}
      <div className="px-4 py-3 border-b border-white/5">
        <div className="flex items-center">
          {STEPS.map((step, idx) => (
            <div key={step.id} className="flex items-center">
              <button
                onClick={() => handleStepChange(step.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  activeStep === step.id
                    ? 'bg-purple-500/20 border-purple-500/30 text-purple-400'
                    : 'bg-white/[0.03] border-white/[0.06] text-gray-500 hover:text-gray-300 hover:bg-white/[0.06]'
                }`}
              >
                {step.icon}
                {step.label}
              </button>
              {idx < STEPS.length - 1 && <div className="w-8 h-px bg-white/[0.06]" />}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-2xl space-y-4">
          {/* Error banner */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-4 py-2.5 text-sm">
              {error}
            </div>
          )}

          {/* SEED */}
          {activeStep === 'seed' && (
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Document content</label>
                <textarea
                  value={seedText}
                  onChange={e => setSeedText(e.target.value)}
                  placeholder="Paste document content here..."
                  rows={8}
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Format</label>
                  <select
                    value={seedFormat}
                    onChange={e => setSeedFormat(e.target.value)}
                    className={inputClass}
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="markdown">Markdown</option>
                    <option value="plaintext">Plain text</option>
                    <option value="csv">CSV</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Source reference</label>
                  <input
                    value={seedSourceRef}
                    onChange={e => setSeedSourceRef(e.target.value)}
                    placeholder="e.g. docs/guide.md"
                    className={inputClass}
                  />
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={seedDistill}
                  onChange={e => setSeedDistill(e.target.checked)}
                  className="rounded border-white/20 bg-white/5 accent-purple-500"
                />
                <span className="text-xs text-gray-400">Distill after seeding</span>
              </label>
              <button
                onClick={handleSeed}
                disabled={seedLoading || !seedText.trim() || !workspaceId}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {seedLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                Seed Documents
              </button>

              {seedResult && (
                <div className={resultPanelClass}>
                  <div className="text-xs font-medium text-gray-400 mb-3">Seed Results</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase mb-0.5">Chunks Created</div>
                      <div className="text-lg font-semibold text-green-400 tabular-nums">
                        {seedResult.chunksCreated}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase mb-0.5">Chunks Skipped</div>
                      <div className="text-lg font-semibold text-amber-400 tabular-nums">
                        {seedResult.chunksSkipped}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase mb-0.5">Errors</div>
                      <div
                        className={`text-lg font-semibold tabular-nums ${
                          seedResult.errors.length > 0 ? 'text-red-400' : 'text-gray-500'
                        }`}
                      >
                        {seedResult.errors.length}
                      </div>
                    </div>
                  </div>
                  {seedResult.errors.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {seedResult.errors.map((err, i) => (
                        <div key={i} className="text-xs text-red-400/80">
                          {err}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ASSESS */}
          {activeStep === 'assess' && (
            <div className="space-y-3">
              <button
                onClick={handleAssess}
                disabled={assessLoading || !workspaceId}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {assessLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <BarChart3 className="w-4 h-4" />
                )}
                Run Assessment
              </button>

              {assessResult && (
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className={resultPanelClass}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Coverage Score</div>
                      <div
                        className={`text-2xl font-semibold tabular-nums ${coverageColor(assessResult.coverage_score)}`}
                      >
                        {assessResult.coverage_score.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-gray-600 mt-0.5">
                        {Math.round(assessResult.coverage_score * 100)}% covered
                      </div>
                    </div>
                    <div className={resultPanelClass}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Total Units</div>
                      <div className="text-2xl font-semibold text-white tabular-nums">
                        {assessResult.total_units.toLocaleString()}
                      </div>
                    </div>
                    <div className={resultPanelClass}>
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Stale Count</div>
                      <div
                        className={`text-2xl font-semibold tabular-nums ${
                          assessResult.stale_count > 10 ? 'text-amber-400' : 'text-gray-300'
                        }`}
                      >
                        {assessResult.stale_count}
                      </div>
                    </div>
                  </div>

                  {assessResult.type_distribution &&
                    Object.keys(assessResult.type_distribution).length > 0 && (
                      <div className={resultPanelClass}>
                        <div className="text-xs font-medium text-gray-400 mb-3">Type Distribution</div>
                        <div className="space-y-1.5">
                          {Object.entries(assessResult.type_distribution)
                            .sort((a, b) => b[1] - a[1])
                            .map(([type, count]) => {
                              const max = Math.max(
                                ...Object.values(assessResult.type_distribution),
                                1,
                              );
                              return (
                                <div key={type} className="flex items-center gap-2">
                                  <span className="text-[10px] text-gray-500 w-24 text-right truncate">
                                    {type.replace('_', ' ')}
                                  </span>
                                  <div className="flex-1 h-3 bg-white/[0.03] rounded-full overflow-hidden">
                                    <div
                                      className="h-full rounded-full transition-all duration-500"
                                      style={{
                                        width: `${Math.max(2, (count / max) * 100)}%`,
                                        backgroundColor: TYPE_HEX[type] || '#7c3aed',
                                      }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-gray-400 w-10 text-right tabular-nums">
                                    {count}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>
          )}

          {/* REVIEW */}
          {activeStep === 'review' && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={labelClass}>Topic filter</label>
                  <input
                    value={reviewTopic}
                    onChange={e => setReviewTopic(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleReview()}
                    placeholder="Filter by topic (optional)"
                    className={inputClass}
                  />
                </div>
                <div className="w-28">
                  <label className={labelClass}>Limit</label>
                  <select
                    value={reviewLimit}
                    onChange={e => setReviewLimit(e.target.value)}
                    className={inputClass}
                  >
                    <option value="10">10</option>
                    <option value="25">25</option>
                    <option value="50">50</option>
                  </select>
                </div>
              </div>
              <button
                onClick={handleReview}
                disabled={reviewLoading || !workspaceId}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {reviewLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                Review
              </button>

              {reviewResult && (
                <div className="space-y-2">
                  <div className="text-[11px] text-gray-500">
                    {reviewResult.results.length} unit
                    {reviewResult.results.length !== 1 ? 's' : ''} found
                  </div>
                  {Object.entries(groupByType(reviewResult.results)).map(([type, items]) => (
                    <details key={type} className={resultPanelClass}>
                      <summary className="flex items-center gap-2 cursor-pointer list-none">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            TYPE_COLORS[type] || TYPE_COLORS.context
                          }`}
                        >
                          {type.replace('_', ' ')}
                        </span>
                        <span className="text-xs text-gray-500">
                          {items.length} unit{items.length !== 1 ? 's' : ''}
                        </span>
                      </summary>
                      <div className="mt-3 space-y-2">
                        {items.map(item => (
                          <div
                            key={item.id}
                            className="bg-white/[0.02] border border-white/[0.04] rounded px-3 py-2"
                          >
                            <div className="text-xs text-gray-300 leading-relaxed">{item.text}</div>
                            {item.source_ref && (
                              <div className="mt-1 text-[10px] text-gray-600">{item.source_ref}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* REFINE */}
          {activeStep === 'refine' && (
            <div className="space-y-3">
              <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-lg px-4 py-2.5 text-xs leading-relaxed">
                Refine uses LLM distillation and requires an API key configured in Cortex settings.
                Without a key, refinement will run in passthrough mode.
              </div>

              <div>
                <label className={labelClass}>Domain context</label>
                <textarea
                  value={refineDomainContext}
                  onChange={e => setRefineDomainContext(e.target.value)}
                  placeholder="Describe the domain or project context to guide distillation..."
                  rows={4}
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Distillation passes</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(refineTypes) as Array<keyof typeof refineTypes>).map(key => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={refineTypes[key]}
                        onChange={e =>
                          setRefineTypes(prev => ({ ...prev, [key]: e.target.checked }))
                        }
                        className="rounded border-white/20 bg-white/5 accent-purple-500"
                      />
                      <span className="text-xs text-gray-400 capitalize">
                        {key.replace('_', ' ')}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                onClick={handleRefine}
                disabled={refineLoading || !workspaceId}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {refineLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Refine Lobe
              </button>

              {refineResult && (
                <div className={resultPanelClass}>
                  <div className="text-xs font-medium text-gray-400 mb-3">Refine Results</div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase mb-0.5">Source Units</div>
                      <div className="text-lg font-semibold text-white tabular-nums">
                        {refineResult.source_units_found}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase mb-0.5">Purged</div>
                      <div className="text-lg font-semibold text-amber-400 tabular-nums">
                        {refineResult.distilled_purged}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-500 uppercase mb-0.5">New Units</div>
                      <div className="text-lg font-semibold text-green-400 tabular-nums">
                        {refineResult.new_units_created}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PUBLISH */}
          {activeStep === 'publish' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Package name *</label>
                  <input
                    value={publishName}
                    onChange={e => setPublishName(e.target.value)}
                    placeholder="my-knowledge-pack"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Author</label>
                  <input
                    value={publishAuthor}
                    onChange={e => setPublishAuthor(e.target.value)}
                    placeholder="Your name or org"
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Description</label>
                <textarea
                  value={publishDescription}
                  onChange={e => setPublishDescription(e.target.value)}
                  placeholder="Describe the knowledge pack..."
                  rows={3}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Tags (comma-separated)</label>
                <input
                  value={publishTags}
                  onChange={e => setPublishTags(e.target.value)}
                  placeholder="e.g. typescript, react, patterns"
                  className={inputClass}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Version</label>
                  <input
                    value={publishVersion}
                    onChange={e => setPublishVersion(e.target.value)}
                    placeholder="1.0.0"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>License</label>
                  <select
                    value={publishLicense}
                    onChange={e => setPublishLicense(e.target.value)}
                    className={inputClass}
                  >
                    <option value="MIT">MIT</option>
                    <option value="Apache-2.0">Apache 2.0</option>
                    <option value="GPL-3.0">GPL 3.0</option>
                    <option value="BSD-3-Clause">BSD 3-Clause</option>
                    <option value="CC-BY-4.0">CC BY 4.0</option>
                    <option value="Proprietary">Proprietary</option>
                  </select>
                </div>
              </div>

              <button
                onClick={handlePublish}
                disabled={publishLoading || !publishName.trim() || !workspaceId}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {publishLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Package className="w-4 h-4" />
                )}
                Publish to Marketplace
              </button>

              {publishResult && (
                <div className={resultPanelClass}>
                  {publishResult.quality_warning && (
                    <div className="mb-3 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded px-3 py-2 text-xs">
                      {publishResult.quality_warning}
                    </div>
                  )}
                  <div className="text-xs font-medium text-gray-400 mb-3">Published</div>
                  {publishResult.output_path && (
                    <div className="mb-2">
                      <div className="text-[10px] text-gray-500 uppercase mb-0.5">Output Path</div>
                      <div className="text-xs text-gray-300 font-mono break-all">
                        {publishResult.output_path}
                      </div>
                    </div>
                  )}
                  {publishResult.pii_scrub && (
                    <div className="mt-2 pt-2 border-t border-white/[0.06]">
                      <div className="text-[10px] text-gray-500 uppercase mb-1">PII Scrub</div>
                      <div className="flex gap-4 text-[11px] text-gray-400">
                        <span>
                          {publishResult.pii_scrub.records_checked.toLocaleString()} records checked
                        </span>
                        <span>
                          {publishResult.pii_scrub.fields_scrubbed.toLocaleString()} fields scrubbed
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
