# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
npm run build        # TypeScript check + Vite production build → dist/
npm run dev          # Vite dev server with HMR
npm run test         # Run all tests once (vitest)
npm run test:watch   # Run tests in watch mode
npx vitest run tests/storage.test.ts  # Run a single test file
npx tsc --noEmit     # Type-check only (no emit)
```

Load the built extension: Chrome → `chrome://extensions` → Developer mode → Load unpacked → select `dist/`.

Vitest is configured inline in `vite.config.ts` (globals: true, jsdom environment) — there is no separate vitest config. No eslint/prettier config files exist yet — only the packages are installed.

## Architecture

FeedLens is a Chrome Extension (Manifest V3) that filters Twitter/X feeds by topic relevance using AI scoring. Three isolated runtime contexts communicate via `chrome.runtime.sendMessage`:

```
┌─────────────┐   SCORE_TWEET      ┌──────────────────┐
│   Content    │──────────────────→ │  Service Worker   │
│   Script     │←────────────────── │  (background)     │
│ (twitter.com)│  stub ScoreResponse│                   │
│              │                    │  ai-scoring       │
│ tweet-parser │   GET/SAVE_PREFS   │  LRU cache        │
│ dom-modifier │──────────────────→ │  author rep.      │
│ feedback     │   SUBMIT_FEEDBACK  │                   │
│ onboarding   │   GET_STATS        │                   │
│ sidebar/     │←── AI_SCORE_UPDATE │                   │
└─────────────┘                    └──────────────────┘
                                          ↕
┌─────────────┐   GET/SAVE_PREFS   chrome.storage.local
│   Popup UI  │──────────────────→  (preferences, stats,
│ (popup.html)│   GET_STATS          feedback, sessions,
└─────────────┘                      sidebar entries)
```

**Content Script** (`src/content/`) — Runs on twitter.com/x.com. MutationObserver detects `article[data-testid="tweet"]` elements, extracts tweet data, sends to service worker for scoring, applies CSS classes (dim/hide/relevant) based on score. Also initialises the `AutoScroller` singleton and starts/stops it based on `UserPreferences.autoScrollEnabled`.

**Auto-Scroll** (`src/content/auto-scroll.ts`) — `AutoScroller` class (exported as singleton `autoScroller`) that drives automatic feed scrolling. Scrolls 50–100px every 200–500ms in an 8-second active window, then pauses for 2 seconds, then repeats. Pauses automatically on any user interaction (mousemove, click, wheel, keydown, touch) and resumes 2–4s after the last event. Also pauses when the tab is hidden. Exposes `start()`, `stop()`, `toggleUserPause()`, `incrementCollected()`, and a `subscribe()` pub/sub for status updates. Enabled via `UserPreferences.autoScrollEnabled` toggle in the popup.

**Sidebar** (`src/content/sidebar/`) — Fixed right panel (380px) showing scored tweets. Uses a pub/sub store pattern (`sidebar-store.ts`) holding up to 500 entries (FIFO, deduplicated by tweetId). Entries are **persisted** to `chrome.storage.local` with a 2-second debounce — they survive page refreshes. When a session is active, entries are stored under `sidebarEntries_<sessionId>` instead of the default `sidebarEntries` key. `sidebar-tweet-card.ts` renders each tweet with a color-coded score badge. Clicking a card scrolls to the tweet in the main feed. Visibility is toggled via `UserPreferences.sidebarVisible` and persisted to storage. The header contains a **score range filter** — a histogram (10 bars for buckets 0–1, 1–2, …, 9–10) above a dual-handle range slider (0–10, step 1) with editable Min/Max number inputs. Filtering is applied in-memory on every render; the count badge switches to "X / Y" format when a range is active. When auto-scroll is running, a status bar shows "Auto-collecting · N scored" with a pulsing dot and a Pause/Resume button. A **Summarize** button in the controls row switches to a summary view (see below).

**Service Worker** (`src/background/`) — Message hub. Immediately returns a stub score of 5 for all `SCORE_TWEET` requests (actual scores arrive asynchronously via `AI_SCORE_UPDATE`). Uses an in-memory LRU cache (2000 entries, lost on SW sleep — acceptable). Tracks session stats. Also manages the AI scoring engine, feedback-driven learning, and tweet summarization (`SUMMARIZE_TWEETS` message).

**Popup** (`src/popup/`) — Settings UI. Three toggles: Extension on/off, Sidebar on/off, Auto-scroll on/off. Agenda text and OpenRouter API key inputs. "Run Plugin" button enables everything at once. All changes written to `chrome.storage.local`; content scripts react via `chrome.storage.onChanged`.

**Shared** (`src/shared/`) — Types, constants (score thresholds on 0–10 scale: relevant ≥ 7, uncertain ≥ 3), and storage wrapper.

## Scoring

All scoring is AI-only via `AiScoringEngine` in `src/background/ai-scoring.ts`. There is no local keyword scoring engine. Scores use a **universal 0–10 scale** (1 decimal place).

