import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock chrome.storage.local
const store: Record<string, unknown> = {};

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => {
        return { [key]: store[key] };
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      }),
    },
  },
};

// @ts-expect-error - mocking chrome global
globalThis.chrome = chromeMock;

// Dynamic import after mock is set up
const { getPreferences, savePreferences, getStats, addFeedback } = await import(
  '../src/shared/storage'
);

describe('storage', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) {
      delete store[key];
    }
    vi.clearAllMocks();
  });

  it('returns default preferences on first read', async () => {
    const prefs = await getPreferences();
    expect(prefs.selectedTopicIds).toEqual([]);
    expect(prefs.selectedKeywords).toEqual({});
    expect(prefs.filterMode).toBe('dim');
    expect(prefs.enabled).toBe(true);
    expect(prefs.showOnboardingTooltip).toBe(true);
  });

  it('round-trips preferences', async () => {
    const prefs = {
      selectedTopicIds: ['claude', 'ui-ux'],
      selectedKeywords: { claude: ['Claude AI', 'Anthropic'] },
      filterMode: 'hide' as const,
      enabled: true,
      showOnboardingTooltip: false,
    };
    await savePreferences(prefs);
    const loaded = await getPreferences();
    expect(loaded).toEqual(prefs);
  });

  it('returns fresh stats with today date', async () => {
    const stats = await getStats();
    expect(stats.scanned).toBe(0);
    expect(stats.relevant).toBe(0);
    expect(stats.filtered).toBe(0);
    expect(stats.date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('caps feedback at 500 entries (FIFO)', async () => {
    // Pre-fill with 500 entries
    const entries = Array.from({ length: 500 }, (_, i) => ({
      tweetId: `tweet-${i}`,
      tweetText: `text-${i}`,
      isRelevant: true,
      matchedTopics: [],
      timestamp: i,
    }));
    store.feedback = entries;

    // Add one more
    await addFeedback({
      tweetId: 'tweet-new',
      tweetText: 'new text',
      isRelevant: false,
      matchedTopics: ['claude'],
      timestamp: 999,
    });

    const saved = store.feedback as unknown[];
    expect(saved.length).toBe(500);
    // First entry should be tweet-1 (tweet-0 was evicted)
    expect((saved[0] as { tweetId: string }).tweetId).toBe('tweet-1');
    // Last entry should be the new one
    expect((saved[saved.length - 1] as { tweetId: string }).tweetId).toBe(
      'tweet-new'
    );
  });
});
