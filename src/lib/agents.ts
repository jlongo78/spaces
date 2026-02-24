// Supported agent systems for Spaces panes

export interface AgentType {
  id: string;
  name: string;
  command: string;
  resumeFlag: string;        // CLI flag for resuming sessions (e.g., '--resume')
  supportsResume: boolean;
  color: string;
  description: string;
}

export const AGENT_TYPES: Record<string, AgentType> = {
  shell: {
    id: 'shell',
    name: 'Shell',
    command: '',
    resumeFlag: '',
    supportsResume: false,
    color: '#71717a',
    description: 'Plain terminal shell',
  },
  claude: {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    resumeFlag: '--resume',
    supportsResume: true,
    color: '#d97706',
    description: 'Anthropic Claude Code CLI',
  },
  codex: {
    id: 'codex',
    name: 'Codex CLI',
    command: 'codex',
    resumeFlag: 'resume',
    supportsResume: true,
    color: '#10b981',
    description: 'OpenAI Codex CLI',
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    resumeFlag: '--resume',
    supportsResume: true,
    color: '#3b82f6',
    description: 'Google Gemini CLI',
  },
  aider: {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    resumeFlag: '',
    supportsResume: false,
    color: '#8b5cf6',
    description: 'AI pair programming in your terminal',
  },
  custom: {
    id: 'custom',
    name: 'Custom',
    command: '',
    resumeFlag: '',
    supportsResume: false,
    color: '#ec4899',
    description: 'Custom command',
  },
};

export const AGENT_LIST = Object.values(AGENT_TYPES);
