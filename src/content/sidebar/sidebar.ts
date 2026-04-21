import './sidebar.css';
import { getEntries, subscribe, clearEntries } from './sidebar-store';
import { createTweetCard } from './sidebar-tweet-card';
import { savePreferences, getPreferences } from '../../shared/storage';
import { autoScroller } from '../auto-scroll';
import type { SidebarTweetEntry, SummarizeTweetItem } from '../../shared/types';

type SortMode = 'score' | 'time';

let container: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let autoScrollStatusEl: HTMLElement | null = null;
let autoScrollPauseBtn: HTMLButtonElement | null = null;
let unsubscribe: (() => void) | null = null;
let unsubscribeAutoScroll: (() => void) | null = null;
let sortMode: SortMode = 'score';

// Summary view state
let summaryMode = false;
let summaryViewEl: HTMLElement | null = null;
let summarizeBtn: HTMLButtonElement | null = null;

// Daily limit banner state
let isLimitReached = false;

// Score range filter state
let scoreMin = 0;
let scoreMax = 10;
let histogramBars: HTMLElement[] = [];
let rangeMinInput: HTMLInputElement | null = null;
let rangeMaxInput: HTMLInputElement | null = null;
let minValDisplay: HTMLInputElement | null = null;
let maxValDisplay: HTMLInputElement | null = null;
let rangeFill: HTMLElement | null = null;

export function openSidebar(): void {
  if (!container) {
    createSidebarDOM();
  }
  requestAnimationFrame(() => {
    container!.classList.add('feedlens-sidebar-open');
    document.body.classList.add('feedlens-sidebar-active');
  });
  render();
  if (isLimitReached) showLimitBanner();
  if (!unsubscribe) {
    unsubscribe = subscribe(render);
  }
  if (!unsubscribeAutoScroll) {
    unsubscribeAutoScroll = autoScroller.subscribe(renderAutoScrollStatus);
    renderAutoScrollStatus(autoScroller.getStatus());
  }
}

export function closeSidebar(): void {
  if (!container) return;
  container.classList.remove('feedlens-sidebar-open');
  document.body.classList.remove('feedlens-sidebar-active');
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (unsubscribeAutoScroll) {
    unsubscribeAutoScroll();
    unsubscribeAutoScroll = null;
  }
  // Persist preference
  getPreferences().then((prefs) => {
    prefs.sidebarVisible = false;
    savePreferences(prefs);
  });
}

export function isSidebarOpen(): boolean {
  return container?.classList.contains('feedlens-sidebar-open') ?? false;
}

