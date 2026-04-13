import './content.css';
import { extractTweetData } from './tweet-parser';
import {
  applyTweetStyle,
  clearAllStyles,
  updateHiddenBanner,
  isTempShowAll,
} from './dom-modifier';
import { injectFeedbackOverlay } from './feedback-overlay';
import { trackDimmedTweet, resetDimmedCount } from './onboarding';
import type { FilterMode, ScoreResponse, UserPreferences } from '../shared/types';

const processedTweets = new Set<string>();
let currentFilterMode: FilterMode = 'dim';
let isEnabled = true;
let processingQueue: Element[] = [];
let isProcessing = false;

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
  } catch (err) {
    console.warn('[FeedLens] Service worker not ready, retrying in 1s...', err);
    setTimeout(init, 1000);
    return;
  }

  if (!isEnabled) return;

  // Start observing
  const observer = new MutationObserver((mutations) => {
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

  // Listen for preference changes
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.preferences) {
      const newPrefs = changes.preferences.newValue as UserPreferences;
      currentFilterMode = newPrefs.filterMode;
      isEnabled = newPrefs.enabled;
      reprocessAll();
    }
  });

  // Listen for reprocess event (from "Resume filtering" button)
  window.addEventListener('feedlens:reprocess', () => reprocessAll());

  console.log('[FeedLens] Content script initialized');
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

    if (isTempShowAll()) return;

    applyTweetStyle(article, response.score, currentFilterMode);

    if (response.score < 0.3 && currentFilterMode === 'dim') {
      trackDimmedTweet(article);
    }

    if (currentFilterMode === 'hide') {
      const hiddenCount = document.querySelectorAll('.feedlens-hidden').length;
      updateHiddenBanner(hiddenCount);
    }

    injectFeedbackOverlay(article, tweetData, response.matchedTopics);
  } catch {
    // Service worker might have restarted, skip this tweet
  }
}

function reprocessAll(): void {
  processedTweets.clear();
  clearAllStyles();
  resetDimmedCount();
  updateHiddenBanner(0);

  // Tell service worker to clear its score cache (prefs changed)
  chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }).catch(() => {});

  if (!isEnabled) return;

  document
    .querySelectorAll('article[data-testid="tweet"]')
    .forEach((tweet) => queueTweet(tweet));
}

init();
