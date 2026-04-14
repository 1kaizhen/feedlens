import type { TweetData } from '../shared/types';

/** Parses "1.2K", "500", "1M" → number. Returns undefined if unparseable. */
function parseStatCount(text: string): number | undefined {
  const match = text.match(/([\d.]+)\s*([KMB]?)/i);
  if (!match) return undefined;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return undefined;
  switch (match[2].toUpperCase()) {
    case 'K': return Math.round(num * 1_000);
    case 'M': return Math.round(num * 1_000_000);
    case 'B': return Math.round(num * 1_000_000_000);
    default:  return Math.round(num);
  }
}

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

  // Timestamp
  const timeEl = article.querySelector('time');
  const postedAt = timeEl?.getAttribute('datetime') ?? undefined;

  // Likes — button with data-testid="like" contains the count as text
  const likeBtn = article.querySelector('[data-testid="like"]');
  const likesText = likeBtn?.textContent?.trim() ?? '';
  const likes = likesText ? parseStatCount(likesText) : undefined;

  // Views — Twitter renders this as a link to /analytics or data-testid="views"
  const viewsEl =
    article.querySelector('[data-testid="views"]') ??
    article.querySelector('a[href*="/analytics"]');
  const viewsText = viewsEl?.textContent?.trim() ?? '';
  const views = viewsText ? parseStatCount(viewsText) : undefined;

  return {
    tweetId,
    text: fullText,
    authorHandle,
    hasMedia,
    isRetweet,
    postedAt,
    likes,
    views,
  };
}
