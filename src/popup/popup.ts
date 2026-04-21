import type { UserPreferences, Session, SessionStats } from '../shared/types';
import { AI_FREE_DAILY_LIMIT, AI_PAID_DAILY_LIMIT, DAILY_SCAN_LIMIT } from '../shared/constants';
import {
  getSessions,
  saveSessions,
  getActiveSessionId,
  setActiveSessionId,
  clearSessionSidebarEntries,
} from '../shared/storage';

// --- Page elements ---
const pageSessionsEl = document.getElementById('page-sessions')!;
const pageDetailEl = document.getElementById('page-detail')!;
const sessionListEl = document.getElementById('session-list')!;
const createSessionBtn = document.getElementById('create-session-btn') as HTMLButtonElement;
const backBtn = document.getElementById('back-btn') as HTMLButtonElement;
const detailTitle = document.getElementById('detail-title')!;

// --- Global elements (sessions page) ---
const aiApiKey = document.getElementById('ai-api-key') as HTMLInputElement;
const scanUsageEl = document.getElementById('scan-usage')!;
const scanUsageTextEl = document.getElementById('scan-usage-text')!;
const scanUsageFillEl = document.getElementById('scan-usage-fill') as HTMLElement;
const scanLimitMsgEl = document.getElementById('scan-limit-msg')!;

// --- Detail elements ---
const sessionNameInput = document.getElementById('session-name') as HTMLInputElement;
const aiAgenda = document.getElementById('ai-agenda') as HTMLTextAreaElement;
const saveRunBtn = document.getElementById('save-run-btn') as HTMLButtonElement;
const deleteSessionBtn = document.getElementById('delete-session-btn') as HTMLButtonElement;
const runPluginStatus = document.getElementById('run-plugin-status')!;
const toggleEnabled = document.getElementById('toggle-enabled') as HTMLInputElement;
const toggleSidebar = document.getElementById('toggle-sidebar') as HTMLInputElement;
const toggleAutoScroll = document.getElementById('toggle-autoscroll') as HTMLInputElement;
const searchQuery = document.getElementById('search-query') as HTMLInputElement;
const searchBtn = document.getElementById('search-btn') as HTMLButtonElement;
const searchStatus = document.getElementById('search-status')!;

// --- State ---
let sessions: Session[] = [];
let currentSessionId: string | null = null; // session being edited
let currentActiveId: string | null = null;  // currently running session
let isNewSession = false;
let preferences: UserPreferences;

// --- Page navigation ---

function showSessionsPage(): void {
  pageDetailEl.classList.add('hidden');
  pageSessionsEl.classList.remove('hidden');
  runPluginStatus.textContent = '';
  aiApiKey.value = preferences.aiConfig.apiKey;
  renderSessionList();
  renderScanUsage();
}

async function renderScanUsage(): Promise<void> {
  const stats = (await chrome.runtime.sendMessage({ type: 'GET_STATS' })) as SessionStats | undefined;
  if (!stats) return;
  const pct = Math.min(100, Math.round((stats.scanned / DAILY_SCAN_LIMIT) * 100));
  scanUsageEl.classList.remove('hidden');
  scanUsageTextEl.textContent = `${stats.scanned.toLocaleString()} / ${DAILY_SCAN_LIMIT.toLocaleString()} tweets scanned today · ${pct}%`;
  scanUsageFillEl.style.width = `${pct}%`;
  scanUsageFillEl.classList.toggle('scan-usage-bar-fill--warning', pct >= 75 && pct < 100);
  scanUsageFillEl.classList.toggle('scan-usage-bar-fill--limit', pct >= 100);
  scanLimitMsgEl.classList.toggle('hidden', stats.scanned < DAILY_SCAN_LIMIT);
}

function showDetailPage(session: Session | null): void {
  pageSessionsEl.classList.add('hidden');
  pageDetailEl.classList.remove('hidden');

  if (session) {
    isNewSession = false;
    currentSessionId = session.id;
    detailTitle.textContent = session.name;
    sessionNameInput.value = session.name;
    aiAgenda.value = session.agenda;
    deleteSessionBtn.classList.remove('hidden');

    // Activate this session so the sidebar switches immediately
    let needsSave = false;
    if (currentActiveId !== session.id) {
      currentActiveId = session.id;
      setActiveSessionId(session.id);
      preferences.aiConfig.agenda = session.agenda;
      needsSave = true;
    }

    // Always ensure sidebar is visible when opening a session
    if (!preferences.sidebarVisible) {
      preferences.sidebarVisible = true;
      toggleSidebar.checked = true;
      needsSave = true;
    }

    if (needsSave) {
      savePrefs();
    }
  } else {
    isNewSession = true;
    currentSessionId = null;
    detailTitle.textContent = 'New Session';
    sessionNameInput.value = '';
    aiAgenda.value = '';
    deleteSessionBtn.classList.add('hidden');
  }

  // Set toggles from global prefs
  toggleEnabled.checked = preferences.enabled;
  toggleSidebar.checked = preferences.sidebarVisible;
  toggleAutoScroll.checked = preferences.autoScrollEnabled ?? false;

  runPluginStatus.textContent = '';
}

// --- Render session list ---

