// Fetches and normalizes the public Zhihu hot list. Shared by the hourly snapshot
// script (scripts/fetch.mjs) and the live endpoint (index.mjs in this directory).
const ENDPOINT = 'https://api.zhihu.com/topstory/hot-list?limit=50&reverse_order=0';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function normalize(entry, index) {
  const t = entry.target ?? {};
  // Question ids exceed Number.MAX_SAFE_INTEGER, so read them from string fields
  // rather than the numeric target.id that JSON.parse has already rounded.
  const id =
    (t.url ?? '').match(/(\d+)\/?$/)?.[1] ?? (entry.card_id ?? '').match(/(\d+)$/)?.[1] ?? '';
  return {
    rank: index + 1,
    id,
    type: t.type ?? 'question',
    title: (t.title ?? '').trim(),
    excerpt: (t.excerpt ?? '').trim(),
    heat: (entry.detail_text ?? '').replace(/\s+/g, ''),
    answers: t.answer_count ?? 0,
    followers: t.follower_count ?? 0,
    created: t.created ?? null,
    isNew: Boolean(entry.debut),
    image: entry.children?.find((c) => c.thumbnail)?.thumbnail ?? '',
  };
}

export async function fetchHot({ attempts = 3, timeoutMs = 20000 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(ENDPOINT, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body.data) || body.data.length === 0) throw new Error('empty hot list');
      const items = body.data.map(normalize).filter((x) => x.id && x.title);
      if (items.length === 0) throw new Error('no usable items after normalizing');
      return { updatedAt: new Date().toISOString(), items };
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastError;
}
