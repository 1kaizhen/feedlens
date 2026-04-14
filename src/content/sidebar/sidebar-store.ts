import type { SidebarTweetEntry } from '../../shared/types';

const MAX_SIDEBAR_ENTRIES = 500;

type Listener = () => void;

let entries: SidebarTweetEntry[] = [];
const listeners = new Set<Listener>();

export function getEntries(): readonly SidebarTweetEntry[] {
  return entries;
}

export function addEntry(entry: SidebarTweetEntry): void {
  // Deduplicate by tweetId
  if (entries.some((e) => e.tweetId === entry.tweetId)) return;

  entries.push(entry);

  // FIFO cap
  if (entries.length > MAX_SIDEBAR_ENTRIES) {
    entries = entries.slice(entries.length - MAX_SIDEBAR_ENTRIES);
  }

  notify();
}

export function updateEntry(tweetId: string, updates: Partial<SidebarTweetEntry>): void {
  const idx = entries.findIndex((e) => e.tweetId === tweetId);
  if (idx === -1) return;
  entries[idx] = { ...entries[idx], ...updates };
  notify();
}

export function clearEntries(): void {
  entries = [];
  notify();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  for (const fn of listeners) {
    fn();
  }
}
