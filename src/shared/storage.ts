import type { UserPreferences, SessionStats, FeedbackEntry } from './types';
import { MAX_FEEDBACK_ENTRIES } from './constants';

export const DEFAULT_PREFERENCES: UserPreferences = {
  selectedTopicIds: [],
  selectedKeywords: {},
  filterMode: 'dim',
  enabled: true,
  showOnboardingTooltip: true,
};

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_STATS: SessionStats = {
  scanned: 0,
  relevant: 0,
  filtered: 0,
  date: todayString(),
};

export async function getPreferences(): Promise<UserPreferences> {
  const result = await chrome.storage.local.get('preferences');
  return (result.preferences as UserPreferences | undefined) ?? { ...DEFAULT_PREFERENCES };
}

export async function savePreferences(prefs: UserPreferences): Promise<void> {
  await chrome.storage.local.set({ preferences: prefs });
}

export async function getStats(): Promise<SessionStats> {
  const result = await chrome.storage.local.get('stats');
  const stats: SessionStats = (result.stats as SessionStats | undefined) ?? { ...DEFAULT_STATS };
  if (stats.date !== todayString()) {
    const reset = { ...DEFAULT_STATS, date: todayString() };
    await chrome.storage.local.set({ stats: reset });
    return reset;
  }
  return stats;
}

export async function updateStats(
  updates: Partial<SessionStats>
): Promise<void> {
  const current = await getStats();
  const updated = { ...current, ...updates };
  await chrome.storage.local.set({ stats: updated });
}

export async function addFeedback(entry: FeedbackEntry): Promise<void> {
  const result = await chrome.storage.local.get('feedback');
  const feedback: FeedbackEntry[] = (result.feedback as FeedbackEntry[] | undefined) ?? [];
  feedback.push(entry);
  if (feedback.length > MAX_FEEDBACK_ENTRIES) {
    feedback.splice(0, feedback.length - MAX_FEEDBACK_ENTRIES);
  }
  await chrome.storage.local.set({ feedback });
}
