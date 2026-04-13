export interface TweetData {
  tweetId: string;
  text: string;
  authorHandle: string;
  hasMedia: boolean;
  isRetweet: boolean;
}

export interface ScoreResponse {
  score: number;
  matchedTopics: string[];
  matchedKeywords: string[];
}

export type FilterMode = 'dim' | 'hide' | 'off';

export interface UserPreferences {
  selectedTopicIds: string[];
  /** Per-topic keyword selection. Key = topicId, value = selected keywords.
   *  If a topic is selected but has no entry here, ALL its keywords are active. */
  selectedKeywords: Record<string, string[]>;
  filterMode: FilterMode;
  enabled: boolean;
  showOnboardingTooltip: boolean;
}

export interface SessionStats {
  scanned: number;
  relevant: number;
  filtered: number;
  date: string;
}

export interface FeedbackEntry {
  tweetId: string;
  tweetText: string;
  isRelevant: boolean;
  matchedTopics: string[];
  timestamp: number;
}

export type MessageType =
  | { type: 'SCORE_TWEET'; payload: TweetData }
  | { type: 'GET_PREFERENCES' }
  | { type: 'SAVE_PREFERENCES'; payload: UserPreferences }
  | { type: 'SUBMIT_FEEDBACK'; payload: FeedbackEntry }
  | { type: 'GET_STATS' }
  | { type: 'UPDATE_STATS'; payload: Partial<SessionStats> }
  | { type: 'CLEAR_CACHE' };
