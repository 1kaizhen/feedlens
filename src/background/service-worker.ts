import { scoreTweet } from './scoring-engine';
import { getCached, setCached, clearCache } from './cache';
import {
  getPreferences,
  savePreferences,
  getStats,
  updateStats,
  addFeedback,
} from '../shared/storage';
import { RELEVANT_THRESHOLD, UNCERTAIN_THRESHOLD } from '../shared/constants';
import type { MessageType, ScoreResponse } from '../shared/types';

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

async function handleMessage(message: MessageType): Promise<unknown> {
  switch (message.type) {
    case 'SCORE_TWEET': {
      const { tweetId, text, hasMedia } = message.payload;

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
      const response = scoreTweet(
        text,
        prefs.selectedTopicIds,
        prefs.selectedKeywords
      );
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

    case 'SUBMIT_FEEDBACK':
      await addFeedback(message.payload);
      return { success: true };

    case 'GET_STATS':
      return getStats();

    case 'UPDATE_STATS':
      await updateStats(message.payload);
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
