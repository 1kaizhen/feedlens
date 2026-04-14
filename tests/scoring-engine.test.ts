import { describe, it, expect } from 'vitest';
import {
  scoreTweet,
  normalizeTweetText,
  matchesKeyword,
  escapeRegex,
  extractHashtags,
} from '../src/background/scoring-engine';

describe('normalizeTweetText', () => {
  it('lowercases text', () => {
    expect(normalizeTweetText('Hello WORLD')).toBe('hello world');
  });

  it('strips URLs', () => {
    expect(normalizeTweetText('Check https://example.com out')).toBe(
      'check out'
    );
  });

  it('strips @mentions', () => {
    expect(normalizeTweetText('Hey @user123 look')).toBe('hey look');
  });

  it('collapses whitespace', () => {
    expect(normalizeTweetText('a   b   c')).toBe('a b c');
  });
});

describe('escapeRegex', () => {
  it('escapes special characters', () => {
    expect(escapeRegex('C++')).toBe('C\\+\\+');
    expect(escapeRegex('a.b')).toBe('a\\.b');
  });
});

describe('matchesKeyword', () => {
  it('uses word boundary for short keywords', () => {
    expect(matchesKeyword('the ai revolution', 'AI')).toBe(true);
    expect(matchesKeyword('check your email', 'AI')).toBe(false);
    expect(matchesKeyword('said ai is cool', 'ai')).toBe(true);
  });

  it('uses word boundary for longer keywords too', () => {
    expect(matchesKeyword('great ui design tips', 'ui design')).toBe(true);
    expect(matchesKeyword('nothing here', 'ui design')).toBe(false);
  });

  it('rejects substring matches for longer keywords', () => {
    expect(matchesKeyword('i overreacted to the news', 'react')).toBe(false);
    expect(matchesKeyword('a triangular shape', 'angular')).toBe(false);
    expect(matchesKeyword('she reacted quickly', 'react')).toBe(false);
  });

  it('matches exact words even when they appear in sentences', () => {
    expect(matchesKeyword('i love react and vue', 'react')).toBe(true);
    expect(matchesKeyword('angular is a framework', 'angular')).toBe(true);
    expect(matchesKeyword('using vue for the frontend', 'vue')).toBe(true);
  });

  it('handles special characters in keywords like dots', () => {
    expect(matchesKeyword('check out claude.ai for help', 'claude.ai')).toBe(true);
    expect(matchesKeyword('use next.js for ssr', 'Next.js')).toBe(true);
    expect(matchesKeyword('claudexai is different', 'claude.ai')).toBe(false);
  });
});

describe('extractHashtags', () => {
  it('extracts hashtags from text', () => {
    expect(extractHashtags('Check out #React and #Vue')).toEqual(['react', 'vue']);
  });

  it('returns empty for text with no hashtags', () => {
    expect(extractHashtags('No hashtags here')).toEqual([]);
  });

  it('handles hashtags at start and end', () => {
    expect(extractHashtags('#Start middle #End')).toEqual(['start', 'end']);
  });

  it('lowercases hashtags', () => {
    expect(extractHashtags('#UIDesign #REACT')).toEqual(['uidesign', 'react']);
  });
});

