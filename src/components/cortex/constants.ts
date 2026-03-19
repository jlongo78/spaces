export const TYPE_COLORS: Record<string, string> = {
  decision: 'bg-blue-500/20 text-blue-400',
  preference: 'bg-pink-500/20 text-pink-400',
  pattern: 'bg-green-500/20 text-green-400',
  error_fix: 'bg-amber-500/20 text-amber-400',
  context: 'bg-gray-500/20 text-gray-400',
  code_pattern: 'bg-cyan-500/20 text-cyan-400',
  command: 'bg-orange-500/20 text-orange-400',
  conversation: 'bg-slate-500/20 text-slate-400',
  summary: 'bg-violet-500/20 text-violet-400',
};

export const SENSITIVITY_COLORS: Record<string, string> = {
  public: 'bg-green-500/20 text-green-400',
  internal: 'bg-indigo-500/20 text-indigo-400',
  restricted: 'bg-amber-500/20 text-amber-400',
  confidential: 'bg-red-500/20 text-red-400',
};

export const INTENT_COLORS: Record<string, string> = {
  debugging: 'text-red-400',
  architecture: 'text-blue-400',
  onboarding: 'text-green-400',
  policy: 'text-purple-400',
  'how-to': 'text-amber-400',
  review: 'text-pink-400',
  security: 'text-red-500',
  general: 'text-gray-400',
};
