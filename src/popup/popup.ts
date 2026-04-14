import type { UserPreferences, SessionStats } from '../shared/types';
import { TOPIC_CATEGORIES } from '../background/topic-keywords';
import { AI_FREE_DAILY_LIMIT, AI_PAID_DAILY_LIMIT } from '../shared/constants';

const chipContainer = document.getElementById('topic-chips')!;
const powerToggle = document.getElementById('power-toggle') as HTMLInputElement;
const onboardingMsg = document.getElementById('onboarding-message')!;
const statsScanned = document.getElementById('stats-scanned')!;
const statsRelevant = document.getElementById('stats-relevant')!;
const statsFiltered = document.getElementById('stats-filtered')!;
const popup = document.querySelector('.popup')!;
const keywordsSection = document.getElementById('keywords-section')!;
const keywordChipsContainer = document.getElementById('keyword-chips')!;
const keywordsToggleAll = document.getElementById('keywords-toggle-all')!;
const sidebarToggle = document.getElementById('sidebar-toggle')!;
const blockedChipsContainer = document.getElementById('blocked-chips')!;
const blockedInput = document.getElementById('blocked-input') as HTMLInputElement;
const blockedAddBtn = document.getElementById('blocked-add-btn')!;
const customKeywordsSection = document.getElementById('custom-keywords-section')!;
const customKeywordChips = document.getElementById('custom-keyword-chips')!;
const customKeywordInput = document.getElementById('custom-keyword-input') as HTMLInputElement;
const customKeywordType = document.getElementById('custom-keyword-type') as HTMLSelectElement;
const customKeywordTopic = document.getElementById('custom-keyword-topic') as HTMLSelectElement;
const customKeywordAddBtn = document.getElementById('custom-keyword-add-btn')!;
const aiToggle = document.getElementById('ai-toggle') as HTMLInputElement;
const aiAgenda = document.getElementById('ai-agenda') as HTMLTextAreaElement;
const aiApiKey = document.getElementById('ai-api-key') as HTMLInputElement;
const aiBudgetText = document.getElementById('ai-budget-text')!;
const aiBudgetFill = document.getElementById('ai-budget-fill')!;

let preferences: UserPreferences;
let agendaDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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

  renderChips();
  renderKeywords();
  renderBlockedKeywords();
  renderCustomKeywords();
  renderPower();
  renderSidebarToggle();
  renderAiSection();
  await updateStatsDisplay();
  await updateAiBudget();

  keywordsToggleAll.addEventListener('click', toggleAllKeywords);
  blockedAddBtn.addEventListener('click', addBlockedKeyword);
  blockedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBlockedKeyword();
  });
  customKeywordAddBtn.addEventListener('click', addCustomKeyword);
  customKeywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCustomKeyword();
  });
}

function renderChips(): void {
  chipContainer.innerHTML = '';
  for (const topic of TOPIC_CATEGORIES) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    if (preferences.selectedTopicIds.includes(topic.id)) {
      chip.classList.add('selected');
    }

    const icon = document.createElement('span');
    icon.className = 'chip-icon';
    icon.textContent = topic.icon;
    chip.appendChild(icon);

    const label = document.createTextNode(topic.displayLabel);
    chip.appendChild(label);

    chip.addEventListener('click', () => toggleTopic(topic.id, chip));
    chipContainer.appendChild(chip);
  }

  updateOnboardingMessage();
}

function toggleTopic(topicId: string, chip: Element): void {
  const idx = preferences.selectedTopicIds.indexOf(topicId);
  if (idx >= 0) {
    preferences.selectedTopicIds.splice(idx, 1);
    chip.classList.remove('selected');
    // Remove keyword selections for this topic
    delete preferences.selectedKeywords[topicId];
  } else {
    preferences.selectedTopicIds.push(topicId);
    chip.classList.add('selected');
    // Select ALL keywords for the newly added topic by default
    const topic = TOPIC_CATEGORIES.find((t) => t.id === topicId);
    if (topic) {
      preferences.selectedKeywords[topicId] = [
        ...topic.keywords,
        ...topic.contextTerms,
      ];
    }
  }

  updateOnboardingMessage();
  renderKeywords();
  renderCustomKeywords();
  savePrefs();
}

