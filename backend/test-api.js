/**
 * FeedLens backend — end-to-end test script.
 *
 * Simulates exactly what the Chrome extension does: POSTs a batch of tweets
 * to /score and prints the full round-trip so you can inspect:
 *
 *   1. The request the extension would send to the backend
 *   2. The parsed scores the backend returns
 *   3. The RAW response OpenRouter sent (if backend was started with DEBUG_LLM=1)
 *
 * ─── Usage ─────────────────────────────────────────────────────────────────
 *
 *   # Start the backend WITH debug logging so you also see the raw LLM reply:
 *     DEBUG_LLM=1 npm start                  (Git Bash / Linux / macOS)
 *     $env:DEBUG_LLM=1; npm start            (PowerShell)
 *     set DEBUG_LLM=1 && npm start           (Windows cmd)
 *
 *   # Then, in another terminal, run this script:
 *     OPENROUTER_API_KEY=sk-or-v1-... node test-api.js
 *     # or pass the key as an arg:
 *     node test-api.js sk-or-v1-...
 *
 *   # Optional: override the agenda
 *     node test-api.js sk-or-v1-... "vintage cars and motorsport"
 */

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001';
const API_KEY = process.argv[2] ?? process.env.OPENROUTER_API_KEY;
const AGENDA =
  process.argv[3] ?? process.env.AGENDA ?? 'AI agents, LLMs, and developer tools';

if (!API_KEY) {
  console.error(
    'Missing OpenRouter key.\n' +
      '  Pass as arg:  node test-api.js sk-or-v1-...\n' +
      '  Or env var:   OPENROUTER_API_KEY=sk-or-v1-... node test-api.js'
  );
  process.exit(1);
}

const sampleTweets = [
  {
    tweetId: '1001',
    text:
      'Just shipped Claude Code 4.6 with new skills, hooks, and MCP support. Dev workflow is finally clicking.',
    postedAt: '2026-04-16T08:30:00Z',
    likes: 1842,
    views: 54200,
  },
  {
    tweetId: '1002',
    text: 'My cat knocked over my coffee for the third time this morning. Send help.',
    postedAt: '2026-04-16T09:15:00Z',
    likes: 12,
    views: 340,
  },
  {
    tweetId: '1003',
    text:
      'New paper: scaling laws for agent frameworks show sub-linear cost growth past 100B params.',
    postedAt: '2026-04-15T22:00:00Z',
    likes: 567,
    views: 18900,
  },
  {
    tweetId: '1004',
    text: 'The sunset in Lisbon tonight is unreal. Pasteis de nata for dinner again.',
    postedAt: '2026-04-15T19:45:00Z',
    likes: 89,
    views: 2100,
  },
  {
    tweetId: '1005',
    text:
      'OpenRouter just dropped a new free tier model that beats GPT-4 on coding benchmarks. Game changer.',
    postedAt: '2026-04-16T07:00:00Z',
    likes: 3201,
    views: 98000,
  },
];

function divider(label) {
  console.log('\n' + '═'.repeat(70));
  if (label) console.log(`  ${label}`);
  console.log('═'.repeat(70));
}

async function main() {
  // ── 1. Health check ────────────────────────────────────────────────────
  divider('STEP 1  GET /health');
  try {
    const healthRes = await fetch(`${BACKEND_URL}/health`);
    const health = await healthRes.json();
    console.log(`Status: ${healthRes.status}`);
    console.log('Body:', JSON.stringify(health, null, 2));
    if (!health.ok) {
      console.error('Backend reports unhealthy — aborting.');
      process.exit(1);
    }
  } catch (err) {
    console.error(`Cannot reach backend at ${BACKEND_URL}. Is it running?`);
    console.error(`   Start it with: cd backend && npm start`);
    console.error(`   Error: ${err.message}`);
    process.exit(1);
  }

  // ── 2. Show the payload the extension would send ───────────────────────
  divider('STEP 2  What the extension sends to POST /score');
  const payload = { agenda: AGENDA, apiKey: API_KEY, tweets: sampleTweets };
  console.log(`URL:    ${BACKEND_URL}/score`);
  console.log(`Method: POST`);
  console.log(`Body:   (apiKey redacted below)`);
  console.log(
    JSON.stringify(
      { ...payload, apiKey: `${API_KEY.slice(0, 10)}...${API_KEY.slice(-4)}` },
      null,
      2
    )
  );

  // ── 3. Fire the actual POST ────────────────────────────────────────────
  divider('STEP 3  POST /score');
  const t0 = Date.now();
  const scoreRes = await fetch(`${BACKEND_URL}/score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const elapsed = Date.now() - t0;
  const body = await scoreRes.json();

  console.log(`Status:   ${scoreRes.status} ${scoreRes.statusText}`);
  console.log(`Latency:  ${elapsed} ms`);
  console.log('Response body:');
  console.log(JSON.stringify(body, null, 2));

  if (!scoreRes.ok) {
    console.error('\nRequest failed. See error above.');
    process.exit(1);
  }

  // ── 4. Human-readable summary ──────────────────────────────────────────
  divider('STEP 4  Score summary (0–10 scale)');
  const byId = new Map(body.results.map((r) => [r.id, r]));
  for (const tweet of sampleTweets) {
    const r = byId.get(tweet.tweetId);
    const score = r ? r.score.toFixed(1).padStart(4) : ' n/a';
    const verdict = r ? (r.score >= 5 ? '✓ sidebar' : '✗ filtered') : '';
    const preview = tweet.text.length > 60 ? tweet.text.slice(0, 57) + '...' : tweet.text;
    console.log(`[${score}] ${verdict.padEnd(11)} ${tweet.tweetId}  "${preview}"`);
    if (r?.reason) console.log(`              reason: ${r.reason}`);
  }

  divider('DONE');
  console.log('If you started the backend with DEBUG_LLM=1, check its terminal');
  console.log('window to see the raw OpenRouter response logged between');
  console.log('"OpenRouter raw response" markers.\n');
}

main().catch((err) => {
  console.error('\nUnexpected error:', err);
  process.exit(1);
});
