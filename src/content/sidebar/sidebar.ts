import './sidebar.css';
import { getEntries, subscribe, clearEntries } from './sidebar-store';
import { createTweetCard } from './sidebar-tweet-card';
import { savePreferences, getPreferences } from '../../shared/storage';

let container: HTMLElement | null = null;
let listEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let renderedCount = 0;
let unsubscribe: (() => void) | null = null;

export function openSidebar(): void {
  if (!container) {
    createSidebarDOM();
  }
  // Small delay to allow the browser to paint the initial position
  requestAnimationFrame(() => {
    container!.classList.add('feedlens-sidebar-open');
    document.body.classList.add('feedlens-sidebar-active');
  });
  renderFull();
  if (!unsubscribe) {
    unsubscribe = subscribe(renderIncremental);
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

  const headerLeft = document.createElement('div');
  headerLeft.className = 'feedlens-sidebar-header-left';

  const title = document.createElement('span');
  title.className = 'feedlens-sidebar-title';
  title.textContent = 'FeedLens';

  countEl = document.createElement('span');
  countEl.className = 'feedlens-sidebar-count';
  countEl.textContent = '0 tweets';

  headerLeft.appendChild(title);
  headerLeft.appendChild(countEl);

  const actions = document.createElement('div');
  actions.className = 'feedlens-sidebar-header-actions';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'feedlens-sidebar-btn';
  clearBtn.textContent = 'Clear';
  clearBtn.addEventListener('click', () => {
    clearEntries();
    renderFull();
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'feedlens-sidebar-btn feedlens-sidebar-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', closeSidebar);

  actions.appendChild(clearBtn);
  actions.appendChild(closeBtn);

  header.appendChild(headerLeft);
  header.appendChild(actions);

  // List
  listEl = document.createElement('div');
  listEl.className = 'feedlens-sidebar-list';

  container.appendChild(header);
  container.appendChild(listEl);
  document.body.appendChild(container);
}

function renderFull(): void {
  if (!listEl || !countEl) return;
  listEl.innerHTML = '';
  renderedCount = 0;
  const entries = getEntries();
  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'feedlens-sidebar-empty';
    empty.textContent = 'No tweets collected yet. Scroll through your feed.';
    listEl.appendChild(empty);
  } else {
    for (const entry of entries) {
      listEl.appendChild(createTweetCard(entry));
    }
    renderedCount = entries.length;
  }
  countEl.textContent = `${entries.length} tweet${entries.length !== 1 ? 's' : ''}`;
}

function renderIncremental(): void {
  if (!listEl || !countEl) return;
  const entries = getEntries();

  // If entries were cleared, do a full render
  if (entries.length < renderedCount) {
    renderFull();
    return;
  }

  // Remove empty message if it exists and we have entries
  if (entries.length > 0 && renderedCount === 0) {
    listEl.innerHTML = '';
  }

  // Append only new entries
  for (let i = renderedCount; i < entries.length; i++) {
    listEl.appendChild(createTweetCard(entries[i]));
  }
  renderedCount = entries.length;
  countEl.textContent = `${entries.length} tweet${entries.length !== 1 ? 's' : ''}`;
}
