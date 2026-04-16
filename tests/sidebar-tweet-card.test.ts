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
    score: 8,
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

  it('shows high chip for score >= 7/10', () => {
    const card = createTweetCard(makeEntry({ score: 9 }));
    const chip = card.querySelector('.feedlens-sidebar-chip');
    expect(chip?.classList.contains('feedlens-sidebar-chip-high')).toBe(true);
    expect(chip?.textContent).toBe('9/10');
  });

  it('shows mid chip for score >= 3 and < 7', () => {
    const card = createTweetCard(makeEntry({ score: 5 }));
    const chip = card.querySelector('.feedlens-sidebar-chip');
    expect(chip?.classList.contains('feedlens-sidebar-chip-mid')).toBe(true);
    expect(chip?.textContent).toBe('5/10');
  });

  it('shows low chip for score < 3', () => {
    const card = createTweetCard(makeEntry({ score: 1 }));
    const chip = card.querySelector('.feedlens-sidebar-chip');
    expect(chip?.classList.contains('feedlens-sidebar-chip-low')).toBe(true);
    expect(chip?.textContent).toBe('1/10');
  });

  it('renders decimals with one place', () => {
    const card = createTweetCard(makeEntry({ score: 7.5 }));
    const chip = card.querySelector('.feedlens-sidebar-chip');
    expect(chip?.textContent).toBe('7.5/10');
  });

  it('shows Media tag when hasMedia is true', () => {
    const card = createTweetCard(makeEntry({ hasMedia: true }));
    const tags = card.querySelectorAll('.feedlens-sidebar-tag');
    const texts = Array.from(tags).map((t) => t.textContent);
    expect(texts).toContain('Media');
  });

  it('shows RT tag when isRetweet is true', () => {
    const card = createTweetCard(makeEntry({ isRetweet: true }));
    const tags = card.querySelectorAll('.feedlens-sidebar-tag');
    const texts = Array.from(tags).map((t) => t.textContent);
    expect(texts).toContain('RT');
  });

  it('does not show Media/RT tags when both false', () => {
    const card = createTweetCard(makeEntry({ hasMedia: false, isRetweet: false }));
    const tags = card.querySelectorAll('.feedlens-sidebar-tag');
    expect(tags).toHaveLength(0);
  });

  it('renders AI reasoning when present', () => {
    const card = createTweetCard(makeEntry({ aiReasoning: 'Mentions React hooks' }));
    const reason = card.querySelector('.feedlens-sidebar-card-reason');
    expect(reason?.textContent).toBe('Mentions React hooks');
  });

  it('omits reasoning block when absent', () => {
    const card = createTweetCard(makeEntry());
    expect(card.querySelector('.feedlens-sidebar-card-reason')).toBeNull();
  });

  it('renders open link pointing to x.com status URL', () => {
    const card = createTweetCard(makeEntry({ tweetId: 'abc456', authorHandle: 'alice' }));
    const link = card.querySelector('.feedlens-sidebar-card-link') as HTMLAnchorElement | null;
    expect(link?.href).toBe('https://x.com/alice/status/abc456');
  });

  it('sets data-tweet-id on card', () => {
    const card = createTweetCard(makeEntry({ tweetId: 'abc456' }));
    expect(card.dataset.tweetId).toBe('abc456');
  });
});
