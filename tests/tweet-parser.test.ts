import { describe, it, expect, beforeEach } from 'vitest';
import { extractTweetData } from '../src/content/tweet-parser';

function createTweetArticle(options: {
  text?: string;
  author?: string;
  tweetId?: string;
  quoteText?: string;
  hasMedia?: boolean;
  isRetweet?: boolean;
}): HTMLElement {
  const article = document.createElement('article');
  article.setAttribute('data-testid', 'tweet');

  // User name with link
  if (options.author) {
    const userNameDiv = document.createElement('div');
    userNameDiv.setAttribute('data-testid', 'User-Name');
    const link = document.createElement('a');
    link.setAttribute('role', 'link');
    link.setAttribute('href', `/${options.author}`);
    link.textContent = options.author;
    userNameDiv.appendChild(link);
    article.appendChild(userNameDiv);
  }

  // Tweet text
  if (options.text) {
    const textDiv = document.createElement('div');
    textDiv.setAttribute('data-testid', 'tweetText');
    textDiv.textContent = options.text;
    article.appendChild(textDiv);
  }

  // Permalink with tweet ID
  if (options.tweetId) {
    const permalink = document.createElement('a');
    permalink.setAttribute(
      'href',
      `/${options.author || 'user'}/status/${options.tweetId}`
    );
    article.appendChild(permalink);
  }

  // Quote tweet
  if (options.quoteText) {
    const quoteDiv = document.createElement('div');
    quoteDiv.setAttribute('data-testid', 'quoteTweet');
    const quoteText = document.createElement('div');
    quoteText.setAttribute('data-testid', 'tweetText');
    quoteText.textContent = options.quoteText;
    quoteDiv.appendChild(quoteText);
    article.appendChild(quoteDiv);
  }

  // Media
  if (options.hasMedia) {
    const photo = document.createElement('div');
    photo.setAttribute('data-testid', 'tweetPhoto');
    article.appendChild(photo);
  }

  // Retweet
  if (options.isRetweet) {
    const social = document.createElement('div');
    social.setAttribute('data-testid', 'socialContext');
    social.textContent = 'User reposted';
    article.appendChild(social);
  }

  return article;
}

describe('extractTweetData', () => {
  it('extracts basic tweet data', () => {
    const article = createTweetArticle({
      text: 'Hello world',
      author: 'testuser',
      tweetId: '123456',
    });
    const result = extractTweetData(article);
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Hello world');
    expect(result!.authorHandle).toBe('testuser');
    expect(result!.tweetId).toBe('123456');
  });

  it('concatenates quoted tweet text', () => {
    const article = createTweetArticle({
      text: 'My thoughts:',
      author: 'user1',
      tweetId: '111',
      quoteText: 'Original tweet content',
    });
    const result = extractTweetData(article);
    expect(result!.text).toBe('My thoughts: Original tweet content');
  });

  it('detects media', () => {
    const article = createTweetArticle({
      text: 'Check this photo',
      author: 'user2',
      tweetId: '222',
      hasMedia: true,
    });
    const result = extractTweetData(article);
    expect(result!.hasMedia).toBe(true);
  });

  it('detects retweets', () => {
    const article = createTweetArticle({
      text: 'Some text',
      author: 'user3',
      tweetId: '333',
      isRetweet: true,
    });
    const result = extractTweetData(article);
    expect(result!.isRetweet).toBe(true);
  });

  it('returns null when tweet ID is missing', () => {
    const article = createTweetArticle({
      text: 'No id tweet',
      author: 'user4',
    });
    const result = extractTweetData(article);
    expect(result).toBeNull();
  });

  it('returns null when both text and media are missing', () => {
    const article = createTweetArticle({
      author: 'user5',
      tweetId: '555',
    });
    const result = extractTweetData(article);
    expect(result).toBeNull();
  });

  it('allows media-only tweets', () => {
    const article = createTweetArticle({
      author: 'user6',
      tweetId: '666',
      hasMedia: true,
    });
    const result = extractTweetData(article);
    expect(result).not.toBeNull();
    expect(result!.hasMedia).toBe(true);
    expect(result!.text).toBe('');
  });
});
