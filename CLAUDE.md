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

No eslint/prettier config files exist yet — only the packages are installed.

## Architecture

FeedLens is a Chrome Extension (Manifest V3) that filters Twitter/X feeds by topic relevance using keyword matching. Three isolated runtime contexts communicate via `chrome.runtime.sendMessage`:

```
┌─────────────┐   SCORE_TWEET      ┌──────────────────┐
│   Content    │──────────────────→ │  Service Worker   │
│   Script     │←────────────────── │  (background)     │
│ (twitter.com)│   ScoreResponse    │                   │
│              │                    │  scoring-engine   │
│ tweet-parser │   GET/SAVE_PREFS   │  topic-keywords   │
│ dom-modifier │──────────────────→ │  LRU cache        │
│ feedback     │   SUBMIT_FEEDBACK  │                   │
│ onboarding   │   GET_STATS        │                   │
└─────────────┘                    └──────────────────┘
                                          ↕
┌─────────────┐   GET/SAVE_PREFS   chrome.storage.local
│   Popup UI  │──────────────────→  (preferences, stats,
│ (popup.html)│   GET_STATS          feedback)
└─────────────┘
```

**Content Script** (`src/content/`) — Runs on twitter.com/x.com. MutationObserver detects `article[data-testid="tweet"]` elements, extracts tweet data, sends to service worker for scoring, applies CSS classes (dim/hide/relevant) based on score.

**Service Worker** (`src/background/`) — Message hub. Scores tweets using keyword matching against selected topics. Uses an in-memory LRU cache (2000 entries, lost on SW sleep — acceptable). Tracks session stats.

**Popup** (`src/popup/`) — Settings UI. Topic chip selection, dim/hide mode toggle, power switch, stats display. All changes written to `chrome.storage.local`; content scripts react via `chrome.storage.onChanged`.

**Shared** (`src/shared/`) — Types, constants (score thresholds: relevant ≥ 0.7, uncertain ≥ 0.3), and storage wrapper.

## Scoring Logic

`scoreTweet(text, selectedTopicIds)` in `src/background/scoring-engine.ts`:
- Primary keyword match → score 1.0
- 2+ context term matches → 0.5
- 1 context term match → 0.3
- Final score = MAX across all selected topics

Short keywords (≤3 chars like "AI") use word-boundary regex (`\bAI\b`) to avoid false positives. Longer keywords use `includes()`.

## Key Implementation Details

- All content CSS uses `!important` to override Twitter's styles
- Tweet parser handles quoted tweets by concatenating text
- Media-only tweets (no text) score 0.5 (uncertain), never hidden
- Feedback entries capped at 500 (FIFO), stats reset daily
- `MessageType` in `src/shared/types.ts` is the discriminated union for all message passing — add new message types there
- Content script queues tweets in batches of 10 via `Promise.all`
- `window.dispatchEvent(new CustomEvent('feedlens:reprocess'))` triggers full re-scan (used by "Resume filtering" button)

## Testing

Tests use vitest with jsdom environment. Chrome APIs are mocked manually (see `tests/storage.test.ts` for the `chrome.storage.local` mock pattern). The `tests/` directory mirrors the source structure.
