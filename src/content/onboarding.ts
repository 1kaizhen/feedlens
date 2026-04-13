import { savePreferences, getPreferences } from '../shared/storage';

let dimmedCount = 0;
let tooltipShown = false;

export function trackDimmedTweet(afterElement: Element): void {
  dimmedCount++;
  if (dimmedCount >= 3 && !tooltipShown) {
    showOnboardingTooltip(afterElement);
  }
}

async function showOnboardingTooltip(afterElement: Element): Promise<void> {
  const prefs = await getPreferences();
  if (!prefs.showOnboardingTooltip) return;

  tooltipShown = true;

  const tooltip = document.createElement('div');
  tooltip.className = 'feedlens-tooltip';

  const text = document.createElement('span');
  text.textContent = 'Want to hide these instead? Switch to Focus Mode \u2192';
  tooltip.appendChild(text);

  const switchBtn = document.createElement('button');
  switchBtn.textContent = 'Switch';
  switchBtn.addEventListener('click', async () => {
    const current = await getPreferences();
    current.filterMode = 'hide';
    current.showOnboardingTooltip = false;
    await savePreferences(current);
    tooltip.remove();
  });
  tooltip.appendChild(switchBtn);

  const dismiss = document.createElement('button');
  dismiss.className = 'feedlens-tooltip-dismiss';
  dismiss.textContent = '\u00d7';
  dismiss.addEventListener('click', async () => {
    const current = await getPreferences();
    current.showOnboardingTooltip = false;
    await savePreferences(current);
    tooltip.remove();
  });
  tooltip.appendChild(dismiss);

  afterElement.parentNode?.insertBefore(tooltip, afterElement.nextSibling);
}

export function resetDimmedCount(): void {
  dimmedCount = 0;
}
