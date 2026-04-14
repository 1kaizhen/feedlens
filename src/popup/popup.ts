import type { UserPreferences, SessionStats } from '../shared/types';
import { AI_FREE_DAILY_LIMIT, AI_PAID_DAILY_LIMIT } from '../shared/constants';

const powerToggle = document.getElementById('power-toggle') as HTMLInputElement;
const popup = document.querySelector('.popup')!;
const statsScanned = document.getElementById('stats-scanned')!;
const statsRelevant = document.getElementById('stats-relevant')!;
const statsFiltered = document.getElementById('stats-filtered')!;
const sidebarToggle = document.getElementById('sidebar-toggle')!;
const aiToggle = document.getElementById('ai-toggle') as HTMLInputElement;
const aiAgenda = document.getElementById('ai-agenda') as HTMLTextAreaElement;
const aiApiKey = document.getElementById('ai-api-key') as HTMLInputElement;
const aiBudgetText = document.getElementById('ai-budget-text')!;
const aiBudgetFill = document.getElementById('ai-budget-fill')!;
const ctaBtn = document.getElementById('cta-btn')!;

let preferences: UserPreferences;
let agendaDebounceTimer: ReturnType<typeof setTimeout> | null = null;

async function init(): Promise<void> {
  preferences = (await chrome.runtime.sendMessage({
    type: 'GET_PREFERENCES',
  })) as UserPreferences;

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

  renderPower();
  renderSidebarToggle();
  renderAiSection();
  await updateStatsDisplay();
  await updateAiBudget();

  ctaBtn.addEventListener('click', async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isOnX = activeTab?.url && /^https?:\/\/(twitter|x)\.com/.test(activeTab.url);

    if (isOnX) {
      // Already on X — just close the popup; content script is already running
      window.close();
    } else if (activeTab?.id) {
      // Navigate the current tab to X instead of opening a new one
      await chrome.tabs.update(activeTab.id, { url: 'https://x.com' });
      window.close();
    }
  });
}

function renderPower(): void {
  powerToggle.checked = preferences.enabled;
  popup.classList.toggle('disabled', !preferences.enabled);

  powerToggle.addEventListener('change', () => {
    preferences.enabled = powerToggle.checked;
    popup.classList.toggle('disabled', !preferences.enabled);
    savePrefs();
  });
}

function renderSidebarToggle(): void {
  sidebarToggle.classList.toggle('active', preferences.sidebarVisible);

  sidebarToggle.addEventListener('click', () => {
    preferences.sidebarVisible = !preferences.sidebarVisible;
    sidebarToggle.classList.toggle('active', preferences.sidebarVisible);
    savePrefs();
  });
}

function renderAiSection(): void {
  const config = preferences.aiConfig;
  aiToggle.checked = config.enabled;
  aiAgenda.value = config.agenda;
  aiApiKey.value = config.apiKey;

  aiToggle.addEventListener('change', () => {
    preferences.aiConfig.enabled = aiToggle.checked;
    savePrefs();
  });

  aiAgenda.addEventListener('input', () => {
    if (agendaDebounceTimer) clearTimeout(agendaDebounceTimer);
    agendaDebounceTimer = setTimeout(() => {
      preferences.aiConfig.agenda = aiAgenda.value.trim();
      savePrefs();
    }, 500);
  });

  aiApiKey.addEventListener('change', () => {
    const key = aiApiKey.value.trim();
    preferences.aiConfig.apiKey = key;
    preferences.aiConfig.dailyLimit = key ? AI_PAID_DAILY_LIMIT : AI_FREE_DAILY_LIMIT;
    savePrefs();
    updateAiBudget();
  });
}

async function updateStatsDisplay(): Promise<void> {
  const stats = (await chrome.runtime.sendMessage({
    type: 'GET_STATS',
  })) as SessionStats;

  statsScanned.textContent = `${stats.scanned} scanned`;
  statsRelevant.textContent = `${stats.relevant} relevant`;
  statsFiltered.textContent = `${stats.filtered} filtered`;
}

async function updateAiBudget(): Promise<void> {
  try {
    const budget = (await chrome.runtime.sendMessage({
      type: 'GET_AI_BUDGET',
    })) as { requestsUsedToday: number; dailyLimit: number };

    const { requestsUsedToday, dailyLimit } = budget;
    aiBudgetText.textContent = `${requestsUsedToday}/${dailyLimit} requests used today`;
    const pct = dailyLimit > 0 ? (requestsUsedToday / dailyLimit) * 100 : 0;
    aiBudgetFill.style.width = `${Math.min(pct, 100)}%`;
  } catch {
    // Service worker not ready
  }
}

function savePrefs(): void {
  chrome.runtime.sendMessage({
    type: 'SAVE_PREFERENCES',
    payload: preferences,
  });
}

init();
