import type { FilterMode } from '../shared/types';
import { RELEVANT_THRESHOLD, UNCERTAIN_THRESHOLD } from '../shared/constants';

const FEEDLENS_CLASSES = [
  'feedlens-relevant',
  'feedlens-dimmed',
  'feedlens-uncertain',
  'feedlens-hidden',
];

export function applyTweetStyle(
  element: Element,
  score: number,
  filterMode: FilterMode
): void {
  // Clear previous classes
  FEEDLENS_CLASSES.forEach((cls) => element.classList.remove(cls));

  if (filterMode === 'off') return;

  if (score >= RELEVANT_THRESHOLD) {
    element.classList.add('feedlens-relevant');
  } else if (score >= UNCERTAIN_THRESHOLD) {
    if (filterMode === 'dim') {
      element.classList.add('feedlens-uncertain');
    }
    // In hide mode, uncertain tweets are left untouched
  } else {
    if (filterMode === 'dim') {
      element.classList.add('feedlens-dimmed');
    } else if (filterMode === 'hide') {
      element.classList.add('feedlens-hidden');
    }
  }
}

export function clearAllStyles(): void {
  const styled = document.querySelectorAll(
    FEEDLENS_CLASSES.map((c) => `.${c}`).join(',')
  );
  styled.forEach((el) => {
    FEEDLENS_CLASSES.forEach((cls) => el.classList.remove(cls));
  });
}

// Hidden banner management
let bannerEl: HTMLElement | null = null;
let hiddenCount = 0;
let tempShowAll = false;

export function updateHiddenBanner(count: number): void {
  hiddenCount = count;

  if (count === 0 || tempShowAll) {
    bannerEl?.remove();
    bannerEl = null;
    return;
  }

  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.className = 'feedlens-hidden-banner';

    const text = document.createElement('span');
    text.className = 'feedlens-banner-text';
    bannerEl.appendChild(text);

    const showBtn = document.createElement('button');
    showBtn.textContent = 'Show all';
    showBtn.addEventListener('click', () => showAllHidden());
    bannerEl.appendChild(showBtn);

    const timeline = document.querySelector(
      '[data-testid="primaryColumn"]'
    );
    if (timeline) {
      timeline.insertBefore(bannerEl, timeline.firstChild);
    }
  }

  const textEl = bannerEl.querySelector('.feedlens-banner-text');
  if (textEl) {
    textEl.textContent = `${count} tweet${count !== 1 ? 's' : ''} hidden by FeedLens`;
  }
}

function showAllHidden(): void {
  tempShowAll = true;
  document.querySelectorAll('.feedlens-hidden').forEach((el) => {
    el.classList.remove('feedlens-hidden');
  });
  if (bannerEl) {
    bannerEl.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = 'Showing all tweets';
    bannerEl.appendChild(text);

    const resumeBtn = document.createElement('button');
    resumeBtn.textContent = 'Resume filtering';
    resumeBtn.addEventListener('click', () => {
      tempShowAll = false;
      // Trigger re-processing via storage change
      bannerEl?.remove();
      bannerEl = null;
      window.dispatchEvent(new CustomEvent('feedlens:reprocess'));
    });
    bannerEl.appendChild(resumeBtn);
  }
}

export function isTempShowAll(): boolean {
  return tempShowAll;
}

export function getHiddenCount(): number {
  return hiddenCount;
}
