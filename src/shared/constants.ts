export const RELEVANT_THRESHOLD = 0.7;
export const UNCERTAIN_THRESHOLD = 0.3;
export const MAX_CACHE_SIZE = 2000;
export const MAX_FEEDBACK_ENTRIES = 500;
export const MIN_FEEDBACK_FOR_WEIGHT = 3;
export const WEIGHT_FLOOR = 0.3;
export const WEIGHT_CEILING = 1.5;
export const MAX_AUTHOR_ENTRIES = 1000;
export const AUTHOR_SCORE_CAP = 0.15;

// AI scoring
export const AI_BATCH_SIZE = 10;
export const AI_BATCH_FLUSH_MS = 5000;
export const AI_FREE_DAILY_LIMIT = 50;
export const AI_PAID_DAILY_LIMIT = 1000;
export const AI_RATE_LIMIT_MS = 3000;
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const ELEPHANT_MODEL_ID = 'google/gemma-3-12b-it:free';