function createScoreFilterDOM(): HTMLElement {
  const section = document.createElement('div');
  section.className = 'feedlens-score-filter';

  const label = document.createElement('div');
  label.className = 'feedlens-score-filter-label';
  label.textContent = 'Score range';
  section.appendChild(label);

  // Histogram (10 bars for scores 0-1, 1-2, ..., 9-10)
  const histogram = document.createElement('div');
  histogram.className = 'feedlens-score-histogram';
  histogramBars = [];
  for (let i = 0; i < 10; i++) {
    const bar = document.createElement('div');
    bar.className = 'feedlens-score-histogram-bar';
    histogram.appendChild(bar);
    histogramBars.push(bar);
  }
  section.appendChild(histogram);

  // Slider track + dual range inputs
  const sliderWrap = document.createElement('div');
  sliderWrap.className = 'feedlens-range-wrap';

  const trackBg = document.createElement('div');
  trackBg.className = 'feedlens-range-track-bg';
  sliderWrap.appendChild(trackBg);

  rangeFill = document.createElement('div');
  rangeFill.className = 'feedlens-range-fill';
  sliderWrap.appendChild(rangeFill);

  rangeMinInput = document.createElement('input');
  rangeMinInput.type = 'range';
  rangeMinInput.min = '0';
  rangeMinInput.max = '10';
  rangeMinInput.step = '1';
  rangeMinInput.value = String(scoreMin);
  rangeMinInput.className = 'feedlens-range-input feedlens-range-input--min';
  rangeMinInput.addEventListener('input', onRangeChange);
  sliderWrap.appendChild(rangeMinInput);

  rangeMaxInput = document.createElement('input');
  rangeMaxInput.type = 'range';
  rangeMaxInput.min = '0';
  rangeMaxInput.max = '10';
  rangeMaxInput.step = '1';
  rangeMaxInput.value = String(scoreMax);
  rangeMaxInput.className = 'feedlens-range-input feedlens-range-input--max';
  rangeMaxInput.addEventListener('input', onRangeChange);
  sliderWrap.appendChild(rangeMaxInput);

  section.appendChild(sliderWrap);

  // Min / Max value inputs
  const inputsRow = document.createElement('div');
  inputsRow.className = 'feedlens-score-inputs';

  const minWrap = document.createElement('div');
  minWrap.className = 'feedlens-score-input-wrap';
  const minLabel = document.createElement('span');
  minLabel.className = 'feedlens-score-input-label';
  minLabel.textContent = 'Minimum';
  minValDisplay = document.createElement('input');
  minValDisplay.type = 'number';
  minValDisplay.min = '0';
  minValDisplay.max = '10';
  minValDisplay.value = String(scoreMin);
  minValDisplay.className = 'feedlens-score-val-input';
  minValDisplay.addEventListener('change', () => {
    const v = Math.max(0, Math.min(scoreMax - 1, parseInt(minValDisplay!.value) || 0));
    scoreMin = v;
    minValDisplay!.value = String(v);
    rangeMinInput!.value = String(v);
    updateRangeFill();
    render();
  });
  minWrap.appendChild(minLabel);
  minWrap.appendChild(minValDisplay);

  const maxWrap = document.createElement('div');
  maxWrap.className = 'feedlens-score-input-wrap';
  const maxLabel = document.createElement('span');
  maxLabel.className = 'feedlens-score-input-label';
  maxLabel.textContent = 'Maximum';
  maxValDisplay = document.createElement('input');
  maxValDisplay.type = 'number';
  maxValDisplay.min = '0';
  maxValDisplay.max = '10';
  maxValDisplay.value = String(scoreMax);
  maxValDisplay.className = 'feedlens-score-val-input';
  maxValDisplay.addEventListener('change', () => {
    const v = Math.max(scoreMin + 1, Math.min(10, parseInt(maxValDisplay!.value) || 10));
    scoreMax = v;
    maxValDisplay!.value = String(v);
    rangeMaxInput!.value = String(v);
    updateRangeFill();
    render();
  });
  maxWrap.appendChild(maxLabel);
  maxWrap.appendChild(maxValDisplay);

  inputsRow.appendChild(minWrap);
  inputsRow.appendChild(maxWrap);
  section.appendChild(inputsRow);

  updateRangeFill();
  return section;
}

function onRangeChange(): void {
  let min = parseInt(rangeMinInput!.value);
  let max = parseInt(rangeMaxInput!.value);

  // Clamp so min < max
  if (min >= max) {
    if (document.activeElement === rangeMinInput) {
      min = Math.max(0, max - 1);
      rangeMinInput!.value = String(min);
    } else {
      max = Math.min(10, min + 1);
      rangeMaxInput!.value = String(max);
    }
  }

  scoreMin = min;
  scoreMax = max;
  if (minValDisplay) minValDisplay.value = String(min);
  if (maxValDisplay) maxValDisplay.value = String(max);
  updateRangeFill();
  render();
}

function updateRangeFill(): void {
  if (!rangeFill) return;
  const left = (scoreMin / 10) * 100;
  const right = 100 - (scoreMax / 10) * 100;
  rangeFill.style.left = `${left}%`;
  rangeFill.style.right = `${right}%`;

  // Raise z-index of whichever thumb is more to the right so they remain grabable
  if (rangeMinInput && rangeMaxInput) {
    if (scoreMin / 10 > 0.5) {
      rangeMinInput.style.zIndex = '3';
      rangeMaxInput.style.zIndex = '2';
    } else {
      rangeMinInput.style.zIndex = '2';
      rangeMaxInput.style.zIndex = '3';
    }
  }
}

function renderHistogram(allEntries: readonly SidebarTweetEntry[]): void {
  if (histogramBars.length === 0) return;
  const buckets = new Array(10).fill(0) as number[];
  for (const e of allEntries) {
    const idx = Math.min(9, Math.floor(e.score));
    buckets[idx]++;
  }
  const maxCount = Math.max(1, ...buckets);
  for (let i = 0; i < 10; i++) {
    const bar = histogramBars[i];
    if (!bar) continue;
    const heightPct = (buckets[i] / maxCount) * 100;
    bar.style.height = `${Math.max(6, heightPct)}%`;
    // Highlight bars within the selected range
    const inRange = i >= scoreMin && i < scoreMax;
    bar.classList.toggle('feedlens-score-histogram-bar--active', inRange);
  }
}

