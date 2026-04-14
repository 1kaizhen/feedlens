# Scoring Engine v2 — Reduced False Positives

## Problem

The original scoring engine had three issues causing irrelevant tweets to appear in filtered feeds:

1. **Substring matching** — Keywords longer than 3 characters used `String.includes()`, so `"react"` matched inside `"overreacted"` and `"angular"` matched inside `"triangular"`.
2. **No corroboration** — A single primary keyword like `"React"` immediately scored 1.0 (relevant), even in unrelated contexts like `"How did you react to that game?"`.
3. **Single context term too generous** — Generic words like `"model"` or `"animation"` alone scored 0.3 (uncertain), polluting the feed.

## Changes

### 1. Word-boundary matching for all keywords

**Before:** Only keywords with 3 or fewer characters used `\b` word-boundary regex. Longer keywords used `String.includes()`.

**After:** All keywords use `\b` word-boundary regex regardless of length. The existing `escapeRegex()` function handles special characters in keywords like `claude.ai` and `Next.js`.

```
"overreacted"  → does NOT match "react"  (was a match before)
"triangular"   → does NOT match "angular" (was a match before)
"revenue"      → does NOT match "vue"     (was a match before)
"i love react" → still matches "react"
```

### 2. Corroboration-based scoring

**Before:** A single primary keyword = 1.0. Context terms were only checked when no primary keyword matched.

**After:** Context terms are always checked. A primary keyword alone is no longer enough for "relevant" — it needs at least one context term to corroborate it.

| Match | New Score | Old Score | Classification |
|-------|-----------|-----------|----------------|
| Primary keyword + 1 or more context terms | **1.0** | 1.0 | Relevant |
| Primary keyword alone | **0.6** | 1.0 | Uncertain |
| 3+ context terms (no primary) | **0.5** | N/A | Uncertain |
| 2 context terms | **0.3** | 0.5 | Uncertain |
| 1 context term | **0.1** | 0.3 | Filtered |
| No matches | **0.0** | 0.0 | Filtered |

Score thresholds are unchanged: relevant >= 0.7, uncertain >= 0.3.

### Practical effect

- A tweet saying `"React is great for building UIs with hooks and SSR"` scores **1.0** — `"React"` (primary) is corroborated by `"hooks"` and `"SSR"` (context terms).
- A tweet saying `"How did you react to that game?"` scores **0.0** — `"react"` no longer substring-matches, and no context terms are present.
- A tweet mentioning only `"animation"` without any other signals scores **0.1** — filtered out instead of cluttering the uncertain band.

## Files modified

- `src/background/scoring-engine.ts` — `matchesKeyword()` and `scoreTweet()`
- `tests/scoring-engine.test.ts` — Updated 8 existing tests, added 10 new tests

## Verification

```bash
npm run test       # 60 tests pass
npx tsc --noEmit   # No type errors
npm run build      # Production build succeeds
```
