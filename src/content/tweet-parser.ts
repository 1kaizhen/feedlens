import type { TweetData } from '../shared/types';

export function extractTweetData(article: Element): TweetData | null {
  // Extract tweet text
  const tweetTextEl = article.querySelector('[data-testid="tweetText"]');
  const text = tweetTextEl?.textContent?.trim() ?? '';

  // Handle quoted tweets — append quote text
  const quoteTweet = article.querySelector(
    '[data-testid="quoteTweet"] [data-testid="tweetText"]'
  );
  const quoteText = quoteTweet?.textContent?.trim() ?? '';
  const fullText = quoteText ? `${text} ${quoteText}` : text;

  // Extract author handle
  const userNameEl = article.querySelector(
    'div[data-testid="User-Name"] a[role="link"]'
  );
  const authorHandle =
    userNameEl
      ?.getAttribute('href')
      ?.replace(/^\//, '')
      .split('/')[0] ?? '';

  // Extract tweet ID from permalink
  const permalink = article.querySelector('a[href*="/status/"]');
  const href = permalink?.getAttribute('href') ?? '';
  const statusMatch = href.match(/\/status\/(\d+)/);
  const tweetId = statusMatch?.[1] ?? '';

  // Detect media
  const hasMedia =
    article.querySelector(
      '[data-testid="tweetPhoto"], video, [data-testid="card.wrapper"]'
    ) !== null;

  // Detect retweet
  const isRetweet =
    article.querySelector('[data-testid="socialContext"]')?.textContent?.includes(
      'reposted'
    ) ??
    article.querySelector('[data-testid="socialContext"]')?.textContent?.includes(
      'Retweeted'
    ) ??
    false;

  if (!tweetId) return null;
  if (!fullText && !hasMedia) return null;

  return {
    tweetId,
    text: fullText,
    authorHandle,
    hasMedia,
    isRetweet,
  };
}
