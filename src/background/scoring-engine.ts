import type { ScoreResponse } from '../shared/types';
import { TOPIC_CATEGORIES } from './topic-keywords';

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeTweetText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/@\w+/g, '')
    .replace(
      /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesKeyword(text: string, keyword: string): boolean {
  const lower = keyword.toLowerCase();
  if (lower.length <= 3) {
    const regex = new RegExp(`\\b${escapeRegex(lower)}\\b`, 'i');
    return regex.test(text);
  }
  return text.includes(lower);
}

/**
 * @param selectedKeywords - optional per-topic keyword filter.
 *   Key = topicId, value = array of keywords to match against.
 *   If a topic has no entry, ALL its keywords + contextTerms are used.
 */
export function scoreTweet(
  text: string,
  selectedTopicIds: string[],
  selectedKeywords?: Record<string, string[]>
): ScoreResponse {
  const normalized = normalizeTweetText(text);
  let bestScore = 0;
  const matchedTopics: string[] = [];
  const matchedKeywords: string[] = [];

  for (const topicId of selectedTopicIds) {
    const topic = TOPIC_CATEGORIES.find((t) => t.id === topicId);
    if (!topic) continue;

    // Determine which keywords/context terms are active
    const activeSet = selectedKeywords?.[topicId];
    const activeKeywords = activeSet
      ? topic.keywords.filter((kw) => activeSet.includes(kw))
      : topic.keywords;
    const activeContext = activeSet
      ? topic.contextTerms.filter((ct) => activeSet.includes(ct))
      : topic.contextTerms;

    let topicScore = 0;

    // Check primary keywords first
    let primaryMatch = false;
    for (const kw of activeKeywords) {
      if (matchesKeyword(normalized, kw)) {
        topicScore = 1.0;
        primaryMatch = true;
        matchedKeywords.push(kw);
        break;
      }
    }

    // If no primary match, check context terms
    if (!primaryMatch) {
      let contextCount = 0;
      for (const ct of activeContext) {
        if (matchesKeyword(normalized, ct)) {
          contextCount++;
          matchedKeywords.push(ct);
        }
      }
      if (contextCount >= 2) {
        topicScore = 0.5;
      } else if (contextCount === 1) {
        topicScore = 0.3;
      }
    }

    if (topicScore > 0) {
      matchedTopics.push(topicId);
    }

    if (topicScore > bestScore) {
      bestScore = topicScore;
    }
  }

  return {
    score: bestScore,
    matchedTopics,
    matchedKeywords,
  };
}
