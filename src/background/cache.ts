import type { ScoreResponse } from '../shared/types';
import { MAX_CACHE_SIZE } from '../shared/constants';

const cache = new Map<string, ScoreResponse>();

export function getCached(tweetId: string): ScoreResponse | undefined {
  const entry = cache.get(tweetId);
  if (entry) {
    // Move to end (most recently used)
    cache.delete(tweetId);
    cache.set(tweetId, entry);
  }
  return entry;
}

export function setCached(tweetId: string, score: ScoreResponse): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    // Delete oldest entry (first key)
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(tweetId, score);
}

export function clearCache(): void {
  cache.clear();
}
