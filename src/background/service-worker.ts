import { scoreTweet } from './scoring-engine';
import { getCached, setCached, clearCache } from './cache';
import { AiScoringEngine } from './ai-scoring';
import {
  getPreferences,
  savePreferences,
  getStats,
  updateStats,
  addFeedback,
  getFeedback,
  getKeywordWeights,
  saveKeywordWeights,
  getAuthorReputations,
  updateAuthorReputation,
  DEFAULT_AI_CONFIG,
} from '../shared/storage';
import {
  RELEVANT_THRESHOLD,
  UNCERTAIN_THRESHOLD,
  MIN_FEEDBACK_FOR_WEIGHT,
  WEIGHT_FLOOR,
  WEIGHT_CEILING,
} from '../shared/constants';
import type {
  MessageType,
  ScoreResponse,
  KeywordWeights,
  AuthorReputation,
} from '../shared/types';

// In-memory caches (rebuilt from storage on SW wake)
let cachedKeywordWeights: KeywordWeights | null = null;
let cachedAuthorReputations: Record<string, AuthorReputation> | null = null;

// AI scoring engine
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

// Daily budget reset alarm
chrome.alarms.create('feedlens-ai-daily-reset', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'feedlens-ai-daily-reset') {
    // The getConfig callback in aiEngine already handles daily reset
    // This alarm just ensures the SW wakes up to check
  }
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

async function ensureWeightsLoaded(): Promise<KeywordWeights> {
  if (!cachedKeywordWeights) {
    cachedKeywordWeights = await getKeywordWeights();
  }
  return cachedKeywordWeights;
}

async function ensureReputationsLoaded(): Promise<Record<string, AuthorReputation>> {
  if (!cachedAuthorReputations) {
    cachedAuthorReputations = await getAuthorReputations();
  }
  return cachedAuthorReputations;
}

async function recomputeWeights(): Promise<void> {
  const feedback = await getFeedback();
  const tally: Record<string, { positive: number; negative: number }> = {};

  for (const entry of feedback) {
    const keywords = entry.matchedKeywords ?? [];
    const topics = entry.matchedTopics ?? [];

    for (const topicId of topics) {
      for (const kw of keywords) {
        const key = `${topicId}::${kw}`;
        if (!tally[key]) tally[key] = { positive: 0, negative: 0 };
        if (entry.isRelevant) {
          tally[key].positive++;
        } else {
          tally[key].negative++;
        }
      }
    }
  }

  const weights: KeywordWeights = {};
  for (const [key, counts] of Object.entries(tally)) {
    const total = counts.positive + counts.negative;
    const [topicId, ...kwParts] = key.split('::');
    const keyword = kwParts.join('::');

    if (total < MIN_FEEDBACK_FOR_WEIGHT) {
      weights[key] = {
        keyword,
        topicId,
        weight: 1.0,
        positiveCount: counts.positive,
        negativeCount: counts.negative,
      };
    } else {
      const positiveRatio = counts.positive / total;
      const weight = Math.max(
        WEIGHT_FLOOR,
        Math.min(WEIGHT_CEILING, WEIGHT_FLOOR + positiveRatio * (WEIGHT_CEILING - WEIGHT_FLOOR))
      );
      weights[key] = {
        keyword,
        topicId,
        weight,
        positiveCount: counts.positive,
        negativeCount: counts.negative,
      };
    }
  }

  await saveKeywordWeights(weights);
  cachedKeywordWeights = weights;
}

async function handleMessage(
  message: MessageType,
  sender?: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'SCORE_TWEET': {
      const { tweetId, text, hasMedia, authorHandle } = message.payload;

      // Check cache first
      const cached = getCached(tweetId);
      if (cached) return cached;

      // Media-only tweets get uncertain score
      if (!text && hasMedia) {
        const response: ScoreResponse = {
          score: 0.5,
          matchedTopics: [],
          matchedKeywords: [],
        };
        setCached(tweetId, response);
        await trackStats(response.score);
        return response;
      }

      const prefs = await getPreferences();
      const weights = await ensureWeightsLoaded();
      const reputations = await ensureReputationsLoaded();

      // Look up author reputation bonus
      let authorBonus: number | undefined;
      if (authorHandle && reputations[authorHandle]) {
        authorBonus = reputations[authorHandle].reputationScore;
      }

      const response = scoreTweet(text, prefs.selectedTopicIds, {
        selectedKeywords: prefs.selectedKeywords,
        blockedKeywords: prefs.blockedKeywords ?? [],
        keywordWeights: weights,
        customKeywords: prefs.customKeywords ?? {},
        authorBonus,
      });
      setCached(tweetId, response);
      await trackStats(response.score);

      // Enqueue for AI scoring if enabled and API key is set
      const aiConfig = prefs.aiConfig;
      if (
        aiConfig?.enabled &&
        aiConfig.apiKey &&
        aiConfig.agenda.trim() &&
        aiConfig.requestsUsedToday < aiConfig.dailyLimit &&
        sender?.tab?.id
      ) {
        aiEngine.enqueue({ tweetId, text, tabId: sender.tab.id });
      }

      return response;
    }

    case 'GET_PREFERENCES':
      return getPreferences();

    case 'SAVE_PREFERENCES':
      await savePreferences(message.payload);
      clearCache(); // scores depend on preferences, invalidate all
      return { success: true };

    case 'CLEAR_CACHE':
      clearCache();
      return { success: true };

    case 'SUBMIT_FEEDBACK': {
      await addFeedback(message.payload);

      // Update author reputation if handle provided
      const handle = message.payload.authorHandle;
      if (handle) {
        await updateAuthorReputation(handle, message.payload.isRelevant);
        cachedAuthorReputations = null; // invalidate in-memory cache
      }

      // Recompute keyword weights and invalidate score cache
      await recomputeWeights();
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
      // Reset if new day
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
      // Pass-through — handled by content script's onMessage listener
      return { success: true };

    default:
      return { error: 'Unknown message type' };
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