function createSidebarDOM(): void {
  container = document.createElement('div');
  container.className = 'feedlens-sidebar';

  // Header
  const header = document.createElement('div');
  header.className = 'feedlens-sidebar-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'feedlens-sidebar-title-row';

  const title = document.createElement('span');
  title.className = 'feedlens-sidebar-title';
  title.textContent = 'FeedLens';

  countEl = document.createElement('span');
  countEl.className = 'feedlens-sidebar-count';
  countEl.textContent = '0';

  titleRow.appendChild(title);
  titleRow.appendChild(countEl);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'feedlens-sidebar-icon-btn';
  closeBtn.setAttribute('aria-label', 'Close sidebar');
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', closeSidebar);

  const headerTop = document.createElement('div');
  headerTop.className = 'feedlens-sidebar-header-top';
  headerTop.appendChild(titleRow);
  headerTop.appendChild(closeBtn);

  // Controls row: sort + clear
  const controls = document.createElement('div');
  controls.className = 'feedlens-sidebar-controls';

  const sortGroup = document.createElement('div');
  sortGroup.className = 'feedlens-sidebar-sort';

  const sortScore = makeSortBtn('Score', 'score');
  const sortTime = makeSortBtn('Newest', 'time');
  sortGroup.appendChild(sortScore);
  sortGroup.appendChild(sortTime);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'feedlens-sidebar-text-btn';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    clearEntries();
  });

  summarizeBtn = document.createElement('button');
  summarizeBtn.className = 'feedlens-sidebar-text-btn feedlens-summarize-btn';
  summarizeBtn.textContent = 'Summarize';
  summarizeBtn.addEventListener('click', enterSummaryMode);

  controls.appendChild(sortGroup);
  controls.appendChild(clearBtn);
  controls.appendChild(summarizeBtn);

  // Auto-scroll status bar (hidden by default; shown when auto-scroll is running)
  autoScrollStatusEl = document.createElement('div');
  autoScrollStatusEl.className = 'feedlens-autoscroll-status feedlens-autoscroll-status--hidden';

  const statusDot = document.createElement('span');
  statusDot.className = 'feedlens-autoscroll-dot';

  const statusText = document.createElement('span');
  statusText.className = 'feedlens-autoscroll-text';

  autoScrollPauseBtn = document.createElement('button');
  autoScrollPauseBtn.className = 'feedlens-autoscroll-pause-btn';
  autoScrollPauseBtn.addEventListener('click', () => autoScroller.toggleUserPause());

  autoScrollStatusEl.appendChild(statusDot);
  autoScrollStatusEl.appendChild(statusText);
  autoScrollStatusEl.appendChild(autoScrollPauseBtn);

  // Search & Collect row
  const searchRow = document.createElement('div');
  searchRow.className = 'feedlens-sidebar-search';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'feedlens-sidebar-search-input';
  searchInput.placeholder = 'Search Twitter…';

  // Pre-fill with current search query if on a search page
  const urlParams = new URLSearchParams(window.location.search);
  const currentQuery = urlParams.get('q');
  if (currentQuery) searchInput.value = currentQuery;

  const searchGoBtn = document.createElement('button');
  searchGoBtn.className = 'feedlens-sidebar-search-btn';
  searchGoBtn.textContent = 'Go';

  const doSearch = (): void => {
    const query = searchInput.value.trim();
    if (!query) return;
    window.location.href = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
  };

  searchGoBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });

  searchRow.appendChild(searchInput);
  searchRow.appendChild(searchGoBtn);

  header.appendChild(headerTop);
  header.appendChild(searchRow);
  header.appendChild(controls);
  header.appendChild(createScoreFilterDOM());
  header.appendChild(autoScrollStatusEl);

  // List
  listEl = document.createElement('div');
  listEl.className = 'feedlens-sidebar-list';

  container.appendChild(header);
  container.appendChild(listEl);
  document.body.appendChild(container);

  window.addEventListener('feedlens:limit-reached', () => {
    isLimitReached = true;
    showLimitBanner();
  });
}

function showLimitBanner(): void {
  if (!listEl || listEl.querySelector('.feedlens-limit-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'feedlens-limit-banner';
  banner.textContent = 'Daily scan limit reached (2,000 tweets). Auto-scroll stopped. Resets tomorrow.';
  listEl.prepend(banner);
}

function makeSortBtn(label: string, mode: SortMode): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'feedlens-sidebar-sort-btn';
  btn.textContent = label;
  btn.dataset.sortMode = mode;
  if (sortMode === mode) btn.classList.add('active');
  btn.addEventListener('click', () => {
    sortMode = mode;
    // Update active state on all sort buttons
    container
      ?.querySelectorAll('.feedlens-sidebar-sort-btn')
      .forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.sortMode === mode));
    render();
  });
  return btn;
}

