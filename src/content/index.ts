import './content.css';
import { extractTweetData } from './tweet-parser';
import { SIDEBAR_AI_THRESHOLD } from '../shared/constants';
import { injectFeedbackOverlay } from './feedback-overlay';
import { addEntry, clearEntries, updateEntry } from './sidebar/sidebar-store';
import { openSidebar, closeSidebar, isSidebarOpen } from './sidebar/sidebar';
import type { ScoreResponse, UserPreferences } from '../shared/types';

const processedTweets = new Set<string>();
/** Maps tweetId → tweet context so AI results can populate the sidebar when they arrive. */
const tweetArticleMap = new Map<
  string,
  {
    tweetData: ReturnType<typeof extractTweetData>;
    matchedTopics: string[];
    matchedKeywords: string[];
  }
>();
let isEnabled = true;
let isAiEnabled = false;
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

    isEnabled = prefs.enabled;
    isAiEnabled = Boolean(prefs.aiConfig?.enabled && prefs.aiConfig?.agenda?.trim() && prefs.aiConfig?.apiKey);

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
      isEnabled = newPrefs.enabled;
      isAiEnabled = Boolean(
        newPrefs.aiConfig?.enabled && newPrefs.aiConfig?.agenda?.trim() && newPrefs.aiConfig?.apiKey
      );

      // Handle sidebar toggle
      if (newPrefs.sidebarVisible && !isSidebarOpen()) {
        openSidebar();
      } else if (!newPrefs.sidebarVisible && isSidebarOpen()) {
        closeSidebar();
      }

      reprocessAll();
    }
  });

  // Listen for reprocess event (e.g., after preference change)
  window.addEventListener('feedlens:reprocess', () => reprocessAll());

  // Listen for AI score updates from service worker (backend-powered)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'AI_SCORE_UPDATE') {
      const { tweetId, aiScore, aiReasoning } = message.payload;
      console.log('[FeedLens] AI_SCORE_UPDATE received', { tweetId, aiScore, aiReasoning });
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

    // Remember tweet context so the sidebar can be populated when the AI result arrives.
    tweetArticleMap.set(tweetData.tweetId, {
      tweetData,
      matchedTopics: response.matchedTopics,
      matchedKeywords: response.matchedKeywords,
    });

    injectFeedbackOverlay(article, tweetData, response.matchedTopics, response.matchedKeywords);

    // Sidebar entries are driven exclusively by AI/backend scores (see handleAiScoreUpdate).
  } catch {
    // Service worker might have restarted, skip this tweet
  }
}

function handleAiScoreUpdate(tweetId: string, aiScore: number, aiReasoning: string): void {
  const tracked = tweetArticleMap.get(tweetId);
  if (!tracked || !tracked.tweetData) {
    console.log('[FeedLens] AI score arrived for untracked tweet', tweetId);
    return;
  }

  const { tweetData, matchedTopics, matchedKeywords } = tracked;

  // Backend returns 0-10, normalized here to 0-1. Threshold 0.5 == backend score >= 5/10.
  if (isAiEnabled && aiScore >= SIDEBAR_AI_THRESHOLD) {
    console.log(`[FeedLens] +sidebar card  score=${aiScore.toFixed(2)}  ${tweetId}`);
    addEntry({
      ...tweetData,
      score: aiScore,
      matchedTopics,
      matchedKeywords,
      timestamp: Date.now(),
      aiScore,
      aiReasoning,
    });
  } else {
    console.log(
      `[FeedLens] -filtered (below ${SIDEBAR_AI_THRESHOLD})  score=${aiScore.toFixed(2)}  ${tweetId}`
    );
  }

  updateEntry(tweetId, { aiScore, aiReasoning, score: aiScore });
}

function reprocessAll(): void {
  processedTweets.clear();
  tweetArticleMap.clear();
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
