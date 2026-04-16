import type { AiConfig } from '../shared/types';
import {
  AI_BATCH_SIZE,
  AI_BATCH_FLUSH_MS,
  AI_RATE_LIMIT_MS,
  BACKEND_SCORE_URL,
} from '../shared/constants';

export interface AiQueueItem {
  tweetId: string;
  text: string;
  tabId: number;
}

interface AiResult {
  id: string;
  score: number;
  reason: string;
}

export class AiScoringEngine {
  private queue: AiQueueItem[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRequestTime = 0;
  private processing = false;

  constructor(
    private getConfig: () => Promise<AiConfig>,
    private updateBudget: (used: number) => Promise<void>
  ) {}

  enqueue(item: AiQueueItem): void {
    // Skip tweets with no meaningful text
    if (!item.text.trim()) return;

    // Deduplicate within queue
    if (this.queue.some((q) => q.tweetId === item.tweetId)) return;

    this.queue.push(item);

    if (this.queue.length >= AI_BATCH_SIZE) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, AI_BATCH_FLUSH_MS);
  }

  private async flush(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const config = await this.getConfig();
    if (!config.enabled || !config.agenda.trim() || !config.apiKey) {
      this.processing = false;
      return;
    }

    // Check budget
    if (config.requestsUsedToday >= config.dailyLimit) {
      this.queue = [];
      this.processing = false;
      return;
    }

    // Take up to AI_BATCH_SIZE items
    const batch = this.queue.splice(0, AI_BATCH_SIZE);

    // Rate limit: wait if needed
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < AI_RATE_LIMIT_MS) {
      await new Promise((r) => setTimeout(r, AI_RATE_LIMIT_MS - elapsed));
    }

    try {
      console.log(`[FeedLens AI] flushing batch of ${batch.length} to backend`);
      const results = await this.callBackend(batch, config.agenda, config.apiKey);
      console.log(`[FeedLens AI] backend returned ${results.length} scored tweets`, results);
      this.lastRequestTime = Date.now();
      await this.updateBudget(config.requestsUsedToday + 1);

      // Send results back to content scripts
      for (const result of results) {
        const item = batch.find((b) => b.tweetId === result.id);
        if (!item) continue;

        chrome.tabs.sendMessage(item.tabId, {
          type: 'AI_SCORE_UPDATE',
          payload: {
            tweetId: result.id,
            aiScore: result.score,
            aiReasoning: result.reason,
          },
        }).catch((err) => {
          console.warn(`[FeedLens AI] failed to deliver score to tab ${item.tabId}:`, err);
        });
      }
    } catch (err) {
      console.warn('[FeedLens AI] API call failed:', err);
      // Re-queue failed items at the front so they get another chance
      this.queue.unshift(...batch);
    }

    this.processing = false;

    // Continue flushing if more items remain
    if (this.queue.length > 0) {
      this.scheduleFlush();
    }
  }

  /**
   * Canonical AI scoring path: POST to FeedLens backend (see backend/server.js).
   * Backend returns scores on a 0-10 scale. That is the universal scale used
   * throughout the extension — no normalization.
   */
  private async callBackend(
    batch: AiQueueItem[],
    agenda: string,
    apiKey: string
  ): Promise<AiResult[]> {
    const tweets = batch.map((item) => ({
      tweetId: item.tweetId,
      text: item.text,
    }));

    const response = await fetch(BACKEND_SCORE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tweets, agenda, apiKey }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `FeedLens backend error: ${response.status} ${response.statusText} ${body}`
      );
    }

    const data = (await response.json()) as {
      results?: Array<{ id?: string; score?: number; reason?: string }>;
    };
    const validIds = new Set(batch.map((b) => b.tweetId));

    const validated = (data.results ?? [])
      .map((r) => {
        const rawScore = typeof r.score === 'number' ? r.score : NaN;
        if (!Number.isFinite(rawScore) || rawScore < 0 || rawScore > 10) return null;
        if (!r.id || !validIds.has(r.id)) return null;

        return {
          id: r.id,
          // Keep backend's 0-10 scale. Round to 1 decimal for clean display.
          score: Math.round(rawScore * 10) / 10,
          reason: r.reason ?? '',
        };
      })
      .filter((r): r is AiResult => r !== null);

    const deduped = new Map<string, AiResult>();
    for (const item of validated) {
      deduped.set(item.id, item);
    }
    return Array.from(deduped.values());
  }
}