function sortEntries(entries: readonly SidebarTweetEntry[]): SidebarTweetEntry[] {
  const copy = [...entries];
  if (sortMode === 'score') {
    copy.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);
  } else {
    copy.sort((a, b) => b.timestamp - a.timestamp);
  }
  return copy;
}

function renderAutoScrollStatus(status: ReturnType<typeof autoScroller.getStatus>): void {
  if (!autoScrollStatusEl || !autoScrollPauseBtn) return;

  if (!status.running) {
    autoScrollStatusEl.classList.add('feedlens-autoscroll-status--hidden');
    return;
  }

  autoScrollStatusEl.classList.remove('feedlens-autoscroll-status--hidden');
  autoScrollStatusEl.classList.toggle('feedlens-autoscroll-status--paused', status.userPaused);

  const textEl = autoScrollStatusEl.querySelector('.feedlens-autoscroll-text') as HTMLElement;
  if (textEl) {
    textEl.textContent = status.userPaused
      ? `Paused \u00b7 ${status.tweetsCollected} collected`
      : `Auto-collecting \u00b7 ${status.tweetsCollected} scored`;
  }

  autoScrollPauseBtn.textContent = status.userPaused ? 'Resume' : 'Pause';
}

// ── Summary view ────────────────────────────────────────────────────────────

function enterSummaryMode(): void {
  summaryMode = true;
  if (listEl) listEl.style.display = 'none';
  if (summarizeBtn) summarizeBtn.textContent = 'List';
  summarizeBtn?.removeEventListener('click', enterSummaryMode);
  summarizeBtn?.addEventListener('click', exitSummaryMode);
  showSummaryView();
}

export function exitSummaryMode(): void {
  summaryMode = false;
  if (listEl) listEl.style.display = '';
  if (summarizeBtn) summarizeBtn.textContent = 'Summarize';
  summarizeBtn?.removeEventListener('click', exitSummaryMode);
  summarizeBtn?.addEventListener('click', enterSummaryMode);
  if (summaryViewEl) {
    summaryViewEl.remove();
    summaryViewEl = null;
  }
}

function showSummaryView(): void {
  if (summaryViewEl) summaryViewEl.remove();

  summaryViewEl = document.createElement('div');
  summaryViewEl.className = 'feedlens-summary-view';

  // Loading indicator
  const loading = document.createElement('div');
  loading.className = 'feedlens-summary-loading';
  const spinner = document.createElement('span');
  spinner.className = 'feedlens-summary-spinner';
  loading.appendChild(spinner);
  loading.appendChild(document.createTextNode(' Generating summary…'));
  summaryViewEl.appendChild(loading);

  container!.appendChild(summaryViewEl);

  // Gather top 30 scored tweets
  const entries = getEntries();
  const tweetsToSummarize: SummarizeTweetItem[] = [...entries]
    .sort((a, b) => b.score - a.score)
    .slice(0, 30)
    .map((e) => ({ tweetId: e.tweetId, text: e.text, authorHandle: e.authorHandle }));

  chrome.runtime
    .sendMessage({ type: 'SUMMARIZE_TWEETS', payload: { tweets: tweetsToSummarize } })
    .then((response: { summary?: string; error?: string }) => {
      if (!summaryViewEl) return;
      loading.remove();
      if (response?.error) {
        renderSummaryError(summaryViewEl, response.error);
      } else {
        renderSummaryContent(summaryViewEl, tweetsToSummarize, response?.summary ?? '');
      }
    })
    .catch(() => {
      if (!summaryViewEl) return;
      loading.remove();
      renderSummaryError(summaryViewEl, 'Failed to reach background. Reload the page and try again.');
    });
}

function renderSummaryError(parent: HTMLElement, message: string): void {
  const err = document.createElement('div');
  err.className = 'feedlens-summary-error';
  err.textContent = message;
  parent.appendChild(err);
}

