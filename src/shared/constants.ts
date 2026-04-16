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
export const ELEPHANT_MODEL_ID = 'openrouter/elephant-alpha';

// Backend (canonical AI scoring path — see backend/server.js)
export const BACKEND_SCORE_URL = 'http://localhost:3001/score';

// Sidebar threshold: only AI-scored tweets at/above this normalized score (0-1)
// are added to the sidebar. 0.5 corresponds to backend score >= 5/10.
export const SIDEBAR_AI_THRESHOLD = 0.5;
