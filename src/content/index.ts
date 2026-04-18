import './content.css';
import { extractTweetData } from './tweet-parser';
import { injectFeedbackOverlay } from './feedback-overlay';
import { addEntry, clearEntries, updateEntry } from './sidebar/sidebar-store';
import { openSidebar, closeSidebar, isSidebarOpen } from './sidebar/sidebar';
import { autoScroller } from './auto-scroll';
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

    if (prefs.autoScrollEnabled && prefs.enabled) {
      autoScroller.start();
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
      const wasEnabled = isEnabled;
      const wasAiEnabled = isAiEnabled;

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

      // Handle auto-scroll toggle
      if (newPrefs.autoScrollEnabled && newPrefs.enabled) {
        autoScroller.start();
      } else {
        autoScroller.stop();
      }

      // Only reprocess if scoring-relevant prefs changed (not just sidebar visibility).
      if (wasEnabled !== isEnabled || wasAiEnabled !== isAiEnabled) {
        reprocessAll();
      }
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

  // Record the tweet BEFORE calling SCORE_TWEET so that even if the SW is asleep
  // and the message fails, a late AI_SCORE_UPDATE can still find the tweet data.
  tweetArticleMap.set(tweetData.tweetId, {
    tweetData,
    matchedTopics: [],
    matchedKeywords: [],
  });
  processedTweets.add(tweetData.tweetId);

  try {
    const response = (await chrome.runtime.sendMessage({
      type: 'SCORE_TWEET',
      payload: tweetData,
    })) as ScoreResponse | undefined;

    if (!response) return;

    // Update with matched topics/keywords (still empty in AI-only mode, but future-proof).
    tweetArticleMap.set(tweetData.tweetId, {
      tweetData,
      matchedTopics: response.matchedTopics,
      matchedKeywords: response.matchedKeywords,
    });

    injectFeedbackOverlay(article, tweetData, response.matchedTopics, response.matchedKeywords);

    // Sidebar entries are driven exclusively by AI/backend scores (see handleAiScoreUpdate).
  } catch (err) {
    // SW might have briefly slept — the tweet is already in tweetArticleMap,
    // so a late AI update will still populate the sidebar.
    console.warn('[FeedLens] SCORE_TWEET failed (will rely on AI update if it arrives):', err);
  }
}

function handleAiScoreUpdate(tweetId: string, aiScore: number, aiReasoning: string): void {
  const tracked = tweetArticleMap.get(tweetId);

  // If we have tracked context, use it. Otherwise fall back to a minimal entry
  // so data is never dropped (e.g. when reprocessAll cleared the map mid-flight).
  const baseEntry = tracked?.tweetData
    ? {
        ...tracked.tweetData,
        matchedTopics: tracked.matchedTopics,
        matchedKeywords: tracked.matchedKeywords,
      }
    : {
        tweetId,
        text: '',
        authorHandle: 'unknown',
        hasMedia: false,
        isRetweet: false,
        matchedTopics: [] as string[],
        matchedKeywords: [] as string[],
      };

  console.log(`[FeedLens] +sidebar card  score=${aiScore.toFixed(1)}/10  ${tweetId}`);

  autoScroller.incrementCollected();

  // Always add — sidebar shows all AI-scored tweets; user sorts/filters via UI.
  addEntry({
    ...baseEntry,
    score: aiScore,
    timestamp: Date.now(),
    aiScore,
    aiReasoning,
  });

  // If the entry already existed (duplicate delivery), refresh its score fields.
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