function renderKeywords(): void {
  keywordChipsContainer.innerHTML = '';

  const activeTopics = TOPIC_CATEGORIES.filter((t) =>
    preferences.selectedTopicIds.includes(t.id)
  );

  if (activeTopics.length === 0) {
    keywordsSection.style.display = 'none';
    return;
  }

  keywordsSection.style.display = 'block';

  for (const topic of activeTopics) {
    // Ensure this topic has a selectedKeywords entry
    if (!preferences.selectedKeywords[topic.id]) {
      preferences.selectedKeywords[topic.id] = [
        ...topic.keywords,
        ...topic.contextTerms,
      ];
    }

    const selected = preferences.selectedKeywords[topic.id];

    // Group label
    const groupLabel = document.createElement('div');
    groupLabel.className = 'keyword-group-label';
    groupLabel.textContent = `${topic.icon} ${topic.displayLabel}`;
    keywordChipsContainer.appendChild(groupLabel);

    // Primary keywords
    for (const kw of topic.keywords) {
      const chip = createKeywordChip(kw, selected.includes(kw), false);
      chip.addEventListener('click', () =>
        toggleKeyword(topic.id, kw, chip)
      );
      keywordChipsContainer.appendChild(chip);
    }

    // Context terms
    for (const ct of topic.contextTerms) {
      const chip = createKeywordChip(ct, selected.includes(ct), true);
      chip.addEventListener('click', () =>
        toggleKeyword(topic.id, ct, chip)
      );
      keywordChipsContainer.appendChild(chip);
    }
  }

  updateToggleAllLabel();
}

function createKeywordChip(
  text: string,
  isSelected: boolean,
  isContext: boolean
): HTMLButtonElement {
  const chip = document.createElement('button');
  chip.className = 'keyword-chip';
  if (isSelected) chip.classList.add('selected');
  if (isContext) chip.classList.add('context');
  chip.textContent = text;
  return chip;
}

function toggleKeyword(
  topicId: string,
  keyword: string,
  chip: Element
): void {
  const selected = preferences.selectedKeywords[topicId];
  if (!selected) return;

  const idx = selected.indexOf(keyword);
  if (idx >= 0) {
    selected.splice(idx, 1);
    chip.classList.remove('selected');
  } else {
    selected.push(keyword);
    chip.classList.add('selected');
  }

  updateToggleAllLabel();
  savePrefs();
}

function toggleAllKeywords(): void {
  const allSelected = areAllKeywordsSelected();

  for (const topicId of preferences.selectedTopicIds) {
    const topic = TOPIC_CATEGORIES.find((t) => t.id === topicId);
    if (!topic) continue;

    if (allSelected) {
      // Deselect all
      preferences.selectedKeywords[topicId] = [];
    } else {
      // Select all
      preferences.selectedKeywords[topicId] = [
        ...topic.keywords,
        ...topic.contextTerms,
      ];
    }
  }

  renderKeywords();
  savePrefs();
}

function areAllKeywordsSelected(): boolean {
  for (const topicId of preferences.selectedTopicIds) {
    const topic = TOPIC_CATEGORIES.find((t) => t.id === topicId);
    if (!topic) continue;
    const selected = preferences.selectedKeywords[topicId] ?? [];
    const total = topic.keywords.length + topic.contextTerms.length;
    if (selected.length < total) return false;
  }
  return true;
}

function updateToggleAllLabel(): void {
  keywordsToggleAll.textContent = areAllKeywordsSelected()
    ? 'Deselect all'
    : 'Select all';
}

function updateOnboardingMessage(): void {
  if (preferences.selectedTopicIds.length === 0) {
    onboardingMsg.style.display = 'block';
  } else {
    onboardingMsg.style.display = 'none';
  }
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

async function updateStatsDisplay(): Promise<void> {
  const stats = (await chrome.runtime.sendMessage({
    type: 'GET_STATS',
  })) as SessionStats;

  statsScanned.textContent = `${stats.scanned} scanned`;
  statsRelevant.textContent = `${stats.relevant} relevant`;
  statsFiltered.textContent = `${stats.filtered} filtered`;
}

function renderSidebarToggle(): void {
  sidebarToggle.classList.toggle('active', preferences.sidebarVisible);

  sidebarToggle.addEventListener('click', () => {
    preferences.sidebarVisible = !preferences.sidebarVisible;
    sidebarToggle.classList.toggle('active', preferences.sidebarVisible);
    savePrefs();
  });
}

// --- Blocked keywords ---

function renderBlockedKeywords(): void {
  blockedChipsContainer.innerHTML = '';
  for (const word of preferences.blockedKeywords) {
    const chip = document.createElement('button');
    chip.className = 'keyword-chip blocked';

    const text = document.createTextNode(word);
    chip.appendChild(text);

    const removeBtn = document.createElement('span');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '\u00D7';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeBlockedKeyword(word);
    });
    chip.appendChild(removeBtn);

    blockedChipsContainer.appendChild(chip);
  }
}

