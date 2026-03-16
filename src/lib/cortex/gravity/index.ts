export { computePromotionScore, shouldPromote, getNextLevel, HOP_DECAY, PROMOTION_TYPE_WEIGHTS } from './promotion';
export { getTrickleMode, TRICKLE_DEFAULTS } from './trickle';
export type { TrickleMode } from './trickle';
export { detectSentimentConflict, CONTRADICTION_COSINE_THRESHOLD, DEDUP_COSINE_THRESHOLD } from './contradiction';
export { computeDecay, shouldArchive, ARCHIVE_THRESHOLD } from './decay';
export { GravityScheduler, GRAVITY_INTERVAL_MS } from './scheduler';
export type { GravitySchedulerConfig } from './scheduler';