- `SCORE_TWEET` returns a stub score of 5 immediately, so the UI can render without blocking
- The real score arrives later as `AI_SCORE_UPDATE { tweetId, aiScore, aiReasoning }` sent back to the tab
- Tweets are batched (up to 10) and sent to OpenRouter (`openrouter/elephant-alpha`)
- Rate limited to 1 request per 3 seconds; daily budget: 50 (free) or 1000 (paid) requests
- Media-only tweets (no text) skip AI and keep the stub score of 5

## Sessions

Sessions allow categorized collections of scored tweets, persisted across page refreshes.

- `Session` type: `{ id, name, agenda, createdAt, tweetCount }`
- Stored in `chrome.storage.local` under `sessions` key (capped at 50 FIFO via `MAX_SESSIONS`)
- Active session tracked via `activeSessionId` key in storage
- When a session is active, sidebar entries are stored under `sidebarEntries_<sessionId>` and tweet counts are kept in sync via `updateSessionTweetCount()`
- `switchSession(newSessionId)` in `sidebar-store.ts` flushes pending writes, clears in-memory state, and loads the new session's entries

## Tweet Summarization

Clicking **Summarize** in the sidebar controls switches to a summary view in place of the tweet list. The button label toggles to "List" to return.

Flow:
1. Sidebar takes the top 30 scored tweets (by score desc) from the store
2. Sends `SUMMARIZE_TWEETS` to the service worker with `{ tweets: [{tweetId, text, authorHandle}] }`
3. Service worker calls OpenRouter (`openrouter/elephant-alpha`) directly with a numbered tweet list and the user's `aiConfig.agenda` as context
4. AI returns prose with `[N]` inline citations; service worker returns `{ summary }` or `{ error }`
5. Sidebar parses `[N]` tokens → blue superscript badges; hovering shows a tooltip card with `@handle`, tweet excerpt, and "Open tweet →" link
6. A **Sources** list at the bottom shows only the cited tweets with links

No summary data is persisted — regenerated fresh on each click. Requires AI to be enabled and configured in the popup.

## Feedback-Driven Learning

When users submit feedback (`SUBMIT_FEEDBACK`), the service worker:
1. Stores the entry in `chrome.storage.local` (capped at 500 FIFO)
2. Updates `AuthorReputation` for the tweet's author (capped at 0.15 score bonus/penalty)
3. Invalidates the LRU score cache

`KeywordWeights` types still exist in storage but keyword scoring itself has been removed. Author reputation remains a useful feedback signal.

## Backend (optional AI proxy)

`backend/` is a standalone Express server (port 3001, separate `package.json`). It proxies AI scoring requests to OpenRouter, pinned to `openrouter/elephant-alpha`. Start with `cd backend && npm install && npm start`. Has its own daily request limit (100, UTC reset). The extension calls OpenRouter directly via `ai-scoring.ts` — the backend is an alternative path, not required.

## Manifest & Build

`manifest.json` is processed by `@crxjs/vite-plugin` — it references `.ts` source files directly (the plugin handles compilation). Permissions: `activeTab`, `storage`, `alarms`. Host permissions: `twitter.com`, `x.com`, `openrouter.ai`.

## Key Implementation Details

- All content CSS uses `!important` to override Twitter's styles
- Tweet parser handles quoted tweets by concatenating text
- `MessageType` in `src/shared/types.ts` is the discriminated union for all message passing — add new message types there
- Content script queues tweets in batches of 10 via `Promise.all`
- `window.dispatchEvent(new CustomEvent('feedlens:reprocess'))` triggers full re-scan (used by "Resume filtering" button)
- Sidebar uses CSS class `feedlens-sidebar-active` on `<body>` to shift the main feed layout
- `UserPreferences.blockedKeywords` — global blocklist; any match forces score to 0
- `UserPreferences.autoScrollEnabled` — persisted boolean; content script starts/stops `autoScroller` singleton on change
- Auto-scroll does NOT listen to `scroll` events (would self-trigger); uses `wheel` + pointer events only
- Auto-scroll cycle: 8s active → 2s break → repeat; cycle clock resets after any interaction-pause or manual resume
- `autoScroller.incrementCollected()` is called in `handleAiScoreUpdate` so the sidebar count reflects AI-scored tweets
- Sidebar score range filter (`scoreMin`/`scoreMax`, default 0–10) lives as module-level state in `sidebar.ts`; it filters the already-sorted entries list on every `render()` call and drives histogram bar heights and active-color highlights. The dual-handle slider is two overlapping `<input type="range">` elements with transparent tracks; z-index swaps dynamically to keep the correct thumb grabbable when they are close together.
- Summary view (`summaryMode` flag in `sidebar.ts`) hides `listEl` and appends `summaryViewEl` to the container. `render()` early-returns when `summaryMode` is true to avoid clobbering the summary.

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