function addBlockedKeyword(): void {
  const word = blockedInput.value.trim();
  if (!word) return;
  if (preferences.blockedKeywords.includes(word)) {
    blockedInput.value = '';
    return;
  }
  preferences.blockedKeywords.push(word);
  blockedInput.value = '';
  renderBlockedKeywords();
  savePrefs();
}

function removeBlockedKeyword(word: string): void {
  const idx = preferences.blockedKeywords.indexOf(word);
  if (idx >= 0) {
    preferences.blockedKeywords.splice(idx, 1);
    renderBlockedKeywords();
    savePrefs();
  }
}

// --- Custom keywords ---

function renderCustomKeywords(): void {
  const activeTopics = TOPIC_CATEGORIES.filter((t) =>
    preferences.selectedTopicIds.includes(t.id)
  );

  if (activeTopics.length === 0) {
    customKeywordsSection.style.display = 'none';
    return;
  }

  customKeywordsSection.style.display = 'block';
  customKeywordChips.innerHTML = '';

  // Populate topic selector
  customKeywordTopic.innerHTML = '';
  for (const topic of activeTopics) {
    const option = document.createElement('option');
    option.value = topic.id;
    option.textContent = topic.displayLabel;
    customKeywordTopic.appendChild(option);
  }

  // Render existing custom keywords
  for (const topic of activeTopics) {
    const custom = preferences.customKeywords[topic.id];
    if (!custom) continue;

    const allCustom = [
      ...custom.keywords.map((kw) => ({ text: kw, type: 'primary' as const })),
      ...custom.contextTerms.map((ct) => ({ text: ct, type: 'context' as const })),
    ];

    if (allCustom.length === 0) continue;

    const groupLabel = document.createElement('div');
    groupLabel.className = 'keyword-group-label';
    groupLabel.textContent = `${topic.icon} ${topic.displayLabel}`;
    customKeywordChips.appendChild(groupLabel);

    for (const item of allCustom) {
      const chip = document.createElement('button');
      chip.className = 'keyword-chip custom selected';
      if (item.type === 'context') chip.classList.add('context');

      const text = document.createTextNode(item.text);
      chip.appendChild(text);

      const removeBtn = document.createElement('span');
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '\u00D7';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeCustomKeyword(topic.id, item.text, item.type);
      });
      chip.appendChild(removeBtn);

      customKeywordChips.appendChild(chip);
    }
  }
}

function addCustomKeyword(): void {
  const keyword = customKeywordInput.value.trim();
  if (!keyword) return;

  const topicId = customKeywordTopic.value;
  const type = customKeywordType.value as 'primary' | 'context';

  if (!topicId) return;

  if (!preferences.customKeywords[topicId]) {
    preferences.customKeywords[topicId] = { keywords: [], contextTerms: [] };
  }

  const custom = preferences.customKeywords[topicId];
  const list = type === 'primary' ? custom.keywords : custom.contextTerms;

  if (list.includes(keyword)) {
    customKeywordInput.value = '';
    return;
  }

  list.push(keyword);
  customKeywordInput.value = '';
  renderCustomKeywords();
  savePrefs();
}

function removeCustomKeyword(
  topicId: string,
  keyword: string,
  type: 'primary' | 'context'
): void {
  const custom = preferences.customKeywords[topicId];
  if (!custom) return;

  const list = type === 'primary' ? custom.keywords : custom.contextTerms;
  const idx = list.indexOf(keyword);
  if (idx >= 0) {
    list.splice(idx, 1);
    renderCustomKeywords();
    savePrefs();
  }
}

// --- AI section ---

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
