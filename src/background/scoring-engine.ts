import type { ScoreResponse, ScoringOptions } from '../shared/types';
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
  const regex = new RegExp(`\\b${escapeRegex(lower)}\\b`, 'i');
  return regex.test(text);
}

export function extractHashtags(text: string): string[] {
  const matches = text.match(/#\w+/g);
  if (!matches) return [];
  return matches.map((tag) => tag.slice(1).toLowerCase());
}

export function scoreTweet(
  text: string,
  selectedTopicIds: string[],
  options?: ScoringOptions
): ScoreResponse {
  const {
    selectedKeywords,
    blockedKeywords,
    keywordWeights,
    customKeywords,
    authorBonus,
  } = options ?? {};

  const normalized = normalizeTweetText(text);

  // Phase 1B: blocked keywords — immediate score 0
  if (blockedKeywords && blockedKeywords.length > 0) {
    for (const blocked of blockedKeywords) {
      if (matchesKeyword(normalized, blocked)) {
        return { score: 0, matchedTopics: [], matchedKeywords: [] };
      }
    }
  }

  // Phase 1A: extract hashtags from raw text before normalization
  const hashtags = extractHashtags(text);

  let bestScore = 0;
  const matchedTopics: string[] = [];
  const matchedKeywords: string[] = [];

  for (const topicId of selectedTopicIds) {
    const topic = TOPIC_CATEGORIES.find((t) => t.id === topicId);
    if (!topic) continue;

    // Phase 3: merge custom keywords
    const custom = customKeywords?.[topicId];
    const allKeywords = [...topic.keywords, ...(custom?.keywords ?? [])];
    const allContext = [...topic.contextTerms, ...(custom?.contextTerms ?? [])];

    // Determine which keywords/context terms are active
    const activeSet = selectedKeywords?.[topicId];
    const activeKeywords = activeSet
      ? allKeywords.filter((kw) => activeSet.includes(kw))
      : allKeywords;
    const activeContext = activeSet
      ? allContext.filter((ct) => activeSet.includes(ct))
      : allContext;

    let topicScore = 0;
    const topicMatchedKeywords: string[] = [];

    // Check primary keywords
    let primaryMatch = false;
    for (const kw of activeKeywords) {
      if (matchesKeyword(normalized, kw)) {
        primaryMatch = true;
        topicMatchedKeywords.push(kw);
        break;
      }
    }

    // Always check context terms
    let contextCount = 0;
    for (const ct of activeContext) {
      if (matchesKeyword(normalized, ct)) {
        contextCount++;
        topicMatchedKeywords.push(ct);

        // Phase 1A: if context term appears as hashtag, promote to primary
        if (!primaryMatch && hashtags.includes(ct.toLowerCase())) {
          primaryMatch = true;
        }
      }
    }

    // Also check: if a primary keyword appears as hashtag but wasn't matched
    // in normalized text (e.g., single-word hashtag)
    if (!primaryMatch) {
      for (const kw of activeKeywords) {
        if (hashtags.includes(kw.toLowerCase())) {
          primaryMatch = true;
          if (!topicMatchedKeywords.includes(kw)) {
            topicMatchedKeywords.push(kw);
          }
          break;
        }
      }
    }

    // Corroboration-based scoring
    if (primaryMatch && contextCount >= 1) {
      topicScore = 1.0;
    } else if (primaryMatch) {
      topicScore = 0.6;
    } else if (contextCount >= 3) {
      topicScore = 0.5;
    } else if (contextCount >= 2) {
      topicScore = 0.3;
    } else if (contextCount === 1) {
      topicScore = 0.1;
    }

    // Phase 2: apply keyword weights
    if (topicScore > 0 && keywordWeights && topicMatchedKeywords.length > 0) {
      let weightSum = 0;
      let weightCount = 0;
      for (const kw of topicMatchedKeywords) {
        const key = `${topicId}::${kw}`;
        const entry = keywordWeights[key];
        weightSum += entry ? entry.weight : 1.0;
        weightCount++;
      }
      const avgWeight = weightSum / weightCount;
      topicScore = Math.min(1.0, topicScore * avgWeight);
    }

    if (topicScore > 0) {
      matchedTopics.push(topicId);
    }

    matchedKeywords.push(...topicMatchedKeywords);

    if (topicScore > bestScore) {
      bestScore = topicScore;
    }
  }

  // Phase 4: author reputation bonus
  if (authorBonus !== undefined && bestScore > 0) {
    bestScore = Math.max(0, Math.min(1.0, bestScore + authorBonus));
  }

  return {
    score: bestScore,
    matchedTopics,
    matchedKeywords,
  };
}
