'use client';

import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  User, Bot, ChevronDown, ChevronRight, Terminal, FileCode,
  Copy, Check, Eye, EyeOff, Brain, Wrench, AlertTriangle,
  FileText, Search, Globe, Pencil, FolderOpen, Code2, Maximize2, Minimize2,
} from 'lucide-react';
import type { ParsedMessage, ContentBlock } from '@/types/claude';
import { cn } from '@/lib/utils';

interface MessageRendererProps {
  message: ParsedMessage;
  isLast?: boolean;
}

export function MessageRenderer({ message, isLast }: MessageRendererProps) {
  if (message.type === 'user') {
    return <UserMessageView message={message} />;
  }
  if (message.type === 'assistant') {
    return <AssistantMessageView message={message} isLast={isLast} />;
  }
  if (message.type === 'system') {
    return <SystemMessageView message={message} />;
  }
  return null;
}

// ─── Copy Button ─────────────────────────────────────────────

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors',
        className
      )}
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-green-500" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

// ─── User Message ────────────────────────────────────────────

function UserMessageView({ message }: { message: any }) {
  const content = message.message?.content;
  const text = typeof content === 'string' ? content : '';
  const cwd = message.cwd || '';
  const branch = message.gitBranch || '';

  return (
    <div className="group relative">
      <div className="flex gap-3">
        <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <User className="w-4 h-4 text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">You</span>
            {cwd && (
              <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[300px]" title={cwd}>
                {cwd.split(/[/\\]/).slice(-2).join('/')}
              </span>
            )}
            {branch && branch !== 'HEAD' && (
              <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded font-mono">
                {branch}
              </span>
            )}
            <CopyButton text={text} className="opacity-0 group-hover:opacity-100" />
          </div>
          <div className="text-sm prose dark:prose-invert max-w-none prose-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Assistant Message ───────────────────────────────────────

function AssistantMessageView({ message, isLast }: { message: any; isLast?: boolean }) {
  const content = message.message?.content;
  const model = message.message?.model || '';
  const usage = message.message?.usage;
  const cost = message.costUSD;
  const duration = message.durationMs;
  const blocks: ContentBlock[] = Array.isArray(content) ? content : [];
  const [showMeta, setShowMeta] = useState(false);

  // Extract all text for copy
  const allText = blocks
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('\n\n');

  return (
    <div className="group relative">
      <div className="flex gap-3">
        <div className="w-8 h-8 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Bot className="w-4 h-4 text-indigo-500" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">Claude</span>
            {model && (
              <span className="text-[10px] px-1.5 py-0.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-300 rounded font-medium">
                {formatModel(model)}
              </span>
            )}
            {cost != null && cost > 0 && (
              <span className="text-[10px] text-muted-foreground">${cost.toFixed(4)}</span>
            )}
            {duration != null && duration > 0 && (
              <span className="text-[10px] text-muted-foreground">{(duration / 1000).toFixed(1)}s</span>
            )}
            {allText && <CopyButton text={allText} className="opacity-0 group-hover:opacity-100" />}
            {usage && (
              <button
                onClick={() => setShowMeta(!showMeta)}
                className="text-[10px] text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
              >
                tokens
              </button>
            )}
          </div>

          {showMeta && usage && (
            <div className="text-[10px] text-muted-foreground bg-zinc-50 dark:bg-zinc-900 rounded p-2 font-mono grid grid-cols-2 gap-x-4 gap-y-1">
              <span>Input: {(usage.input_tokens || 0).toLocaleString()}</span>
              <span>Output: {(usage.output_tokens || 0).toLocaleString()}</span>
              {usage.cache_read_input_tokens > 0 && <span>Cache read: {usage.cache_read_input_tokens.toLocaleString()}</span>}
              {usage.cache_creation_input_tokens > 0 && <span>Cache write: {usage.cache_creation_input_tokens.toLocaleString()}</span>}
            </div>
          )}

          {blocks.map((block, i) => (
            <ContentBlockRenderer key={i} block={block} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── System Message ──────────────────────────────────────────

function SystemMessageView({ message }: { message: any }) {
  const content = message.message?.content;
  const text = typeof content === 'string' ? content : '';
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mx-8 px-4 py-2 bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-md">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground w-full"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="font-medium">System</span>
        {!expanded && <span className="truncate opacity-50 ml-1">{text.slice(0, 100)}</span>}
      </button>
      {expanded && (
        <div className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap max-h-60 overflow-y-auto border-t border-zinc-200 dark:border-zinc-800 pt-2">
          {text}
        </div>
      )}
    </div>
  );
}

// ─── Content Block Router ────────────────────────────────────

function ContentBlockRenderer({ block }: { block: ContentBlock }) {
  if (block.type === 'text' && block.text) {
    return <TextBlock text={block.text} />;
  }
  if (block.type === 'thinking' && block.thinking) {
    return <ThinkingBlock thinking={block.thinking} />;
  }
  if (block.type === 'tool_use') {
    return <ToolUseBlock block={block} />;
  }
  if (block.type === 'tool_result') {
    return <ToolResultBlock block={block} />;
  }
  return null;
}

// ─── Text Block ──────────────────────────────────────────────

function TextBlock({ text }: { text: string }) {
  return (
    <div className="text-sm prose dark:prose-invert max-w-none prose-sm prose-p:leading-relaxed prose-pre:bg-zinc-950 prose-pre:text-zinc-100 prose-pre:border prose-pre:border-zinc-800 prose-code:text-indigo-600 dark:prose-code:text-indigo-400 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children, ...props }) => (
            <div className="relative group/code">
              <pre {...props} className="!mt-2 !mb-2 rounded-lg overflow-x-auto">
                {children}
              </pre>
            </div>
          ),
          code: ({ className, children, ...props }) => {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-[13px]" {...props}>
                  {children}
                </code>
              );
            }
            const codeText = String(children).replace(/\n$/, '');
            const lang = className?.replace('language-', '') || '';
            return (
              <div className="relative">
                <div className="absolute top-0 right-0 flex items-center gap-1 p-1">
                  {lang && <span className="text-[10px] text-zinc-500 px-1">{lang}</span>}
                  <CopyButton text={codeText} />
                </div>
                <code className={className} {...props}>
                  {children}
                </code>
              </div>
            );
          },
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto my-2 border border-zinc-200 dark:border-zinc-800 rounded-lg">
              <table className="!my-0" {...props}>{children}</table>
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

// ─── Thinking Block ──────────────────────────────────────────

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = thinking.split('\n').length;
  const chars = thinking.length;

  return (
    <div className="border border-purple-200 dark:border-purple-900/50 rounded-lg overflow-hidden">
      <div className="flex items-center bg-purple-50 dark:bg-purple-950/20">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-1 px-3 py-2 flex items-center gap-2 text-xs hover:bg-purple-100 dark:hover:bg-purple-950/40 transition-colors"
        >
          {expanded ? <ChevronDown className="w-3 h-3 text-purple-500" /> : <ChevronRight className="w-3 h-3 text-purple-500" />}
          <Brain className="w-3.5 h-3.5 text-purple-500" />
          <span className="font-medium text-purple-700 dark:text-purple-300">Thinking</span>
          <span className="text-purple-500/60 ml-1">{lines} lines, {chars > 1000 ? `${(chars / 1000).toFixed(1)}K` : chars} chars</span>
          {!expanded && (
            <span className="truncate text-purple-500/40 ml-2 flex-1 text-left">{thinking.slice(0, 120)}</span>
          )}
        </button>
        <div className="pr-2">
          <CopyButton text={thinking} />
        </div>
      </div>
      {expanded && (
        <div className="p-4 text-xs text-purple-900/70 dark:text-purple-200/70 whitespace-pre-wrap max-h-[500px] overflow-y-auto bg-purple-50/50 dark:bg-purple-950/10 font-mono leading-relaxed">
          {thinking}
        </div>
      )}
    </div>
  );
}

// ─── Tool Use Block ──────────────────────────────────────────

function ToolUseBlock({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false);
  const toolName = block.name || 'Unknown Tool';
  const input = block.input;

  const { icon: Icon, color, bg, label } = getToolStyle(toolName);
  const preview = input ? getToolPreview(toolName, input) : '';

  return (
    <div className={cn('border rounded-lg overflow-hidden', `border-${color}-200 dark:border-${color}-900/50`)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full px-3 py-2 flex items-center gap-2 text-xs transition-colors',
          bg
        )}
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Icon className={cn('w-3.5 h-3.5', `text-${color}-600 dark:text-${color}-400`)} />
        <span className={cn('font-medium', `text-${color}-700 dark:text-${color}-300`)}>{label}</span>
        {preview && !expanded && (
          <span className="truncate text-muted-foreground ml-1 flex-1 text-left font-mono">{preview}</span>
        )}
      </button>

      {expanded && input && (
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          <ToolInputRenderer toolName={toolName} input={input} />
        </div>
      )}
    </div>
  );
}

function ToolInputRenderer({ toolName, input }: { toolName: string; input: Record<string, unknown> }) {
  const name = toolName.toLowerCase();

  // Bash / command - show the command prominently
  if (name === 'bash' || name.includes('command')) {
    const command = String(input.command || '');
    const description = String(input.description || '');
    return (
      <div>
        {description && (
          <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
            {description}
          </div>
        )}
        <div className="relative">
          <pre className="p-3 bg-zinc-950 text-green-400 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
            <span className="text-zinc-500 select-none">$ </span>{command}
          </pre>
          <CopyButton text={command} className="absolute top-1 right-1" />
        </div>
      </div>
    );
  }

  // Write / Edit / Read - show file path and content
  if (name === 'write' || name === 'edit' || name === 'read' || name === 'multiedit') {
    const filePath = String(input.file_path || input.path || '');
    const content = input.content ? String(input.content) : null;
    const oldStr = input.old_string ? String(input.old_string) : null;
    const newStr = input.new_string ? String(input.new_string) : null;

    return (
      <div>
        {filePath && (
          <div className="px-3 py-1.5 text-xs font-mono text-muted-foreground border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex items-center gap-2">
            <FileText className="w-3 h-3" />
            {filePath}
            <CopyButton text={filePath} />
          </div>
        )}
        {content && (
          <div className="relative">
            <pre className="p-3 bg-zinc-950 text-zinc-100 text-xs font-mono overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap">{content.slice(0, 5000)}{content.length > 5000 ? `\n\n... (${content.length.toLocaleString()} chars total)` : ''}</pre>
            <CopyButton text={content} className="absolute top-1 right-1" />
          </div>
        )}
        {oldStr && newStr && (
          <div className="text-xs font-mono">
            <div className="px-3 py-2 bg-red-950/30 text-red-300 border-b border-zinc-800 overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              <span className="text-red-500/60 select-none">- </span>{oldStr}
            </div>
            <div className="px-3 py-2 bg-green-950/30 text-green-300 overflow-x-auto whitespace-pre-wrap max-h-[200px] overflow-y-auto">
              <span className="text-green-500/60 select-none">+ </span>{newStr}
            </div>
          </div>
        )}
        {!content && !oldStr && (
          <pre className="p-3 bg-zinc-950 text-zinc-300 text-xs font-mono overflow-x-auto max-h-[300px] overflow-y-auto">{JSON.stringify(input, null, 2)}</pre>
        )}
      </div>
    );
  }

  // Glob / Grep / Search
  if (name === 'glob' || name === 'grep' || name.includes('search')) {
    const pattern = String(input.pattern || input.query || '');
    const path = String(input.path || '');
    return (
      <div className="px-3 py-2 bg-zinc-950 text-zinc-100 text-xs font-mono">
        {pattern && <div><span className="text-zinc-500">pattern: </span><span className="text-amber-400">{pattern}</span></div>}
        {path && <div><span className="text-zinc-500">path: </span>{path}</div>}
        {Object.entries(input).filter(([k]) => !['pattern', 'query', 'path'].includes(k)).map(([k, v]) => (
          <div key={k}><span className="text-zinc-500">{k}: </span>{String(v)}</div>
        ))}
      </div>
    );
  }

  // Task (subagent spawn)
  if (name === 'task') {
    const prompt = String(input.prompt || '');
    const agentType = String(input.subagent_type || '');
    const desc = String(input.description || '');
    return (
      <div>
        <div className="px-3 py-1.5 text-xs border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex items-center gap-2">
          {agentType && <span className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-300 rounded font-medium">{agentType}</span>}
          {desc && <span className="text-muted-foreground">{desc}</span>}
        </div>
        <pre className="p-3 bg-zinc-950 text-zinc-100 text-xs font-mono overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap">{prompt}</pre>
      </div>
    );
  }

  // Default: JSON view
  return (
    <div className="relative">
      <pre className="p-3 bg-zinc-950 text-zinc-300 text-xs font-mono overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap">{JSON.stringify(input, null, 2)}</pre>
      <CopyButton text={JSON.stringify(input, null, 2)} className="absolute top-1 right-1" />
    </div>
  );
}

// ─── Tool Result Block ───────────────────────────────────────

function ToolResultBlock({ block }: { block: ContentBlock }) {
  const [expanded, setExpanded] = useState(false);
  const content = typeof block.content === 'string'
    ? block.content
    : Array.isArray(block.content)
    ? block.content.map((c: any) => c.text || '').join('\n')
    : '';

  if (!content) return null;

  const isError = block.is_error;
  const isLong = content.length > 200;
  const lines = content.split('\n').length;

  return (
    <div className={cn(
      'border rounded-lg overflow-hidden',
      isError
        ? 'border-red-200 dark:border-red-900/50'
        : 'border-zinc-200 dark:border-zinc-800'
    )}>
      <div className={cn(
        'flex items-center',
        isError
          ? 'bg-red-50 dark:bg-red-950/20'
          : 'bg-zinc-50 dark:bg-zinc-900/50'
      )}>
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'flex-1 px-3 py-2 flex items-center gap-2 text-xs transition-colors',
            isError
              ? 'hover:bg-red-100 dark:hover:bg-red-950/40'
              : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
          )}
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {isError ? (
            <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
          ) : (
            <Check className="w-3.5 h-3.5 text-green-500" />
          )}
          <span className={cn('font-medium', isError ? 'text-red-600 dark:text-red-400' : 'text-zinc-600 dark:text-zinc-400')}>
            {isError ? 'Error' : 'Output'}
          </span>
          <span className="text-muted-foreground/50">{lines} lines</span>
          {!expanded && (
            <span className="truncate text-muted-foreground/50 ml-1 flex-1 text-left font-mono">{content.slice(0, 80)}</span>
          )}
        </button>
        <div className="pr-2">
          <CopyButton text={content} />
        </div>
      </div>
      {expanded && (
        <div className={cn(
          'p-3 text-xs font-mono whitespace-pre-wrap overflow-y-auto',
          isLong ? 'max-h-[500px]' : '',
          isError
            ? 'bg-red-950/10 text-red-200'
            : 'bg-zinc-950 text-zinc-300'
        )}>
          {content}
        </div>
      )}
    </div>
  );
}

// ─── Tool Style Lookup ───────────────────────────────────────

function getToolStyle(toolName: string): { icon: any; color: string; bg: string; label: string } {
  const name = toolName.toLowerCase();

  if (name === 'bash' || name.includes('command'))
    return { icon: Terminal, color: 'amber', bg: 'bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/40', label: 'Bash' };
  if (name === 'write')
    return { icon: Pencil, color: 'blue', bg: 'bg-blue-50 dark:bg-blue-950/20 hover:bg-blue-100 dark:hover:bg-blue-950/40', label: 'Write' };
  if (name === 'edit' || name === 'multiedit')
    return { icon: Pencil, color: 'emerald', bg: 'bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-950/40', label: name === 'multiedit' ? 'MultiEdit' : 'Edit' };
  if (name === 'read')
    return { icon: Eye, color: 'sky', bg: 'bg-sky-50 dark:bg-sky-950/20 hover:bg-sky-100 dark:hover:bg-sky-950/40', label: 'Read' };
  if (name === 'glob')
    return { icon: FolderOpen, color: 'violet', bg: 'bg-violet-50 dark:bg-violet-950/20 hover:bg-violet-100 dark:hover:bg-violet-950/40', label: 'Glob' };
  if (name === 'grep')
    return { icon: Search, color: 'orange', bg: 'bg-orange-50 dark:bg-orange-950/20 hover:bg-orange-100 dark:hover:bg-orange-950/40', label: 'Grep' };
  if (name === 'task')
    return { icon: Bot, color: 'indigo', bg: 'bg-indigo-50 dark:bg-indigo-950/20 hover:bg-indigo-100 dark:hover:bg-indigo-950/40', label: 'Task (Sub-agent)' };
  if (name.includes('web') || name.includes('fetch'))
    return { icon: Globe, color: 'cyan', bg: 'bg-cyan-50 dark:bg-cyan-950/20 hover:bg-cyan-100 dark:hover:bg-cyan-950/40', label: toolName };
  if (name.includes('notebook'))
    return { icon: Code2, color: 'pink', bg: 'bg-pink-50 dark:bg-pink-950/20 hover:bg-pink-100 dark:hover:bg-pink-950/40', label: 'NotebookEdit' };

  return { icon: Wrench, color: 'zinc', bg: 'bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-800/50', label: toolName };
}

function getToolPreview(toolName: string, input: Record<string, unknown>): string {
  if (input.command) return `$ ${String(input.command).slice(0, 80)}`;
  if (input.file_path) return String(input.file_path);
  if (input.pattern) return `"${input.pattern}"`;
  if (input.query) return `"${input.query}"`;
  if (input.url) return String(input.url).slice(0, 60);
  if (input.prompt) return String(input.prompt).slice(0, 60);
  if (input.subagent_type) return `[${input.subagent_type}]`;
  return '';
}

function formatModel(model: string): string {
  if (model.includes('opus-4-6')) return 'Opus 4.6';
  if (model.includes('opus-4-5')) return 'Opus 4.5';
  if (model.includes('sonnet-4-5')) return 'Sonnet 4.5';
  if (model.includes('sonnet-4-6')) return 'Sonnet 4.6';
  if (model.includes('haiku-4-5')) return 'Haiku 4.5';
  return model.split('-').slice(1, 3).join(' ');
}