describe('scoreTweet', () => {
  // --- Corroborated primary match = 1.0 ---

  it('scores 1.0 for primary keyword + context term (corroborated)', () => {
    const result = scoreTweet('Check out this micro interaction animation', [
      'micro-interaction',
    ]);
    expect(result.score).toBe(1.0);
    expect(result.matchedTopics).toContain('micro-interaction');
    expect(result.matchedKeywords).toContain('micro interaction');
    expect(result.matchedKeywords).toContain('animation');
  });

  it('scores 1.0 for Claude topic with corroboration', () => {
    const result = scoreTweet('Claude Sonnet is the best LLM for code generation', [
      'claude',
    ]);
    expect(result.score).toBe(1.0);
    expect(result.matchedKeywords).toContain('Claude Sonnet');
    expect(result.matchedKeywords).toContain('LLM');
  });

  // --- Uncorroborated primary match = 0.6 ---

  it('scores 0.6 for primary keyword alone (uncorroborated)', () => {
    const result = scoreTweet('Claude Sonnet is amazing for code generation', [
      'claude',
    ]);
    expect(result.score).toBe(0.6);
  });

  it('scores 0.6 for UI/UX primary match without context terms', () => {
    const result = scoreTweet('Working on a new design system in figma', [
      'ui-ux',
    ]);
    expect(result.score).toBe(0.6);
  });

  it('scores 0.6 for hiring designer primary match without context terms', () => {
    const result = scoreTweet("We're hiring a product designer for our team", [
      'hiring-designer',
    ]);
    expect(result.score).toBe(0.6);
  });

  // --- Context-only scoring ---

  it('scores 0.5 for 3+ context term matches', () => {
    const result = scoreTweet('The animation uses spring easing and keyframe effects', [
      'micro-interaction',
    ]);
    expect(result.score).toBe(0.5);
  });

  it('scores 0.3 for two context term matches', () => {
    const result = scoreTweet('The animation uses spring physics nicely', [
      'micro-interaction',
    ]);
    expect(result.score).toBe(0.3);
  });

  it('scores 0.1 for one context term match', () => {
    const result = scoreTweet('Nice animation there', ['micro-interaction']);
    expect(result.score).toBe(0.1);
  });

  // --- No matches ---

  it('scores 0 for no matches', () => {
    const result = scoreTweet('I had coffee today', ['micro-interaction']);
    expect(result.score).toBe(0);
    expect(result.matchedTopics).toHaveLength(0);
  });

  // --- Multi-topic ---

  it('returns max score across multiple topics', () => {
    const result = scoreTweet('Anthropic just released Claude AI with new features', [
      'claude',
      'ai-ml',
    ]);
    expect(result.score).toBe(0.6);
    expect(result.matchedTopics).toContain('claude');
  });

  // --- Edge cases ---

  it('does not match unrelated tweets', () => {
    const result = scoreTweet('Just finished dinner, was delicious!', [
      'claude',
      'ui-ux',
      'frontend-dev',
    ]);
    expect(result.score).toBe(0);
  });

  it('handles empty selected topics', () => {
    const result = scoreTweet('Claude AI is great', []);
    expect(result.score).toBe(0);
  });

  it('handles empty text', () => {
    const result = scoreTweet('', ['claude']);
    expect(result.score).toBe(0);
  });

  // --- selectedKeywords filter ---

  it('respects selectedKeywords filter — only matches selected keywords', () => {
    const result1 = scoreTweet('Claude AI is great', ['claude'], {
      selectedKeywords: { claude: ['Claude AI'] },
    });
    expect(result1.score).toBe(0.6);

    const result2 = scoreTweet('Anthropic released a new model', ['claude'], {
      selectedKeywords: { claude: ['Claude AI'] },
    });
    expect(result2.score).toBe(0);
  });

  it('uses all keywords when no selectedKeywords entry for topic', () => {
    const result = scoreTweet('Anthropic released a new model', ['claude'], {
      selectedKeywords: {},
    });
    expect(result.score).toBe(0.6);
  });

  it('filters context terms via selectedKeywords', () => {
    const result = scoreTweet('The animation uses spring easing nicely', ['micro-interaction'], {
      selectedKeywords: { 'micro-interaction': ['animation'] },
    });
    expect(result.score).toBe(0.1);
  });

  it('scores 0 when all keywords for a topic are deselected', () => {
    const result = scoreTweet('Claude AI is amazing', ['claude'], {
      selectedKeywords: { claude: [] },
    });
    expect(result.score).toBe(0);
  });

  // --- Substring rejection ---

  it('does not match "react" inside "overreacted"', () => {
    const result = scoreTweet('I overreacted to the news yesterday', ['frontend-dev']);
    expect(result.score).toBe(0);
  });

  it('does not match "angular" inside "triangular"', () => {
    const result = scoreTweet('A triangular shape appeared', ['frontend-dev']);
    expect(result.score).toBe(0);
  });

  it('does not match "vue" inside "revenue"', () => {
    const result = scoreTweet('The company revenue grew 50%', ['frontend-dev']);
    expect(result.score).toBe(0);
  });

  // --- matchedKeywords includes both primary and context ---

  it('matchedKeywords includes both primary and context terms when corroborated', () => {
    const result = scoreTweet('Using figma for typography and layout work', ['ui-ux']);
    expect(result.score).toBe(1.0);
    expect(result.matchedKeywords).toContain('figma');
    expect(result.matchedKeywords).toContain('typography');
    expect(result.matchedKeywords).toContain('layout');
  });

  // ========================================
  // Phase 1A: Hashtag-Aware Scoring
  // ========================================

  describe('hashtag-aware scoring', () => {
    it('boosts score when context term appears as hashtag', () => {
      // "animation" is a context term for micro-interaction
      // As hashtag, it should promote to primary, so score = 0.6 (primary, no other context)
      // Without hashtag, just "animation" alone = 0.1 (1 context term)
      const withoutHashtag = scoreTweet('Nice animation there', ['micro-interaction']);
      expect(withoutHashtag.score).toBe(0.1);

      const withHashtag = scoreTweet('Nice #animation there', ['micro-interaction']);
      // hashtag promotes "animation" to primary → primaryMatch=true, contextCount=1
      // primary + context = 1.0
      expect(withHashtag.score).toBe(1.0);
    });

    it('promotes context hashtag to trigger corroboration scoring', () => {
      // "animation" as hashtag (promoted to primary) + "spring" as context = corroborated
      const result = scoreTweet('Great #animation with spring physics', ['micro-interaction']);
      expect(result.score).toBe(1.0);
    });

    it('does not affect score when hashtag is not a keyword', () => {
      const result = scoreTweet('Check out #randomtag today', ['micro-interaction']);
      expect(result.score).toBe(0);
    });

    it('handles multiple hashtags', () => {
      const result = scoreTweet('#animation and #transition are great', ['micro-interaction']);
      // Both are context terms, "animation" promoted to primary via hashtag
      // primary + 1 context = 1.0
      expect(result.score).toBe(1.0);
    });
  });

  // ========================================
  // Phase 1B: Blocked Keywords
  // ========================================

  describe('blocked keywords', () => {
    it('returns score 0 when blocked keyword matches', () => {
      const result = scoreTweet('Claude AI is great for LLM tasks', ['claude'], {
        blockedKeywords: ['LLM'],
      });
      expect(result.score).toBe(0);
      expect(result.matchedTopics).toHaveLength(0);
      expect(result.matchedKeywords).toHaveLength(0);
    });

    it('has no effect with empty blocklist', () => {
      const result = scoreTweet('Claude AI is great for LLM tasks', ['claude'], {
        blockedKeywords: [],
      });
      expect(result.score).toBe(1.0);
    });

    it('uses word boundary matching for blocked keywords', () => {
      // "react" should not match "overreacted"
      const result = scoreTweet('I overreacted to the Claude AI news', ['claude'], {
        blockedKeywords: ['react'],
      });
      expect(result.score).toBe(0.6); // should still score normally
    });

    it('blocks regardless of other matches', () => {
      // Even with a perfect corroborated match, blocked keyword = 0
      const result = scoreTweet('micro interaction animation but also spam', ['micro-interaction'], {
        blockedKeywords: ['spam'],
      });
      expect(result.score).toBe(0);
    });
  });

  // ========================================
  // Phase 2: Keyword Weights
  // ========================================

  describe('keyword weights', () => {
    it('neutral weight (1.0) produces identical scoring', () => {
      const withoutWeights = scoreTweet('Claude Sonnet is the best LLM for code', ['claude']);
      const withWeights = scoreTweet('Claude Sonnet is the best LLM for code', ['claude'], {
        keywordWeights: {
          'claude::Claude Sonnet': { keyword: 'Claude Sonnet', topicId: 'claude', weight: 1.0, positiveCount: 5, negativeCount: 0 },
          'claude::LLM': { keyword: 'LLM', topicId: 'claude', weight: 1.0, positiveCount: 5, negativeCount: 0 },
        },
      });
      expect(withWeights.score).toBe(withoutWeights.score);
    });

    it('weight 0.5 reduces effective score', () => {
      // Primary + context = base 1.0, * 0.5 avg weight = 0.5
      const result = scoreTweet('Claude Sonnet is the best LLM for code', ['claude'], {
        keywordWeights: {
          'claude::Claude Sonnet': { keyword: 'Claude Sonnet', topicId: 'claude', weight: 0.5, positiveCount: 1, negativeCount: 4 },
          'claude::LLM': { keyword: 'LLM', topicId: 'claude', weight: 0.5, positiveCount: 1, negativeCount: 4 },
        },
      });
      expect(result.score).toBe(0.5);
    });

    it('weight 1.5 boosts score but caps at 1.0', () => {
      // Primary + context = base 1.0, * 1.5 = capped at 1.0
      const result = scoreTweet('Claude Sonnet is the best LLM for code', ['claude'], {
        keywordWeights: {
          'claude::Claude Sonnet': { keyword: 'Claude Sonnet', topicId: 'claude', weight: 1.5, positiveCount: 10, negativeCount: 0 },
          'claude::LLM': { keyword: 'LLM', topicId: 'claude', weight: 1.5, positiveCount: 10, negativeCount: 0 },
        },
      });
      expect(result.score).toBe(1.0);
    });

    it('weight 1.5 boosts uncorroborated primary', () => {
      // Primary alone = 0.6, * 1.5 = 0.9
      const result = scoreTweet('Claude Sonnet is amazing for code generation', ['claude'], {
        keywordWeights: {
          'claude::Claude Sonnet': { keyword: 'Claude Sonnet', topicId: 'claude', weight: 1.5, positiveCount: 10, negativeCount: 0 },
        },
      });
      expect(result.score).toBeCloseTo(0.9);
    });

    it('uses default weight 1.0 for keywords not in weights map', () => {
      const result = scoreTweet('Claude Sonnet is the best LLM for code', ['claude'], {
        keywordWeights: {}, // no entries
      });
      expect(result.score).toBe(1.0); // unweighted
    });
  });

  // ========================================
  // Phase 3: Custom Keywords
  // ========================================

  describe('custom keywords', () => {
    it('custom primary keyword triggers primary match scoring', () => {
      const result = scoreTweet('This is about myCustomTool which is great', ['claude'], {
        customKeywords: {
          claude: { keywords: ['myCustomTool'], contextTerms: [] },
        },
      });
      expect(result.score).toBe(0.6); // primary alone = 0.6
    });

    it('custom context term counts toward corroboration', () => {
      // "Claude AI" = built-in primary, "myContext" = custom context
      const result = scoreTweet('Claude AI and myContext discussed', ['claude'], {
        customKeywords: {
          claude: { keywords: [], contextTerms: ['myContext'] },
        },
      });
      expect(result.score).toBe(1.0); // primary + context = 1.0
    });

    it('removing custom keyword does not affect built-ins', () => {
      // No custom keywords, built-in "Claude AI" should still work
      const result = scoreTweet('Claude AI is great', ['claude'], {
        customKeywords: {},
      });
      expect(result.score).toBe(0.6);
    });

    it('custom keywords work alongside selectedKeywords filter', () => {
      // Select only "Claude AI" from built-in, add custom context
      const result = scoreTweet('Claude AI with myTerm is cool', ['claude'], {
        selectedKeywords: { claude: ['Claude AI', 'myTerm'] },
        customKeywords: {
          claude: { keywords: [], contextTerms: ['myTerm'] },
        },
      });
      expect(result.score).toBe(1.0); // primary + custom context
    });
  });

  // ========================================
  // Phase 4: Author Reputation Bonus
  // ========================================

  describe('author reputation bonus', () => {
    it('+0.15 bonus pushes 0.6 (uncertain) to 0.75 (relevant)', () => {
      const result = scoreTweet('Claude Sonnet is amazing for code generation', ['claude'], {
        authorBonus: 0.15,
      });
      expect(result.score).toBe(0.75);
    });

    it('-0.15 penalty pushes borderline tweet below threshold', () => {
      // Primary alone = 0.6, -0.15 = 0.45
      const result = scoreTweet('Claude Sonnet is amazing for code generation', ['claude'], {
        authorBonus: -0.15,
      });
      expect(result.score).toBeCloseTo(0.45);
    });

    it('bonus is capped at 1.0', () => {
      // Corroborated = 1.0, +0.15 still = 1.0
      const result = scoreTweet('Claude Sonnet is the best LLM for code', ['claude'], {
        authorBonus: 0.15,
      });
      expect(result.score).toBe(1.0);
    });

    it('bonus does not apply when score is 0', () => {
      const result = scoreTweet('I had coffee today', ['claude'], {
        authorBonus: 0.15,
      });
      expect(result.score).toBe(0);
    });

    it('negative bonus does not go below 0', () => {
      // 1 context term = 0.1, -0.15 should clamp to 0
      const result = scoreTweet('Nice animation there', ['micro-interaction'], {
        authorBonus: -0.15,
      });
      expect(result.score).toBe(0);
    });
  });
});
