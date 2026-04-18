import type { UserPreferences } from '../shared/types';
import { AI_FREE_DAILY_LIMIT, AI_PAID_DAILY_LIMIT } from '../shared/constants';

const aiAgenda = document.getElementById('ai-agenda') as HTMLTextAreaElement;
const aiApiKey = document.getElementById('ai-api-key') as HTMLInputElement;
const runPluginBtn = document.getElementById('run-plugin-btn') as HTMLButtonElement;
const runPluginStatus = document.getElementById('run-plugin-status')!;
const toggleEnabled = document.getElementById('toggle-enabled') as HTMLInputElement;
const toggleSidebar = document.getElementById('toggle-sidebar') as HTMLInputElement;
const toggleAutoScroll = document.getElementById('toggle-autoscroll') as HTMLInputElement;

let preferences: UserPreferences;

async function init(): Promise<void> {
  preferences = (await chrome.runtime.sendMessage({
    type: 'GET_PREFERENCES',
  })) as UserPreferences;

  // Ensure fields exist (backward compat with old stored prefs)
  if (!preferences.selectedKeywords) {
    preferences.selectedKeywords = {};
  }
  if (preferences.sidebarVisible === undefined) {
    preferences.sidebarVisible = false;
  }
  if (!preferences.blockedKeywords) {
    preferences.blockedKeywords = [];
  }
  if (!preferences.customKeywords) {
    preferences.customKeywords = {};
  }
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

  aiAgenda.value = preferences.aiConfig.agenda;
  aiApiKey.value = preferences.aiConfig.apiKey;

  // Initialize toggle states
  toggleEnabled.checked = preferences.enabled;
  toggleSidebar.checked = preferences.sidebarVisible;
  toggleAutoScroll.checked = preferences.autoScrollEnabled ?? false;

  // Live toggle — save immediately so content script reacts right away.
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

  runPluginBtn.addEventListener('click', () => {
    const agenda = aiAgenda.value.trim();
    const apiKey = aiApiKey.value.trim();

    if (!agenda) {
      runPluginStatus.textContent = 'Add what to search first.';
      return;
    }
    if (!apiKey) {
      runPluginStatus.textContent = 'Add your OpenRouter API key first.';
      return;
    }

    preferences.enabled = true;
    preferences.sidebarVisible = true;
    preferences.aiConfig.enabled = true;
    preferences.aiConfig.agenda = agenda;
    preferences.aiConfig.apiKey = apiKey;
    preferences.aiConfig.dailyLimit = AI_PAID_DAILY_LIMIT;

    // Reflect state in the toggles too
    toggleEnabled.checked = true;
    toggleSidebar.checked = true;

    savePrefs();
    runPluginStatus.textContent = 'Saved. Plugin is running with AI.';
  });
}

function savePrefs(): void {
  chrome.runtime.sendMessage({
    type: 'SAVE_PREFERENCES',
    payload: preferences,
  });
}

init();
