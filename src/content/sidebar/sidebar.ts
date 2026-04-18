import './sidebar.css';
import { getEntries, subscribe, clearEntries } from './sidebar-store';
import { createTweetCard } from './sidebar-tweet-card';
import { savePreferences, getPreferences } from '../../shared/storage';
import { autoScroller } from '../auto-scroll';
import type { SidebarTweetEntry } from '../../shared/types';

type SortMode = 'score' | 'time';

let container: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let autoScrollStatusEl: HTMLElement | null = null;
let autoScrollPauseBtn: HTMLButtonElement | null = null;
let unsubscribe: (() => void) | null = null;
let unsubscribeAutoScroll: (() => void) | null = null;
let sortMode: SortMode = 'score';

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

  controls.appendChild(sortGroup);
  controls.appendChild(clearBtn);

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

  header.appendChild(headerTop);
  header.appendChild(controls);
  header.appendChild(createScoreFilterDOM());
  header.appendChild(autoScrollStatusEl);

  // List
  listEl = document.createElement('div');
  listEl.className = 'feedlens-sidebar-list';

  container.appendChild(header);
  container.appendChild(listEl);
  document.body.appendChild(container);
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

function render(): void {
  if (!listEl || !countEl) return;
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
