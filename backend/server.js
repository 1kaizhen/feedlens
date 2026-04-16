/**
 * FeedLens backend — CANONICAL AI scoring path.
 *
 * The Chrome extension routes ALL AI scoring requests through this server
 * (see src/background/ai-scoring.ts). There is no in-extension fallback to
 * OpenRouter. Keep this server running on port 3001 whenever the extension
 * is in use with AI mode enabled.
 */
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 3001;

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ELEPHANT_MODEL_ID = 'openrouter/elephant-alpha';
const ENFORCED_MODEL_ID = 'openrouter/elephant-alpha';
const DAILY_SCORE_LIMIT = 100;

let scoreLimitDate = new Date().toISOString().slice(0, 10);
let scoreRequestsToday = 0;

if (ELEPHANT_MODEL_ID !== ENFORCED_MODEL_ID) {
  throw new Error(
    `[FeedLens] Invalid model configuration. Only "${ENFORCED_MODEL_ID}" is allowed.`
  );
}

app.use(cors());
app.use(express.json());

/**
 * POST /score
 * Body: { tweets: TweetPayload[], agenda: string, apiKey: string }
 * Response: { results: { id: string, score: number, reason: string }[] }
 *
 * score is 0–10. The extension normalizes to 0–1 internally.
 */
app.post('/score', async (req, res) => {
  const { tweets, agenda, apiKey } = req.body;
  rotateDailyCounterIfNeeded();

  if (scoreRequestsToday >= DAILY_SCORE_LIMIT) {
    return res.status(429).json({
      error: `Daily /score limit reached (${DAILY_SCORE_LIMIT}). Limit resets at UTC midnight.`,
    });
  }

  if (!Array.isArray(tweets) || tweets.length === 0) {
    return res.status(400).json({ error: 'tweets array is required' });
  }
  if (!agenda?.trim()) {
    return res.status(400).json({ error: 'agenda is required' });
  }
  if (!apiKey?.trim()) {
    return res.status(400).json({ error: 'apiKey is required' });
  }

  try {
    scoreRequestsToday += 1;
    const results = await scoreTweets(tweets, agenda.trim(), apiKey.trim());
    res.json({ results });
  } catch (err) {
    console.error('[FeedLens] Scoring error:', err.message);
    if (err.message.includes('not a valid model ID')) {
      return res.status(500).json({
        error: `OpenRouter rejected model "${ELEPHANT_MODEL_ID}". Check model availability and try again.`,
      });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) =>
  res.json({
    ok: true,
    model: ELEPHANT_MODEL_ID,
    scoreRequestsToday,
    dailyScoreLimit: DAILY_SCORE_LIMIT,
  })
);

function rotateDailyCounterIfNeeded() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== scoreLimitDate) {
    scoreLimitDate = today;
    scoreRequestsToday = 0;
  }
}

async function scoreTweets(tweets, agenda, apiKey) {
  const tweetList = tweets
    .map((t, i) => {
      const lines = [`${i + 1}. [id: ${t.tweetId}] "${t.text}"`];
      if (t.postedAt) lines.push(`   Posted: ${t.postedAt}`);
      if (t.likes != null) lines.push(`   Likes: ${t.likes}`);
      if (t.views != null) lines.push(`   Views: ${t.views}`);
      return lines.join('\n');
    })
    .join('\n\n');

  if (process.env.DEBUG_LLM) {
    console.log('\n──────── /score → OpenRouter request ────────');
    console.log(`agenda: "${agenda}"`);
    console.log(`tweets (${tweets.length}):`);
    console.log(tweetList);
    console.log('─────────────────────────────────────────────\n');
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://feedlens.extension',
      'X-OpenRouter-Title': 'FeedLens',
    },
    body: JSON.stringify({
      model: ELEPHANT_MODEL_ID,
      messages: [
        {
          role: 'system',
          content:
            'You score tweets for relevance to a user\'s agenda on a scale of 0–10. ' +
            'Scoring factors (in order of importance): ' +
            '1. Text relevance to the agenda (most important). ' +
            '2. Recency — more recent posts score higher when content quality is equal. ' +
            '3. Engagement — higher likes/views can signal quality but should not override relevance. ' +
            'Return a JSON array with one object per tweet: ' +
            '[{"id": "<tweetId>", "score": <0-10>, "reason": "<brief reason>"}]. ' +
            'Return ONLY the JSON array, no other text.',
        },
        {
          role: 'user',
          content: `My agenda: "${agenda}"\n\nScore these tweets:\n\n${tweetList}`,
        },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${body}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content ?? '';

  if (process.env.DEBUG_LLM) {
    console.log('\n──────── OpenRouter raw response ────────');
    console.log('full envelope:', JSON.stringify(data, null, 2));
    console.log('\nassistant content (what the model said):');
    console.log(content);
    console.log('─────────────────────────────────────────\n');
  }

  return parseResults(content, tweets);
}

function parseResults(content, tweets) {
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.warn('[FeedLens] Could not extract JSON from LLM response:', content);
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const validIds = new Set(tweets.map((t) => t.tweetId));

    return parsed
      .filter(
        (r) =>
          r.id &&
          validIds.has(r.id) &&
          typeof r.score === 'number' &&
          r.score >= 0 &&
          r.score <= 10
      )
      .map((r) => ({
        id: r.id,
        score: Math.round(r.score * 10) / 10,
        reason: r.reason ?? '',
      }));
  } catch (err) {
    console.warn('[FeedLens] Failed to parse LLM response:', content);
    return [];
  }
}

app.listen(PORT, () => {
  console.log(`FeedLens backend (canonical AI path) running on http://localhost:${PORT}`);
  console.log(`[FeedLens] model: ${ELEPHANT_MODEL_ID}`);
  console.log(
    `[FeedLens] /score daily limit: ${DAILY_SCORE_LIMIT} requests (UTC midnight reset)`
  );
});
