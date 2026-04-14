import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FeedbackEntry, KeywordWeights } from '../src/shared/types';

// Mock chrome storage
const store: Record<string, unknown> = {};
globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: store[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items)),
    },
  },
} as unknown as typeof chrome;

import {
  getFeedback,
  getKeywordWeights,
  saveKeywordWeights,
  addFeedback,
  getAuthorReputations,
  updateAuthorReputation,
} from '../src/shared/storage';

beforeEach(() => {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  vi.clearAllMocks();
});

describe('keyword weights storage', () => {
  it('returns empty object when no weights stored', async () => {
    const weights = await getKeywordWeights();
    expect(weights).toEqual({});
  });

  it('saves and retrieves keyword weights', async () => {
    const weights: KeywordWeights = {
      'claude::LLM': {
        keyword: 'LLM',
        topicId: 'claude',
        weight: 1.2,
        positiveCount: 8,
        negativeCount: 2,
      },
    };
    await saveKeywordWeights(weights);
    const loaded = await getKeywordWeights();
    expect(loaded).toEqual(weights);
  });
});

describe('feedback storage', () => {
  it('returns empty array when no feedback stored', async () => {
    const feedback = await getFeedback();
    expect(feedback).toEqual([]);
  });

  it('stores feedback with matchedKeywords and authorHandle', async () => {
    const entry: FeedbackEntry = {
      tweetId: '123',
      tweetText: 'Test tweet',
      isRelevant: true,
      matchedTopics: ['claude'],
      matchedKeywords: ['Claude AI', 'LLM'],
      authorHandle: 'testuser',
      timestamp: Date.now(),
    };
    await addFeedback(entry);
    const feedback = await getFeedback();
    expect(feedback).toHaveLength(1);
    expect(feedback[0].matchedKeywords).toEqual(['Claude AI', 'LLM']);
    expect(feedback[0].authorHandle).toBe('testuser');
  });
});

describe('author reputation storage', () => {
  it('returns empty object when no reputations stored', async () => {
    const reps = await getAuthorReputations();
    expect(reps).toEqual({});
  });

  it('creates new reputation on first feedback', async () => {
    await updateAuthorReputation('user1', true);
    const reps = await getAuthorReputations();
    expect(reps['user1']).toBeDefined();
    expect(reps['user1'].positiveCount).toBe(1);
    expect(reps['user1'].negativeCount).toBe(0);
    // Only 1 vote, need >= 2 for score calculation
    expect(reps['user1'].reputationScore).toBe(0);
  });

  it('computes reputation score after 2 votes', async () => {
    await updateAuthorReputation('user1', true);
    await updateAuthorReputation('user1', true);
    const reps = await getAuthorReputations();
    // 2/2 positive → ratio 1.0, score = (1.0 - 0.5) * 0.3 = 0.15
    expect(reps['user1'].reputationScore).toBeCloseTo(0.15);
  });

  it('computes negative reputation', async () => {
    await updateAuthorReputation('user1', false);
    await updateAuthorReputation('user1', false);
    const reps = await getAuthorReputations();
    // 0/2 positive → ratio 0.0, score = (0.0 - 0.5) * 0.3 = -0.15
    expect(reps['user1'].reputationScore).toBeCloseTo(-0.15);
  });

  it('computes mixed reputation', async () => {
    await updateAuthorReputation('user1', true);
    await updateAuthorReputation('user1', false);
    const reps = await getAuthorReputations();
    // 1/2 → ratio 0.5, score = (0.5 - 0.5) * 0.3 = 0
    expect(reps['user1'].reputationScore).toBeCloseTo(0);
  });
});
