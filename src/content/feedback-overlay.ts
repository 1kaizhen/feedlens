import type { TweetData } from '../shared/types';

export function injectFeedbackOverlay(
  article: Element,
  tweetData: TweetData,
  matchedTopics: string[],
  matchedKeywords: string[]
): void {
  // Skip if overlay already exists
  if (article.querySelector('.feedlens-feedback')) return;

  // Ensure relative positioning
  const htmlArticle = article as HTMLElement;
  const computed = getComputedStyle(htmlArticle);
  if (computed.position === 'static') {
    htmlArticle.style.position = 'relative';
  }

  const overlay = document.createElement('div');
  overlay.className = 'feedlens-feedback';

  const thumbsUp = document.createElement('button');
  thumbsUp.textContent = '\u{1F44D}';
  thumbsUp.title = 'Relevant';
  thumbsUp.addEventListener('click', (e) => {
    e.stopPropagation();
    submitFeedback(tweetData, matchedTopics, matchedKeywords, true, overlay);
  });

  const thumbsDown = document.createElement('button');
  thumbsDown.textContent = '\u{1F44E}';
  thumbsDown.title = 'Not relevant';
  thumbsDown.addEventListener('click', (e) => {
    e.stopPropagation();
    submitFeedback(tweetData, matchedTopics, matchedKeywords, false, overlay);
  });

  overlay.appendChild(thumbsUp);
  overlay.appendChild(thumbsDown);
  article.appendChild(overlay);
}

function submitFeedback(
  tweetData: TweetData,
  matchedTopics: string[],
  matchedKeywords: string[],
  isRelevant: boolean,
  overlay: HTMLElement
): void {
  chrome.runtime.sendMessage({
    type: 'SUBMIT_FEEDBACK',
    payload: {
      tweetId: tweetData.tweetId,
      tweetText: tweetData.text.slice(0, 280),
      isRelevant,
      matchedTopics,
      matchedKeywords,
      authorHandle: tweetData.authorHandle,
      timestamp: Date.now(),
    },
  });

  // Show confirmation
  overlay.innerHTML = '';
  const check = document.createElement('span');
  check.className = 'feedlens-confirmed';
  check.textContent = '\u2713';
  overlay.appendChild(check);

  setTimeout(() => {
    overlay.style.display = 'none';
  }, 1500);
}
