import type { SidebarTweetEntry } from '../../shared/types';
import { MAX_SIDEBAR_ENTRIES, SIDEBAR_SAVE_DEBOUNCE_MS } from '../../shared/constants';
import {
  getSidebarEntries,
  saveSidebarEntries,
  clearSidebarEntries,
  getActiveSessionId,
  getSessionSidebarEntries,
  saveSessionSidebarEntries,
  clearSessionSidebarEntries,
  updateSessionTweetCount,
} from '../../shared/storage';

type Listener = () => void;

let entries: SidebarTweetEntry[] = [];
const listeners = new Set<Listener>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let loaded = false;
let activeSessionId: string | null = null;

export function getEntries(): readonly SidebarTweetEntry[] {
  return entries;
}

export async function loadEntries(): Promise<void> {
  if (loaded) return;
  loaded = true;

  // Read active session
  activeSessionId = await getActiveSessionId();

  const stored = activeSessionId
    ? await getSessionSidebarEntries(activeSessionId)
    : await getSidebarEntries();

  if (stored.length === 0) return;

  if (entries.length === 0) {
    entries = stored;
  } else {
    // Merge: keep in-memory entries and add stored ones that aren't already present
    const existingIds = new Set(entries.map((e) => e.tweetId));
    for (const s of stored) {
      if (!existingIds.has(s.tweetId)) {
        entries.push(s);
      }
    }
    if (entries.length > MAX_SIDEBAR_ENTRIES) {
      entries = entries.slice(entries.length - MAX_SIDEBAR_ENTRIES);
    }
  }

  notify();
}

export function addEntry(entry: SidebarTweetEntry): void {
  // Deduplicate by tweetId — if already present, update in place instead of re-adding.
  const existingIdx = entries.findIndex((e) => e.tweetId === entry.tweetId);
  if (existingIdx !== -1) {
    entries[existingIdx] = { ...entries[existingIdx], ...entry };
    notify();
    schedulePersist();
    return;
  }

  entries.push(entry);

  // FIFO cap
  if (entries.length > MAX_SIDEBAR_ENTRIES) {
    entries = entries.slice(entries.length - MAX_SIDEBAR_ENTRIES);
  }

  notify();
  schedulePersist();
}

export function updateEntry(tweetId: string, updates: Partial<SidebarTweetEntry>): void {
  const idx = entries.findIndex((e) => e.tweetId === tweetId);
  if (idx === -1) return;
  entries[idx] = { ...entries[idx], ...updates };
  notify();
  schedulePersist();
}

export function clearEntries(): void {
  entries = [];
  loaded = false;
  cancelPersist();
  if (activeSessionId) {
    clearSessionSidebarEntries(activeSessionId).catch(() => {});
  } else {
    clearSidebarEntries().catch(() => {});
  }
  notify();
}

export function resetEntries(): void {
  entries = [];
  cancelPersist();
  notify();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function switchSession(newSessionId: string | null): Promise<void> {
  // 1. Flush pending save for the old session
  flushPersist();

  // 2. Clear in-memory state
  entries = [];
  loaded = false;
  cancelPersist();

  // 3. Switch
  activeSessionId = newSessionId;

  // 4. Load new session's entries (if any)
  if (newSessionId) {
    const stored = await getSessionSidebarEntries(newSessionId);
    if (stored.length > 0) {
      entries = stored;
    }
    loaded = true;
  }

  notify();
}

function notify(): void {
  for (const fn of listeners) {
    fn();
  }
}

function schedulePersist(): void {
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow();
  }, SIDEBAR_SAVE_DEBOUNCE_MS);
}

function flushPersist(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
    persistNow();
  }
}

function persistNow(): void {
  const snapshot = [...entries];
  if (activeSessionId) {
    saveSessionSidebarEntries(activeSessionId, snapshot).catch(() => {});
    updateSessionTweetCount(activeSessionId, snapshot.length).catch(() => {});
  } else {
    saveSidebarEntries(snapshot).catch(() => {});
  }
}

function cancelPersist(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}
