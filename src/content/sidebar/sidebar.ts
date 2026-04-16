import './sidebar.css';
import { getEntries, subscribe, clearEntries } from './sidebar-store';
import { createTweetCard } from './sidebar-tweet-card';
import { savePreferences, getPreferences } from '../../shared/storage';
import type { SidebarTweetEntry } from '../../shared/types';

type SortMode = 'score' | 'time';

let container: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let unsubscribe: (() => void) | null = null;
let sortMode: SortMode = 'score';

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
}

export function closeSidebar(): void {
  if (!container) return;
  container.classList.remove('feedlens-sidebar-open');
  document.body.classList.remove('feedlens-sidebar-active');
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
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

  header.appendChild(headerTop);
  header.appendChild(controls);

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

function render(): void {
  if (!listEl || !countEl) return;
  const entries = sortEntries(getEntries());

  // Rebuild the list — with sorting + dedup, incremental rendering gets
  // tangled. List is capped at 500 so full render is still cheap.
  listEl.innerHTML = '';

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'feedlens-sidebar-empty';
    empty.textContent = 'No tweets scored yet. Scroll your feed — tweets appear here as they are analyzed.';
    listEl.appendChild(empty);
  } else {
    for (const entry of entries) {
      listEl.appendChild(createTweetCard(entry));
    }
  }

  countEl.textContent = `${entries.length}`;
}
