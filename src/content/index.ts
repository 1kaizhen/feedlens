import './content.css';
import { extractTweetData } from './tweet-parser';
import {
  applyTweetStyle,
  clearAllStyles,
  updateHiddenBanner,
  isTempShowAll,
} from './dom-modifier';
import { injectFeedbackOverlay } from './feedback-overlay';
import { resetDimmedCount } from './onboarding';
import { addEntry, clearEntries, updateEntry } from './sidebar/sidebar-store';
import { openSidebar, closeSidebar, isSidebarOpen } from './sidebar/sidebar';
import type { FilterMode, ScoreResponse, UserPreferences } from '../shared/types';

const processedTweets = new Set<string>();
/** Maps tweetId → { article element, keyword score } so we can update when AI results arrive */
const tweetArticleMap = new Map<string, { article: Element; keywordScore: number }>();
let currentFilterMode: FilterMode = 'dim';
let isEnabled = true;
let processingQueue: Element[] = [];
let isProcessing = false;
let observer: MutationObserver | null = null;

async function init(): Promise<void> {
  try {
    const prefs = (await chrome.runtime.sendMessage({
      type: 'GET_PREFERENCES',
    })) as UserPreferences | undefined;

    if (!prefs) {
      console.warn('[FeedLens] No preferences returned, retrying in 1s...');
      setTimeout(init, 1000);
      return;
    }

    currentFilterMode = prefs.filterMode;
    isEnabled = prefs.enabled;

    if (prefs.sidebarVisible) {
      openSidebar();
    }
  } catch (err) {
    console.warn('[FeedLens] Service worker not ready, retrying in 1s...', err);
    setTimeout(init, 1000);
    return;
  }

  // Always listen for preference changes (sidebar toggle, re-enable, etc.)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.preferences) {
      const newPrefs = changes.preferences.newValue as UserPreferences;
      currentFilterMode = newPrefs.filterMode;
      isEnabled = newPrefs.enabled;

      // Handle sidebar toggle
      if (newPrefs.sidebarVisible && !isSidebarOpen()) {
        openSidebar();
      } else if (!newPrefs.sidebarVisible && isSidebarOpen()) {
        closeSidebar();
      }

      reprocessAll();
    }
  });

  // Listen for reprocess event (from "Resume filtering" button)
  window.addEventListener('feedlens:reprocess', () => reprocessAll());

  // Listen for AI score updates from service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'AI_SCORE_UPDATE') {
      const { tweetId, aiScore, aiReasoning } = message.payload;
      handleAiScoreUpdate(tweetId, aiScore, aiReasoning);
    }
  });

  if (isEnabled) {
    startObserving();
  }

  console.log('[FeedLens] Content script initialized');
}

function startObserving(): void {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        if (node.matches?.('article[data-testid="tweet"]')) {
          queueTweet(node);
        }

        const tweets = node.querySelectorAll?.('article[data-testid="tweet"]');
        tweets?.forEach((tweet) => queueTweet(tweet));
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Process tweets already on page
  document
    .querySelectorAll('article[data-testid="tweet"]')
    .forEach((tweet) => queueTweet(tweet));
}

function queueTweet(element: Element): void {
  processingQueue.push(element);
  if (!isProcessing) {
    processQueue();
  }
}

async function processQueue(): Promise<void> {
  isProcessing = true;
  while (processingQueue.length > 0) {
    const batch = processingQueue.splice(0, 10);
    await Promise.all(batch.map((el) => processTweet(el)));
  }
  isProcessing = false;
}

async function processTweet(article: Element): Promise<void> {
  if (!isEnabled) return;

  const tweetData = extractTweetData(article);
  if (!tweetData) return;

  if (processedTweets.has(tweetData.tweetId)) {
    return;
  }
  processedTweets.add(tweetData.tweetId);

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'SCORE_TWEET',
      payload: tweetData,
    })) as ScoreResponse | undefined;

    if (!response) return;

    // Store article reference for AI score updates later
    tweetArticleMap.set(tweetData.tweetId, {
      article,
      keywordScore: response.score,
    });

    if (isTempShowAll()) return;

    applyTweetStyle(article, response.score, currentFilterMode);

    if (currentFilterMode === 'hide') {
      const hiddenCount = document.querySelectorAll('.feedlens-hidden').length;
      updateHiddenBanner(hiddenCount);
    }

    injectFeedbackOverlay(article, tweetData, response.matchedTopics, response.matchedKeywords);

    // Only show in sidebar if score > 5/10 (normalized: > 0.5)
    if (response.score > 0.5) {
      addEntry({
        ...tweetData,
        score: response.score,
        matchedTopics: response.matchedTopics,
        matchedKeywords: response.matchedKeywords,
        timestamp: Date.now(),
        aiScore: response.aiScore,
        aiReasoning: response.aiReasoning,
      });
    }
  } catch {
    // Service worker might have restarted, skip this tweet
  }
}

function handleAiScoreUpdate(tweetId: string, aiScore: number, aiReasoning: string): void {
  const tracked = tweetArticleMap.get(tweetId);
  if (!tracked) return;

  const { article, keywordScore } = tracked;
  const mergedScore = Math.max(keywordScore, aiScore);

  // Re-apply style if AI score promotes the tweet
  if (aiScore > keywordScore && !isTempShowAll()) {
    applyTweetStyle(article, mergedScore, currentFilterMode);
  }

  // Update sidebar entry
  updateEntry(tweetId, { aiScore, aiReasoning, score: mergedScore });
}

function reprocessAll(): void {
  processedTweets.clear();
  tweetArticleMap.clear();
  clearAllStyles();
  resetDimmedCount();
  updateHiddenBanner(0);
  clearEntries();

  // Tell service worker to clear its score cache (prefs changed)
  chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }).catch(() => {});

  if (!isEnabled) {
    // Stop observing if extension was just disabled
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    return;
  }

  // Start observing if not already (extension was just re-enabled)
  startObserving();

  document
    .querySelectorAll('article[data-testid="tweet"]')
    .forEach((tweet) => queueTweet(tweet));
}

init();
