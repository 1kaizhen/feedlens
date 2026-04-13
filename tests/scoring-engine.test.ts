import { describe, it, expect } from 'vitest';
import {
  scoreTweet,
  normalizeTweetText,
  matchesKeyword,
  escapeRegex,
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

  it('uses includes for longer keywords', () => {
    expect(matchesKeyword('great ui design tips', 'ui design')).toBe(true);
    expect(matchesKeyword('nothing here', 'ui design')).toBe(false);
  });
});

describe('scoreTweet', () => {
  it('scores 1.0 for primary keyword match', () => {
    const result = scoreTweet('Check out this micro interaction animation', [
      'micro-interaction',
    ]);
    expect(result.score).toBe(1.0);
    expect(result.matchedTopics).toContain('micro-interaction');
  });

  it('scores 0.5 for two context term matches', () => {
    const result = scoreTweet('The animation uses spring easing nicely', [
      'micro-interaction',
    ]);
    expect(result.score).toBe(0.5);
  });

  it('scores 0.3 for one context term match', () => {
    const result = scoreTweet('Nice animation there', ['micro-interaction']);
    expect(result.score).toBe(0.3);
  });

  it('scores 0 for no matches', () => {
    const result = scoreTweet('I had coffee today', ['micro-interaction']);
    expect(result.score).toBe(0);
    expect(result.matchedTopics).toHaveLength(0);
  });

  it('returns max score across multiple topics', () => {
    const result = scoreTweet('Anthropic just released Claude AI with new features', [
      'claude',
      'ai-ml',
    ]);
    expect(result.score).toBe(1.0);
    expect(result.matchedTopics).toContain('claude');
  });

  it('matches Claude topic correctly', () => {
    const result = scoreTweet('Claude Sonnet is amazing for code generation', [
      'claude',
    ]);
    expect(result.score).toBe(1.0);
  });

  it('matches UI/UX topic', () => {
    const result = scoreTweet('Working on a new design system in figma', [
      'ui-ux',
    ]);
    expect(result.score).toBe(1.0);
  });

  it('matches hiring designer topic', () => {
    const result = scoreTweet("We're hiring a product designer for our team", [
      'hiring-designer',
    ]);
    expect(result.score).toBe(1.0);
  });

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

  it('respects selectedKeywords filter — only matches selected keywords', () => {
    // "Claude AI" is selected, should match
    const result1 = scoreTweet('Claude AI is great', ['claude'], {
      claude: ['Claude AI'],
    });
    expect(result1.score).toBe(1.0);

    // "Anthropic" is NOT selected, should not match even though it's a keyword
    const result2 = scoreTweet('Anthropic released a new model', ['claude'], {
      claude: ['Claude AI'],
    });
    expect(result2.score).toBe(0);
  });

  it('uses all keywords when no selectedKeywords entry for topic', () => {
    const result = scoreTweet('Anthropic released a new model', ['claude'], {});
    expect(result.score).toBe(1.0);
  });

  it('filters context terms via selectedKeywords', () => {
    // Only select 1 context term — should score 0.3
    const result = scoreTweet('The animation uses spring easing nicely', ['micro-interaction'], {
      'micro-interaction': ['animation'],
    });
    expect(result.score).toBe(0.3);
  });

  it('scores 0 when all keywords for a topic are deselected', () => {
    const result = scoreTweet('Claude AI is amazing', ['claude'], {
      claude: [],
    });
    expect(result.score).toBe(0);
  });
});
