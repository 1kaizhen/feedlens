import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SidebarTweetEntry } from '../src/shared/types';

// We need to re-import fresh module for each test to reset state
// Use dynamic import with cache busting isn't viable, so we'll test the module directly
import { addEntry, getEntries, clearEntries, subscribe } from '../src/content/sidebar/sidebar-store';

function makeEntry(id: string, score = 0.5): SidebarTweetEntry {
  return {
    tweetId: id,
    text: `Tweet text ${id}`,
    authorHandle: `user_${id}`,
    hasMedia: false,
    isRetweet: false,
    score,
    matchedTopics: [],
    matchedKeywords: [],
    timestamp: Date.now(),
  };
}

describe('sidebar-store', () => {
  beforeEach(() => {
    clearEntries();
  });

  it('starts empty', () => {
    expect(getEntries()).toEqual([]);
  });

  it('adds entries', () => {
    addEntry(makeEntry('1'));
    addEntry(makeEntry('2'));
    expect(getEntries()).toHaveLength(2);
    expect(getEntries()[0].tweetId).toBe('1');
    expect(getEntries()[1].tweetId).toBe('2');
  });

  it('deduplicates by tweetId', () => {
    addEntry(makeEntry('1'));
    addEntry(makeEntry('1'));
    expect(getEntries()).toHaveLength(1);
  });

  it('caps at 500 entries (FIFO)', () => {
    for (let i = 0; i < 505; i++) {
      addEntry(makeEntry(`t${i}`));
    }
    const entries = getEntries();
    expect(entries).toHaveLength(500);
    // First 5 should be evicted
    expect(entries[0].tweetId).toBe('t5');
    expect(entries[entries.length - 1].tweetId).toBe('t504');
  });

  it('clears all entries', () => {
    addEntry(makeEntry('1'));
    addEntry(makeEntry('2'));
    clearEntries();
    expect(getEntries()).toEqual([]);
  });

  it('notifies subscribers on add', () => {
    const listener = vi.fn();
    subscribe(listener);
    addEntry(makeEntry('1'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers on clear', () => {
    const listener = vi.fn();
    addEntry(makeEntry('1'));
    subscribe(listener);
    clearEntries();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops notifications', () => {
    const listener = vi.fn();
    const unsub = subscribe(listener);
    addEntry(makeEntry('1'));
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    addEntry(makeEntry('2'));
    expect(listener).toHaveBeenCalledTimes(1); // not called again
  });
});