function renderSessionList(): void {
  sessionListEl.innerHTML = '';

  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'session-list-empty';
    empty.textContent = 'No sessions yet';
    sessionListEl.appendChild(empty);
    return;
  }

  for (const session of sessions) {
    const card = document.createElement('div');
    card.className = 'session-card';
    if (session.id === currentActiveId) {
      card.classList.add('session-card--active');
    }

    const name = document.createElement('div');
    name.className = 'session-card-name';
    name.textContent = session.name;

    const agenda = document.createElement('div');
    agenda.className = 'session-card-agenda';
    const firstLine = session.agenda.split('\n')[0] ?? '';
    agenda.textContent = firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : firstLine;

    const meta = document.createElement('div');
    meta.className = 'session-card-meta';
    const date = new Date(session.createdAt).toLocaleDateString();
    meta.textContent = `${session.tweetCount} tweets · ${date}`;

    card.appendChild(name);
    card.appendChild(agenda);
    card.appendChild(meta);

    card.addEventListener('click', () => {
      const s = sessions.find((x) => x.id === session.id);
      if (s) showDetailPage(s);
    });

    sessionListEl.appendChild(card);
  }
}

// --- Handlers ---

async function handleSaveAndRun(): Promise<void> {
  const name = sessionNameInput.value.trim();
  const agenda = aiAgenda.value.trim();
  const apiKey = preferences.aiConfig.apiKey;

  if (!name) {
    runPluginStatus.textContent = 'Add a session name first.';
    return;
  }
  if (!agenda) {
    runPluginStatus.textContent = 'Add what to search first.';
    return;
  }
  if (!apiKey) {
    runPluginStatus.textContent = 'Set your OpenRouter API key on the main page first.';
    return;
  }

  let session: Session;

  if (isNewSession) {
    session = {
      id: crypto.randomUUID(),
      name,
      agenda,
      createdAt: Date.now(),
      tweetCount: 0,
    };
    sessions.push(session);
    isNewSession = false;
    currentSessionId = session.id;
    deleteSessionBtn.classList.remove('hidden');
  } else {
    const idx = sessions.findIndex((s) => s.id === currentSessionId);
    if (idx === -1) {
      runPluginStatus.textContent = 'Session not found.';
      return;
    }
    sessions[idx].name = name;
    sessions[idx].agenda = agenda;
    session = sessions[idx];
  }

  await saveSessions(sessions);

  // Sync to global preferences
  preferences.enabled = true;
  preferences.sidebarVisible = true;
  preferences.aiConfig.enabled = true;
  preferences.aiConfig.agenda = agenda;
  preferences.aiConfig.apiKey = apiKey;
  preferences.aiConfig.dailyLimit = AI_PAID_DAILY_LIMIT;

  toggleEnabled.checked = true;
  toggleSidebar.checked = true;

  savePrefs();

  // Activate this session
  currentActiveId = session.id;
  await setActiveSessionId(session.id);

  detailTitle.textContent = session.name;
  runPluginStatus.textContent = 'Saved. Plugin is running with AI.';
}

async function handleDeleteSession(): Promise<void> {
  if (!currentSessionId) return;

  const idx = sessions.findIndex((s) => s.id === currentSessionId);
  if (idx === -1) return;

  sessions.splice(idx, 1);
  await saveSessions(sessions);

  // Clean up session entries
  await clearSessionSidebarEntries(currentSessionId);

  // If this was the active session, deactivate
  if (currentActiveId === currentSessionId) {
    currentActiveId = null;
    await setActiveSessionId(null);
  }

  currentSessionId = null;
  showSessionsPage();
}

function savePrefs(): void {
  chrome.runtime.sendMessage({
    type: 'SAVE_PREFERENCES',
    payload: preferences,
  });
}

// --- Init ---

async function init(): Promise<void> {
  preferences = (await chrome.runtime.sendMessage({
    type: 'GET_PREFERENCES',
  })) as UserPreferences;

  // Backward compat
  if (!preferences.selectedKeywords) preferences.selectedKeywords = {};
  if (preferences.sidebarVisible === undefined) preferences.sidebarVisible = false;
  if (!preferences.blockedKeywords) preferences.blockedKeywords = [];
  if (!preferences.customKeywords) preferences.customKeywords = {};
  if (!preferences.aiConfig) {
    preferences.aiConfig = {
      enabled: false,
      apiKey: '',
      agenda: '',
      dailyLimit: AI_FREE_DAILY_LIMIT,
      requestsUsedToday: 0,
      lastResetDate: new Date().toISOString().split('T')[0],
    };
  }

  sessions = await getSessions();
  currentActiveId = await getActiveSessionId();

  // --- Event listeners ---

  createSessionBtn.addEventListener('click', () => showDetailPage(null));
  backBtn.addEventListener('click', () => showSessionsPage());

  aiApiKey.addEventListener('change', () => {
    preferences.aiConfig.apiKey = aiApiKey.value.trim();
    savePrefs();
  });
  saveRunBtn.addEventListener('click', () => handleSaveAndRun());
  deleteSessionBtn.addEventListener('click', () => handleDeleteSession());

  toggleEnabled.addEventListener('change', () => {
    preferences.enabled = toggleEnabled.checked;
    savePrefs();
  });

  toggleSidebar.addEventListener('change', () => {
    preferences.sidebarVisible = toggleSidebar.checked;
    savePrefs();
  });

  toggleAutoScroll.addEventListener('change', () => {
    preferences.autoScrollEnabled = toggleAutoScroll.checked;
    savePrefs();
  });

  searchBtn.addEventListener('click', async () => {
    const query = searchQuery.value.trim();
    if (!query) {
      searchStatus.textContent = 'Enter a search query first.';
      return;
    }
    const searchUrl = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        searchStatus.textContent = 'No active tab found.';
        return;
      }
      await chrome.tabs.update(tab.id, { url: searchUrl });
      searchStatus.textContent = `Searching for "${query}"...`;
    } catch {
      searchStatus.textContent = 'Failed to navigate. Try again.';
    }
  });

  searchQuery.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchBtn.click();
  });

  // Start on sessions page
  showSessionsPage();
}

init();
