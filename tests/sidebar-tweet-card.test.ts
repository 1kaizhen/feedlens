import { describe, it, expect } from 'vitest';
import type { SidebarTweetEntry } from '../src/shared/types';
import { createTweetCard } from '../src/content/sidebar/sidebar-tweet-card';

function makeEntry(overrides: Partial<SidebarTweetEntry> = {}): SidebarTweetEntry {
  return {
    tweetId: '123',
    text: 'Hello world',
    authorHandle: 'testuser',
    hasMedia: false,
    isRetweet: false,
    score: 0.8,
    matchedTopics: ['ai'],
    matchedKeywords: ['AI'],
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('sidebar-tweet-card', () => {
  it('renders author handle', () => {
    const card = createTweetCard(makeEntry({ authorHandle: 'alice' }));
    const author = card.querySelector('.feedlens-sidebar-card-author');
    expect(author?.textContent).toBe('@alice');
  });

  it('renders tweet text', () => {
    const card = createTweetCard(makeEntry({ text: 'Some tweet text' }));
    const text = card.querySelector('.feedlens-sidebar-card-text');
    expect(text?.textContent).toBe('Some tweet text');
  });

  it('truncates text longer than 280 chars', () => {
    const longText = 'A'.repeat(300);
    const card = createTweetCard(makeEntry({ text: longText }));
    const text = card.querySelector('.feedlens-sidebar-card-text');
    expect(text?.textContent).toHaveLength(283); // 280 + '...'
    expect(text?.textContent?.endsWith('...')).toBe(true);
  });

  it('shows relevant badge for score >= 0.7', () => {
    const card = createTweetCard(makeEntry({ score: 0.9 }));
    const badge = card.querySelector('.feedlens-sidebar-badge');
    expect(badge?.classList.contains('feedlens-sidebar-badge-relevant')).toBe(true);
    expect(badge?.textContent).toBe('0.9');
  });

  it('shows uncertain badge for score >= 0.3 and < 0.7', () => {
    const card = createTweetCard(makeEntry({ score: 0.5 }));
    const badge = card.querySelector('.feedlens-sidebar-badge');
    expect(badge?.classList.contains('feedlens-sidebar-badge-uncertain')).toBe(true);
  });

  it('shows low badge for score < 0.3', () => {
    const card = createTweetCard(makeEntry({ score: 0.1 }));
    const badge = card.querySelector('.feedlens-sidebar-badge');
    expect(badge?.classList.contains('feedlens-sidebar-badge-low')).toBe(true);
  });

  it('shows Media badge when hasMedia is true', () => {
    const card = createTweetCard(makeEntry({ hasMedia: true }));
    const tags = card.querySelectorAll('.feedlens-sidebar-tag');
    const texts = Array.from(tags).map((t) => t.textContent);
    expect(texts).toContain('Media');
  });

  it('shows RT badge when isRetweet is true', () => {
    const card = createTweetCard(makeEntry({ isRetweet: true }));
    const tags = card.querySelectorAll('.feedlens-sidebar-tag');
    const texts = Array.from(tags).map((t) => t.textContent);
    expect(texts).toContain('RT');
  });

  it('does not show Media/RT badges when both false', () => {
    const card = createTweetCard(makeEntry({ hasMedia: false, isRetweet: false }));
    const tags = card.querySelectorAll('.feedlens-sidebar-tag');
    expect(tags).toHaveLength(0);
  });

  it('sets data-tweet-id on card', () => {
    const card = createTweetCard(makeEntry({ tweetId: 'abc456' }));
    expect(card.dataset.tweetId).toBe('abc456');
  });
});
