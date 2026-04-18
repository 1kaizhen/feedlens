export interface TweetData {
  tweetId: string;
  text: string;
  authorHandle: string;
  hasMedia: boolean;
  isRetweet: boolean;
  postedAt?: string;  // ISO datetime from <time> element
  likes?: number;
  views?: number;
}

export interface ScoreResponse {
  /** Relevance on the universal 0-10 scale (1 decimal place). */
  score: number;
  matchedTopics: string[];
  matchedKeywords: string[];
  /** AI relevance on the universal 0-10 scale (1 decimal place). */
  aiScore?: number;
  aiReasoning?: string;
}

export interface AiConfig {
  enabled: boolean;
  apiKey: string;
  agenda: string;
  dailyLimit: number;
  requestsUsedToday: number;
  lastResetDate: string;
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
  sidebarVisible: boolean;
  blockedKeywords: string[];
  customKeywords: Record<string, { keywords: string[]; contextTerms: string[] }>;
  aiConfig: AiConfig;
  autoScrollEnabled: boolean;
}

export interface SidebarTweetEntry {
  tweetId: string;
  text: string;
  authorHandle: string;
  hasMedia: boolean;
  isRetweet: boolean;
  /** Relevance on the universal 0-10 scale (1 decimal place). */
  score: number;
  matchedTopics: string[];
  matchedKeywords: string[];
  timestamp: number;
  /** AI relevance on the universal 0-10 scale (1 decimal place). */
  aiScore?: number;
  aiReasoning?: string;
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
  matchedKeywords: string[];
  authorHandle: string;
  timestamp: number;
}

export interface KeywordWeight {
  keyword: string;
  topicId: string;
  weight: number;
  positiveCount: number;
  negativeCount: number;
}

export type KeywordWeights = Record<string, KeywordWeight>;

export interface AuthorReputation {
  handle: string;
  positiveCount: number;
  negativeCount: number;
  reputationScore: number;
}

export interface SummarizeTweetItem {
  tweetId: string;
  text: string;
  authorHandle: string;
}

export type MessageType =
  | { type: 'SCORE_TWEET'; payload: TweetData }
  | { type: 'GET_PREFERENCES' }
  | { type: 'SAVE_PREFERENCES'; payload: UserPreferences }
  | { type: 'SUBMIT_FEEDBACK'; payload: FeedbackEntry }
  | { type: 'GET_STATS' }
  | { type: 'UPDATE_STATS'; payload: Partial<SessionStats> }
  | { type: 'CLEAR_CACHE' }
  | { type: 'AI_SCORE_UPDATE'; payload: { tweetId: string; aiScore: number; aiReasoning: string } }
  | { type: 'GET_AI_BUDGET' }
  | { type: 'SUMMARIZE_TWEETS'; payload: { tweets: SummarizeTweetItem[] } };
