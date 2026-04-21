import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { SidebarTweetEntry } from '../src/shared/types';

const store: Record<string, unknown> = {};
globalThis.chrome = {
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({ [key]: store[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => Object.assign(store, items)),
      remove: vi.fn(async (key: string) => { delete store[key]; }),
    },
  },
} as unknown as typeof chrome;

import {
  addEntry,
  getEntries,
  clearEntries,
  subscribe,
  loadEntries,
  resetEntries,
} from '../src/content/sidebar/sidebar-store';

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
    vi.useFakeTimers();
    clearEntries();
    // Reset mock store
    for (const key of Object.keys(store)) {
      delete store[key];
    }
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  // --- Persistence tests ---

  it('addEntry debounces writes to storage', () => {
    addEntry(makeEntry('a'));
    addEntry(makeEntry('b'));
    addEntry(makeEntry('c'));

    // No writes yet — debounce hasn't fired
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);

    // Single batched write
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    const savedEntries = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls[0][0].sidebarEntries;
    expect(savedEntries).toHaveLength(3);
    expect(savedEntries.map((e: SidebarTweetEntry) => e.tweetId)).toEqual(['a', 'b', 'c']);
  });

  it('clearEntries calls chrome.storage.local.remove', () => {
    addEntry(makeEntry('1'));
    clearEntries();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('sidebarEntries');
  });

  it('resetEntries clears memory but NOT storage', () => {
    addEntry(makeEntry('1'));
    addEntry(makeEntry('2'));

    // Flush pending persist first
    vi.advanceTimersByTime(2000);
    vi.clearAllMocks();

    resetEntries();
    expect(getEntries()).toEqual([]);
    // Should NOT have called remove or set
    expect(chrome.storage.local.remove).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('loadEntries hydrates from storage into empty in-memory array', async () => {
    const storedEntries = [makeEntry('s1', 8), makeEntry('s2', 5)];
    store['sidebarEntries'] = storedEntries;

    await loadEntries();

    const entries = getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].tweetId).toBe('s1');
    expect(entries[1].tweetId).toBe('s2');
  });

  it('loadEntries merges when both storage and memory have entries', async () => {
    // Add in-memory entry first
    addEntry(makeEntry('mem1'));

    // Put different entries in storage
    store['sidebarEntries'] = [makeEntry('stor1'), makeEntry('stor2')];

    await loadEntries();

    const entries = getEntries();
    expect(entries).toHaveLength(3);
    // In-memory entry is first, then storage entries that weren't duplicates
    expect(entries.map((e) => e.tweetId)).toEqual(['mem1', 'stor1', 'stor2']);
  });

  it('loadEntries does not double-hydrate', async () => {
    store['sidebarEntries'] = [makeEntry('s1')];

    await loadEntries();
    expect(getEntries()).toHaveLength(1);

    // Add more to storage after first load
    store['sidebarEntries'] = [makeEntry('s1'), makeEntry('s2'), makeEntry('s3')];

    await loadEntries(); // should be a no-op
    expect(getEntries()).toHaveLength(1); // unchanged
  });
});
