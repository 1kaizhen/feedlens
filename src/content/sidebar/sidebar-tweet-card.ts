import type { SidebarTweetEntry } from '../../shared/types';
import { RELEVANT_THRESHOLD, UNCERTAIN_THRESHOLD } from '../../shared/constants';

const MAX_TEXT_LENGTH = 280;

/** Format a 0-10 score as "N/10" with 1 decimal only when needed. */
function formatScore(score: number): string {
  const rounded = Math.round(score * 10) / 10;
  // Show integers without a trailing ".0"
  const display = Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
  return `${display}/10`;
}

function scoreClass(score: number): string {
  if (score >= RELEVANT_THRESHOLD) return 'feedlens-sidebar-chip-high';
  if (score >= UNCERTAIN_THRESHOLD) return 'feedlens-sidebar-chip-mid';
  return 'feedlens-sidebar-chip-low';
}

export function createTweetCard(entry: SidebarTweetEntry): HTMLElement {
  const card = document.createElement('div');
  card.className = 'feedlens-sidebar-card';
  card.dataset.tweetId = entry.tweetId;

  // Top row: author + score chip
  const topRow = document.createElement('div');
  topRow.className = 'feedlens-sidebar-card-top';

  const author = document.createElement('div');
  author.className = 'feedlens-sidebar-card-author';
  author.textContent = `@${entry.authorHandle}`;
  topRow.appendChild(author);

  const chip = document.createElement('span');
  chip.className = `feedlens-sidebar-chip ${scoreClass(entry.score)}`;
  chip.textContent = formatScore(entry.score);
  chip.title = `Relevance score: ${formatScore(entry.score)}`;
  topRow.appendChild(chip);

  card.appendChild(topRow);

  // Text
  const text = document.createElement('div');
  text.className = 'feedlens-sidebar-card-text';
  const truncated =
    entry.text.length > MAX_TEXT_LENGTH
      ? entry.text.slice(0, MAX_TEXT_LENGTH) + '...'
      : entry.text || '(no text)';
  text.textContent = truncated;
  card.appendChild(text);

  // AI reasoning (collapsible)
  if (entry.aiReasoning && entry.aiReasoning.trim()) {
    const reason = document.createElement('div');
    reason.className = 'feedlens-sidebar-card-reason';
    reason.textContent = entry.aiReasoning;
    card.appendChild(reason);
  }

  // Footer: tags + open link
  const footer = document.createElement('div');
  footer.className = 'feedlens-sidebar-card-footer';

  const tagsWrap = document.createElement('div');
  tagsWrap.className = 'feedlens-sidebar-card-tags';

  if (entry.hasMedia) {
    const tag = document.createElement('span');
    tag.className = 'feedlens-sidebar-tag';
    tag.textContent = 'Media';
    tagsWrap.appendChild(tag);
  }
  if (entry.isRetweet) {
    const tag = document.createElement('span');
    tag.className = 'feedlens-sidebar-tag';
    tag.textContent = 'RT';
    tagsWrap.appendChild(tag);
  }

  footer.appendChild(tagsWrap);

  const openLink = document.createElement('a');
  openLink.className = 'feedlens-sidebar-card-link';
  openLink.href = `https://x.com/${entry.authorHandle}/status/${entry.tweetId}`;
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';
  openLink.textContent = 'Open';
  openLink.addEventListener('click', (e) => e.stopPropagation());
  footer.appendChild(openLink);

  card.appendChild(footer);

  // Click card → scroll to tweet in feed if present.
  card.addEventListener('click', () => {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    for (const article of articles) {
      const link = article.querySelector(`a[href*="/${entry.tweetId}"]`);
      if (link) {
        article.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  });

  return card;
}
