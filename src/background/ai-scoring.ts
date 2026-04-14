import type { AiConfig } from '../shared/types';
import {
  AI_BATCH_SIZE,
  AI_BATCH_FLUSH_MS,
  AI_RATE_LIMIT_MS,
  OPENROUTER_API_URL,
  ELEPHANT_MODEL_ID,
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
      const results = await this.callOpenRouter(batch, config.agenda, config.apiKey);
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
        }).catch(() => {
          // Tab may have closed
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

  private async callOpenRouter(
    batch: AiQueueItem[],
    agenda: string,
    apiKey: string
  ): Promise<AiResult[]> {
    const tweetList = batch
      .map((item, i) => `${i + 1}. [id: ${item.tweetId}] "${item.text}"`)
      .join('\n');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://feedlens.extension',
      'X-OpenRouter-Title': 'FeedLens',
    };

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: ELEPHANT_MODEL_ID,
        messages: [
          {
            role: 'system',
            content:
              'You evaluate tweets for relevance to a user\'s interests. ' +
              'Return a JSON array with one object per tweet: {"id": "...", "score": 0.0-1.0, "reason": "..."}. ' +
              'Score meaning: 1.0 = highly relevant, 0.7+ = relevant, 0.3-0.7 = maybe relevant, <0.3 = not relevant. ' +
              'Return ONLY the JSON array, no other text.',
          },
          {
            role: 'user',
            content: `My agenda: "${agenda}"\n\nEvaluate these tweets:\n${tweetList}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content: string = data.choices?.[0]?.message?.content ?? '';

    return this.parseResults(content, batch);
  }

  private parseResults(content: string, batch: AiQueueItem[]): AiResult[] {
    // Extract JSON array from response (handle markdown code blocks)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        id?: string;
        score?: number;
        reason?: string;
      }>;

      const validIds = new Set(batch.map((b) => b.tweetId));

      return parsed
        .filter(
          (r) =>
            r.id &&
            validIds.has(r.id) &&
            typeof r.score === 'number' &&
            r.score >= 0 &&
            r.score <= 1
        )
        .map((r) => ({
          id: r.id!,
          score: Math.round(r.score! * 100) / 100,
          reason: r.reason ?? '',
        }));
    } catch {
      console.warn('[FeedLens AI] Failed to parse LLM response:', content);
      return [];
    }
  }
}
