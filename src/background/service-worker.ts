import { scoreTweet } from './scoring-engine';
import { getCached, setCached, clearCache } from './cache';
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
  OPENROUTER_API_URL,
  ELEPHANT_MODEL_ID,
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

// Periodic alarm to keep the service worker alive and handle daily budget resets
chrome.alarms.create('feedlens-daily-reset', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(() => {
  // Wakes the SW up; GET_AI_BUDGET handler handles the actual reset logic
});

chrome.runtime.onMessage.addListener(
  (
    message: MessageType,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    handleMessage(message).then(sendResponse);
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

async function handleMessage(message: MessageType): Promise<unknown> {
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
      const aiConfig = prefs.aiConfig;

      console.log('[FeedLens] SCORE_TWEET', {
        tweetId,
        enabled: aiConfig?.enabled,
        hasKey: !!aiConfig?.apiKey,
        hasAgenda: !!aiConfig?.agenda?.trim(),
      });

      // Primary: AI scoring via OpenRouter (when agenda + API key are configured)
      if (aiConfig?.enabled && aiConfig.apiKey && aiConfig.agenda.trim()) {
        try {
          const { postedAt, likes, views } = message.payload;
          const contextLines: string[] = [`Tweet: "${text}"`];
          if (postedAt) contextLines.push(`Posted: ${postedAt}`);
          if (likes != null) contextLines.push(`Likes: ${likes}`);
          if (views != null) contextLines.push(`Views: ${views}`);

          const openRouterRes = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${aiConfig.apiKey}`,
              'HTTP-Referer': 'https://feedlens.extension',
              'X-Title': 'FeedLens',
            },
            body: JSON.stringify({
              model: ELEPHANT_MODEL_ID,
              messages: [
                {
                  role: 'system',
                  content:
                    'You score a tweet for relevance to the user\'s agenda on a scale of 0–10. ' +
                    'Factors: text relevance (most important), recency, engagement (likes/views). ' +
                    'Respond with ONLY a JSON object: {"score": <0-10>, "reason": "<one sentence>"}',
                },
                {
                  role: 'user',
                  content: `Agenda: "${aiConfig.agenda}"\n\n${contextLines.join('\n')}`,
                },
              ],
              temperature: 0.1,
              max_tokens: 100,
            }),
          });

          if (openRouterRes.ok) {
            const data = await openRouterRes.json() as { choices: Array<{ message: { content: string } }> };
            const content = data.choices?.[0]?.message?.content ?? '';
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]) as { score?: number; reason?: string };
              if (typeof parsed.score === 'number' && parsed.score >= 0 && parsed.score <= 10) {
                prefs.aiConfig.requestsUsedToday = (prefs.aiConfig.requestsUsedToday ?? 0) + 1;
                await savePreferences(prefs);

                const normalizedScore = parsed.score / 10;
                const response: ScoreResponse = {
                  score: normalizedScore,
                  matchedTopics: [],
                  matchedKeywords: [],
                  aiScore: parsed.score,
                  aiReasoning: parsed.reason ?? '',
                };
                setCached(tweetId, response);
                await trackStats(response.score);
                console.log(`[FeedLens] AI scored: ${parsed.score}/10 — ${parsed.reason}`);
                return response;
              }
            }
            console.warn('[FeedLens] Could not parse AI response:', content);
          } else {
            const errText = await openRouterRes.text();
            console.warn('[FeedLens] OpenRouter error:', openRouterRes.status, errText);
          }
        } catch (err) {
          console.warn('[FeedLens] AI scoring failed:', err);
        }
      }

      // Fallback: keyword scoring
      const weights = await ensureWeightsLoaded();
      const reputations = await ensureReputationsLoaded();

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
