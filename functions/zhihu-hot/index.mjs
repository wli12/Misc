// HTTP endpoint (Google Cloud Run functions) that returns the current Zhihu hot list,
// so the page can show live data instead of the scheduled snapshot.
import { fetchHot } from './hot.mjs';

const TTL_MS = 60_000; // serve one upstream fetch to everyone for a minute
let cache = null;
let pending = null;

async function current() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  pending ??= fetchHot({ attempts: 2, timeoutMs: 8000 })
    .then((data) => { cache = { at: Date.now(), data }; return data; })
    .finally(() => { pending = null; });
  return pending;
}

export async function hot(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.set('Access-Control-Allow-Methods', 'GET'); res.status(204).send(''); return; }
  if (req.method !== 'GET') { res.status(405).send('GET only'); return; }
  try {
    const data = await current();
    res.set('Cache-Control', 'public, max-age=60');
    res.json(data);
  } catch (err) {
    // Stale data beats none; the page falls back to its snapshot on a 502.
    if (cache) { res.json(cache.data); return; }
    res.status(502).json({ error: String(err?.message ?? err) });
  }
}
