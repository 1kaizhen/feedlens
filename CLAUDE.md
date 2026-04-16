# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm run build        # TypeScript check + Vite production build → dist/
npm run dev          # Vite dev server with HMR
npm run test         # Run all tests once (vitest)
npm run test:watch   # Run tests in watch mode
npx vitest run tests/scoring-engine.test.ts  # Run a single test file
npx tsc --noEmit     # Type-check only (no emit)
```

Load the built extension: Chrome → `chrome://extensions` → Developer mode → Load unpacked → select `dist/`.

Vitest is configured inline in `vite.config.ts` (globals: true, jsdom environment) — there is no separate vitest config. No eslint/prettier config files exist yet — only the packages are installed.

## Architecture

FeedLens is a Chrome Extension (Manifest V3) that filters Twitter/X feeds by topic relevance using keyword matching with an optional AI layer. Three isolated runtime contexts communicate via `chrome.runtime.sendMessage`:

```
┌─────────────┐   SCORE_TWEET      ┌──────────────────┐
│   Content    │──────────────────→ │  Service Worker   │
│   Script     │←────────────────── │  (background)     │
│ (twitter.com)│   ScoreResponse    │                   │
│              │                    │  scoring-engine   │
│ tweet-parser │   GET/SAVE_PREFS   │  topic-keywords   │
│ dom-modifier │──────────────────→ │  LRU cache        │
│ feedback     │   SUBMIT_FEEDBACK  │  ai-scoring       │
│ onboarding   │   GET_STATS        │  keyword weights  │
│ sidebar/     │←── AI_SCORE_UPDATE │  author rep.      │
└─────────────┘                    └──────────────────┘
                                          ↕
┌─────────────┐   GET/SAVE_PREFS   chrome.storage.local
│   Popup UI  │──────────────────→  (preferences, stats,
│ (popup.html)│   GET_STATS          feedback, weights)
└─────────────┘
```

**Content Script** (`src/content/`) — Runs on twitter.com/x.com. MutationObserver detects `article[data-testid="tweet"]` elements, extracts tweet data, sends to service worker for scoring, applies CSS classes (dim/hide/relevant) based on score.

**Sidebar** (`src/content/sidebar/`) — Fixed right panel (380px) showing scored tweets. Uses a pub/sub store pattern (`sidebar-store.ts`) holding up to 500 entries (FIFO, deduplicated by tweetId). The store is in-memory only (cleared on page refresh). `sidebar-tweet-card.ts` renders each tweet with a color-coded score badge. Clicking a card scrolls to the tweet in the main feed. Visibility is toggled via `UserPreferences.sidebarVisible` and persisted to storage.

**Service Worker** (`src/background/`) — Message hub. Scores tweets using keyword matching against selected topics. Uses an in-memory LRU cache (2000 entries, lost on SW sleep — acceptable). Tracks session stats. Also manages the AI scoring engine and feedback-driven learning.

**Popup** (`src/popup/`) — Settings UI. Topic chip selection, dim/hide mode toggle, power switch, stats display. All changes written to `chrome.storage.local`; content scripts react via `chrome.storage.onChanged`.

**Shared** (`src/shared/`) — Types, constants (score thresholds: relevant ≥ 0.7, uncertain ≥ 0.3), and storage wrapper.

## Scoring Logic (v2)

`scoreTweet(text, selectedTopicIds)` in `src/background/scoring-engine.ts`. See `docs/scoring-engine-v2.md` for full rationale.

All keywords use `\b` word-boundary regex (prevents "react" matching "overreacted"). Scoring uses corroboration — a primary keyword alone is no longer enough for "relevant":

| Match | Score | Classification |
|-------|-------|----------------|
| Primary keyword + 1+ context terms | 1.0 | Relevant |
| Primary keyword alone | 0.6 | Uncertain |
| 3+ context terms (no primary) | 0.5 | Uncertain |
| 2 context terms | 0.3 | Uncertain |
| 1 context term | 0.1 | Filtered |
| No matches | 0.0 | Filtered |

Final score = MAX across all selected topics.

**Per-topic keyword filtering:** `UserPreferences.selectedKeywords` is a `Record<string, string[]>`. If a topic has no entry, ALL its keywords are active. If it has an entry, only those specific keywords/context terms are used.

## AI Scoring Layer

`src/background/ai-scoring.ts` — `AiScoringEngine` runs alongside keyword scoring. When `UserPreferences.aiConfig.enabled` is true and an API key is set, tweets are batched (up to 10) and sent to OpenRouter (`openrouter/elephant-alpha` model) for LLM-based scoring. The AI result arrives asynchronously via `AI_SCORE_UPDATE` message back to the content script's tab. Rate limited to 1 request per 3 seconds; daily budget capped at 50 (free) or 1000 (paid) requests, reset via a `chrome.alarms` hourly wakeup.

## Feedback-Driven Learning

When users submit feedback (`SUBMIT_FEEDBACK`), the service worker:
1. Stores the entry in `chrome.storage.local` (capped at 500 FIFO)
2. Updates `AuthorReputation` for the tweet's author (capped at 0.15 score bonus/penalty)
3. Recomputes `KeywordWeights` from all feedback — weight range `[0.3, 1.5]`, requires ≥ 3 feedback entries per keyword before weighting kicks in
4. Invalidates the LRU score cache so re-scoring picks up new weights

Weights are keyed as `"topicId::keyword"` in `KeywordWeights` (a `Record<string, KeywordWeight>`).

## Backend (optional AI proxy)

`backend/` is a standalone Express server (port 3001, separate `package.json`). It proxies AI scoring requests to OpenRouter, pinned to `openrouter/elephant-alpha`. Start with `cd backend && npm install && npm start`. Has its own daily request limit (100, UTC reset). The extension can also call OpenRouter directly via `ai-scoring.ts` — the backend is an alternative path, not required for basic operation.

## Manifest & Build

`manifest.json` is processed by `@crxjs/vite-plugin` — it references `.ts` source files directly (the plugin handles compilation). Permissions: `activeTab`, `storage`, `alarms`. Host permissions: `twitter.com`, `x.com`, `openrouter.ai`.

## Key Implementation Details

- All content CSS uses `!important` to override Twitter's styles
- Tweet parser handles quoted tweets by concatenating text
- Media-only tweets (no text) score 0.5 (uncertain), never hidden
- Feedback entries capped at 500 (FIFO), stats reset daily
- `MessageType` in `src/shared/types.ts` is the discriminated union for all message passing — add new message types there
- Content script queues tweets in batches of 10 via `Promise.all`
- `window.dispatchEvent(new CustomEvent('feedlens:reprocess'))` triggers full re-scan (used by "Resume filtering" button)
- Sidebar uses CSS class `feedlens-sidebar-active` on `<body>` to shift the main feed layout
- `UserPreferences.blockedKeywords` — global blocklist; any match forces score to 0
- `UserPreferences.customKeywords` — per-topic user-defined primary keywords and context terms, merged with built-in `topic-keywords.ts` at scoring time

## Testing

Tests use vitest with jsdom environment. Chrome APIs are mocked manually — each test file sets up its own mocks (no shared setup file). The `tests/` directory mirrors the source structure.

Chrome storage mock pattern used across tests:
```typescript
const store: Record<string, unknown> = {};
globalThis.chrome = {
  storage: { local: {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items) => Object.assign(store, items)),
  }},
} as unknown as typeof chrome;
```