function renderSummaryContent(
  parent: HTMLElement,
  tweets: SummarizeTweetItem[],
  summaryText: string
): void {
  // Summary text body with inline [N] → superscript references
  const body = document.createElement('div');
  body.className = 'feedlens-summary-body';

  const parts = summaryText.split(/(\[\d+\])/g);
  for (const part of parts) {
    const refMatch = part.match(/^\[(\d+)\]$/);
    if (refMatch) {
      const num = parseInt(refMatch[1], 10);
      const tweet = tweets[num - 1];

      const sup = document.createElement('sup');
      sup.className = 'feedlens-ref';
      sup.textContent = String(num);

      if (tweet) {
        const tooltip = document.createElement('div');
        tooltip.className = 'feedlens-ref-tooltip';

        const handleEl = document.createElement('span');
        handleEl.className = 'feedlens-ref-tooltip-handle';
        handleEl.textContent = `@${tweet.authorHandle}`;
        tooltip.appendChild(handleEl);

        const excerptEl = document.createElement('p');
        excerptEl.className = 'feedlens-ref-tooltip-text';
        excerptEl.textContent =
          tweet.text.length > 180 ? tweet.text.slice(0, 180) + '…' : tweet.text;
        tooltip.appendChild(excerptEl);

        const openLink = document.createElement('a');
        openLink.className = 'feedlens-ref-tooltip-link';
        openLink.href = `https://x.com/${tweet.authorHandle}/status/${tweet.tweetId}`;
        openLink.target = '_blank';
        openLink.rel = 'noopener noreferrer';
        openLink.textContent = 'Open tweet →';
        openLink.addEventListener('click', (e) => e.stopPropagation());
        tooltip.appendChild(openLink);

        sup.appendChild(tooltip);
      }

      body.appendChild(sup);
    } else if (part) {
      const lines = part.split('\n');
      lines.forEach((line, i) => {
        if (line) body.appendChild(document.createTextNode(line));
        if (i < lines.length - 1) body.appendChild(document.createElement('br'));
      });
    }
  }

  parent.appendChild(body);

  // Collect referenced tweet indices
  const referencedNums = new Set<number>();
  for (const part of summaryText.split(/(\[\d+\])/g)) {
    const m = part.match(/^\[(\d+)\]$/);
    if (m) referencedNums.add(parseInt(m[1], 10));
  }

  // Sources list
  const referencedTweets = tweets
    .map((t, i) => ({ tweet: t, num: i + 1 }))
    .filter(({ num }) => referencedNums.has(num));

  if (referencedTweets.length > 0) {
    const sourcesTitle = document.createElement('div');
    sourcesTitle.className = 'feedlens-summary-sources-title';
    sourcesTitle.textContent = 'Sources';
    parent.appendChild(sourcesTitle);

    const sourcesList = document.createElement('div');
    sourcesList.className = 'feedlens-summary-sources';

    for (const { tweet, num } of referencedTweets) {
      const item = document.createElement('div');
      item.className = 'feedlens-summary-source-item';

      const numEl = document.createElement('sup');
      numEl.className = 'feedlens-ref-num';
      numEl.textContent = String(num);
      item.appendChild(numEl);

      const link = document.createElement('a');
      link.className = 'feedlens-summary-source-link';
      link.href = `https://x.com/${tweet.authorHandle}/status/${tweet.tweetId}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `@${tweet.authorHandle}`;
      link.addEventListener('click', (e) => e.stopPropagation());
      item.appendChild(link);

      const excerpt = document.createElement('span');
      excerpt.className = 'feedlens-summary-source-excerpt';
      excerpt.textContent =
        tweet.text.length > 80 ? tweet.text.slice(0, 80) + '…' : tweet.text;
      item.appendChild(excerpt);

      sourcesList.appendChild(item);
    }

    parent.appendChild(sourcesList);
  }
}

function render(): void {
  if (!listEl || !countEl) return;
  if (summaryMode) return; // don't clobber the summary view
  const allEntries = getEntries();

  renderHistogram(allEntries);

  const sorted = sortEntries(allEntries);
  const filtered = sorted.filter((e) => e.score >= scoreMin && e.score <= scoreMax);

  // Rebuild the list — with sorting + dedup, incremental rendering gets
  // tangled. List is capped at 500 so full render is still cheap.
  listEl.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'feedlens-sidebar-empty';
    empty.textContent = allEntries.length === 0
      ? 'No tweets scored yet. Scroll your feed — tweets appear here as they are analyzed.'
      : 'No tweets in this score range. Adjust the filter above.';
    listEl.appendChild(empty);
  } else {
    for (const entry of filtered) {
      listEl.appendChild(createTweetCard(entry));
    }
  }

  // Show "X / Y" when filter is active, otherwise just "Y"
  const isFiltered = scoreMin > 0 || scoreMax < 10;
  countEl.textContent = isFiltered
    ? `${filtered.length} / ${allEntries.length}`
    : `${allEntries.length}`;
}
