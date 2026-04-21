// All relevance scores in FeedLens are on a UNIVERSAL 1-10 scale.
// Backend returns 0-10 from the LLM, and that value flows through the
// extension unmodified. 0 is reserved for "no score yet / error".
export const RELEVANT_THRESHOLD = 7;
export const UNCERTAIN_THRESHOLD = 3;

export const MAX_CACHE_SIZE = 2000;
export const DAILY_SCAN_LIMIT = 2000;
export const MAX_FEEDBACK_ENTRIES = 500;
export const MIN_FEEDBACK_FOR_WEIGHT = 3;
export const WEIGHT_FLOOR = 0.3;
export const WEIGHT_CEILING = 1.5;
export const MAX_AUTHOR_ENTRIES = 1000;
export const AUTHOR_SCORE_CAP = 0.15;
export const MAX_SIDEBAR_ENTRIES = 500;
export const SIDEBAR_STORAGE_KEY = 'sidebarEntries';
export const SIDEBAR_SAVE_DEBOUNCE_MS = 2000;

// Sessions
export const SESSIONS_STORAGE_KEY = 'sessions';
export const ACTIVE_SESSION_STORAGE_KEY = 'activeSessionId';
export const SESSION_ENTRIES_PREFIX = 'sidebarEntries_';
export const MAX_SESSIONS = 50;

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
