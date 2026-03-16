export { SignalPipeline } from './pipeline';
export type { SignalPipelineDeps } from './pipeline';
export { ConversationAdapter } from './adapters/conversation';
export { GitAdapter, parseGitLog } from './adapters/git';
export type { GitLogEntry } from './adapters/git';
export { DocumentAdapter, parseDocument, classifyDocument } from './adapters/document';
export type { SignalEnvelope, SignalAdapter, IngestResult, EdgeUpdate } from './types';
