import { getCached, setCached, clearCache } from './cache';
import { AiScoringEngine } from './ai-scoring';
import {
  getPreferences,
  savePreferences,
  getStats,
  updateStats,
  addFeedback,
  updateAuthorReputation,
  DEFAULT_AI_CONFIG,
} from '../shared/storage';
import { RELEVANT_THRESHOLD, UNCERTAIN_THRESHOLD } from '../shared/constants';
import type { MessageType, ScoreResponse } from '../shared/types';

// AI scoring engine — backend is now the canonical (only) scoring path.
const aiEngine = new AiScoringEngine(
  async () => {
    const prefs = await getPreferences();
    const config = prefs.aiConfig ?? { ...DEFAULT_AI_CONFIG };
    // Reset daily counter if date changed
    const today = new Date().toISOString().split('T')[0];
    if (config.lastResetDate !== today) {
      config.requestsUsedToday = 0;
      config.lastResetDate = today;
      prefs.aiConfig = config;
      await savePreferences(prefs);
    }
    return config;
  },
  async (used: number) => {
    const prefs = await getPreferences();
    if (prefs.aiConfig) {
      prefs.aiConfig.requestsUsedToday = used;
      await savePreferences(prefs);
    }
  }
);

// Daily budget reset alarm — wakes the SW so the getConfig callback can roll the counter.
chrome.alarms.create('feedlens-ai-daily-reset', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(() => {
  // No-op: getConfig handles the reset on next read.
});

chrome.runtime.onMessage.addListener(
  (
    message: MessageType,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    handleMessage(message, sender).then(sendResponse);
    return true; // keep channel open for async response
  }
);

/** Stub response returned for SCORE_TWEET. Real scoring happens via the backend AI path
 *  and arrives asynchronously through AI_SCORE_UPDATE. Score is on the universal 1-10 scale. */
const STUB_SCORE: ScoreResponse = {
  score: 5,
  matchedTopics: [],
  matchedKeywords: [],
};

async function handleMessage(
  message: MessageType,
  sender?: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'SCORE_TWEET': {
      const { tweetId, text, hasMedia } = message.payload;

      // Cache check (per-tweet)
      const cached = getCached(tweetId);
      if (cached) {
        // Still try to enqueue for AI in case it hasn't been scored yet.
        await maybeEnqueueAi(tweetId, text, sender);
        return cached;
      }

      // Empty media-only tweet → skip AI, return stub
      if (!text && hasMedia) {
        setCached(tweetId, STUB_SCORE);
        await trackStats(STUB_SCORE.score);
        return STUB_SCORE;
      }

      setCached(tweetId, STUB_SCORE);
      await trackStats(STUB_SCORE.score);
      await maybeEnqueueAi(tweetId, text, sender);
      return STUB_SCORE;
    }

    case 'GET_PREFERENCES':
      return getPreferences();

    case 'SAVE_PREFERENCES':
      await savePreferences(message.payload);
      clearCache();
      return { success: true };

    case 'CLEAR_CACHE':
      clearCache();
      return { success: true };

    case 'SUBMIT_FEEDBACK': {
      await addFeedback(message.payload);

      // Track author reputation from feedback (still useful as a signal even
      // though local keyword scoring is gone).
      const handle = message.payload.authorHandle;
      if (handle) {
        await updateAuthorReputation(handle, message.payload.isRelevant);
      }

      clearCache();
      return { success: true };
    }

    case 'GET_STATS':
      return getStats();

    case 'UPDATE_STATS':
      await updateStats(message.payload);
      return { success: true };

    case 'GET_AI_BUDGET': {
      const aiPrefs = await getPreferences();
      const aiCfg = aiPrefs.aiConfig ?? { ...DEFAULT_AI_CONFIG };
      const today = new Date().toISOString().split('T')[0];
      if (aiCfg.lastResetDate !== today) {
        aiCfg.requestsUsedToday = 0;
        aiCfg.lastResetDate = today;
        aiPrefs.aiConfig = aiCfg;
        await savePreferences(aiPrefs);
      }
      return {
        requestsUsedToday: aiCfg.requestsUsedToday,
        dailyLimit: aiCfg.dailyLimit,
      };
    }

    case 'AI_SCORE_UPDATE':
      // Pass-through — handled by content script's onMessage listener.
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

async function maybeEnqueueAi(
  tweetId: string,
  text: string,
  sender?: chrome.runtime.MessageSender
): Promise<void> {
  if (!sender?.tab?.id) return;
  const prefs = await getPreferences();
  const aiConfig = prefs.aiConfig;
  if (
    aiConfig?.enabled &&
    aiConfig.apiKey &&
    aiConfig.agenda.trim() &&
    aiConfig.requestsUsedToday < aiConfig.dailyLimit
  ) {
    console.log(`[FeedLens SW] enqueue tweet ${tweetId} for backend scoring`);
    aiEngine.enqueue({ tweetId, text, tabId: sender.tab.id });
  } else {
    console.log('[FeedLens SW] AI enqueue skipped — gate failed', {
      enabled: aiConfig?.enabled,
      hasApiKey: Boolean(aiConfig?.apiKey),
      hasAgenda: Boolean(aiConfig?.agenda?.trim()),
      budgetLeft:
        (aiConfig?.dailyLimit ?? 0) - (aiConfig?.requestsUsedToday ?? 0),
    });
  }
}

async function trackStats(score: number): Promise<void> {
  const stats = await getStats();
  stats.scanned++;
  if (score >= RELEVANT_THRESHOLD) {
    stats.relevant++;
  } else if (score < UNCERTAIN_THRESHOLD) {
    stats.filtered++;
  }
  await updateStats(stats);
}
