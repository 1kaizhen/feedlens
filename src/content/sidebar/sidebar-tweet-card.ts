import type { SidebarTweetEntry } from '../../shared/types';
import { RELEVANT_THRESHOLD, UNCERTAIN_THRESHOLD } from '../../shared/constants';

const MAX_TEXT_LENGTH = 280;

export function createTweetCard(entry: SidebarTweetEntry): HTMLElement {
  const card = document.createElement('div');
  card.className = 'feedlens-sidebar-card';
  card.dataset.tweetId = entry.tweetId;

  // Author
  const author = document.createElement('div');
  author.className = 'feedlens-sidebar-card-author';
  author.textContent = `@${entry.authorHandle}`;
  card.appendChild(author);

  // Text
  const text = document.createElement('div');
  text.className = 'feedlens-sidebar-card-text';
  const truncated =
    entry.text.length > MAX_TEXT_LENGTH
      ? entry.text.slice(0, MAX_TEXT_LENGTH) + '...'
      : entry.text;
  text.textContent = truncated;
  card.appendChild(text);

  // Footer row: score badge + media/RT badges
  const footer = document.createElement('div');
  footer.className = 'feedlens-sidebar-card-footer';

  // Score badge
  const badge = document.createElement('span');
  badge.className = 'feedlens-sidebar-badge';
  badge.textContent = entry.score.toFixed(1);
  if (entry.score >= RELEVANT_THRESHOLD) {
    badge.classList.add('feedlens-sidebar-badge-relevant');
  } else if (entry.score >= UNCERTAIN_THRESHOLD) {
    badge.classList.add('feedlens-sidebar-badge-uncertain');
  } else {
    badge.classList.add('feedlens-sidebar-badge-low');
  }
  footer.appendChild(badge);

  // AI score badge
  if (entry.aiScore != null) {
    const aiBadge = document.createElement('span');
    aiBadge.className = 'feedlens-sidebar-badge feedlens-sidebar-badge-ai';
    aiBadge.textContent = `AI ${entry.aiScore.toFixed(1)}`;
    if (entry.aiReasoning) {
      aiBadge.title = entry.aiReasoning;
    }
    footer.appendChild(aiBadge);
  }

  if (entry.hasMedia) {
    const mediaBadge = document.createElement('span');
    mediaBadge.className = 'feedlens-sidebar-tag';
    mediaBadge.textContent = 'Media';
    footer.appendChild(mediaBadge);
  }

  if (entry.isRetweet) {
    const rtBadge = document.createElement('span');
    rtBadge.className = 'feedlens-sidebar-tag';
    rtBadge.textContent = 'RT';
    footer.appendChild(rtBadge);
  }

  card.appendChild(footer);

  // Click → scroll to tweet in feed
  card.addEventListener('click', () => {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (const article of articles) {
      const link = article.querySelector(`a[href*="/${entry.tweetId}"]`);
      if (link) {
        article.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    // Fallback: if tweet not found in DOM (scrolled away), do nothing
  });

  return card;
}
