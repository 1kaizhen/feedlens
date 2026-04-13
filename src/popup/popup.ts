import type { UserPreferences, SessionStats } from '../shared/types';
import { TOPIC_CATEGORIES } from '../background/topic-keywords';

const chipContainer = document.getElementById('topic-chips')!;
const powerToggle = document.getElementById('power-toggle') as HTMLInputElement;
const onboardingMsg = document.getElementById('onboarding-message')!;
const modeBtns = document.querySelectorAll('.mode-btn');
const statsScanned = document.getElementById('stats-scanned')!;
const statsRelevant = document.getElementById('stats-relevant')!;
const statsFiltered = document.getElementById('stats-filtered')!;
const popup = document.querySelector('.popup')!;
const keywordsSection = document.getElementById('keywords-section')!;
const keywordChipsContainer = document.getElementById('keyword-chips')!;
const keywordsToggleAll = document.getElementById('keywords-toggle-all')!;

let preferences: UserPreferences;

async function init(): Promise<void> {
  preferences = (await chrome.runtime.sendMessage({
    type: 'GET_PREFERENCES',
  })) as UserPreferences;

  // Ensure selectedKeywords exists (backward compat with old stored prefs)
  if (!preferences.selectedKeywords) {
    preferences.selectedKeywords = {};
  }

  renderChips();
  renderKeywords();
  renderMode();
  renderPower();
  await updateStatsDisplay();

  keywordsToggleAll.addEventListener('click', toggleAllKeywords);
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

function renderMode(): void {
  modeBtns.forEach((btn) => {
    btn.classList.toggle(
      'active',
      (btn as HTMLElement).dataset.mode === preferences.filterMode
    );
  });

  modeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.mode as 'dim' | 'hide';
      preferences.filterMode = mode;
      modeBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      savePrefs();
    });
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

async function updateStatsDisplay(): Promise<void> {
  const stats = (await chrome.runtime.sendMessage({
    type: 'GET_STATS',
  })) as SessionStats;

  statsScanned.textContent = `${stats.scanned} scanned`;
  statsRelevant.textContent = `${stats.relevant} relevant`;
  statsFiltered.textContent = `${stats.filtered} filtered`;
}

function savePrefs(): void {
  chrome.runtime.sendMessage({
    type: 'SAVE_PREFERENCES',
    payload: preferences,
  });
}

init();
