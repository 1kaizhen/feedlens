import type { UserPreferences, SessionStats, FeedbackEntry, KeywordWeights, AuthorReputation, AiConfig } from './types';
import { MAX_FEEDBACK_ENTRIES, MAX_AUTHOR_ENTRIES, AI_FREE_DAILY_LIMIT } from './constants';

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  apiKey: '',
  agenda: '',
  dailyLimit: AI_FREE_DAILY_LIMIT,
  requestsUsedToday: 0,
  lastResetDate: new Date().toISOString().split('T')[0],
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  selectedTopicIds: [],
  selectedKeywords: {},
  filterMode: 'dim',
  enabled: true,
  showOnboardingTooltip: true,
  sidebarVisible: false,
  blockedKeywords: [],
  customKeywords: {},
  aiConfig: { ...DEFAULT_AI_CONFIG },
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

export async function getFeedback(): Promise<FeedbackEntry[]> {
  const result = await chrome.storage.local.get('feedback');
  return (result.feedback as FeedbackEntry[] | undefined) ?? [];
}

export async function getKeywordWeights(): Promise<KeywordWeights> {
  const result = await chrome.storage.local.get('keywordWeights');
  return (result.keywordWeights as KeywordWeights | undefined) ?? {};
}

export async function saveKeywordWeights(weights: KeywordWeights): Promise<void> {
  await chrome.storage.local.set({ keywordWeights: weights });
}

export async function getAuthorReputations(): Promise<Record<string, AuthorReputation>> {
  const result = await chrome.storage.local.get('authorReputations');
  return (result.authorReputations as Record<string, AuthorReputation> | undefined) ?? {};
}

export async function updateAuthorReputation(
  handle: string,
  isRelevant: boolean
): Promise<void> {
  const reputations = await getAuthorReputations();

  const existing = reputations[handle] ?? {
    handle,
    positiveCount: 0,
    negativeCount: 0,
    reputationScore: 0,
  };

  if (isRelevant) {
    existing.positiveCount++;
  } else {
    existing.negativeCount++;
  }

  const total = existing.positiveCount + existing.negativeCount;
  if (total >= 2) {
    const ratio = existing.positiveCount / total;
    existing.reputationScore = (ratio - 0.5) * 0.3;
  }

  reputations[handle] = existing;

  // Evict least recently updated if over limit
  const handles = Object.keys(reputations);
  if (handles.length > MAX_AUTHOR_ENTRIES) {
    // Remove first entry (oldest insertion order)
    delete reputations[handles[0]];
  }

  await chrome.storage.local.set({ authorReputations: reputations });
}
