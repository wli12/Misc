// Builds site/movies/data/movies.json: Douban Top 250 + IMDb Top 250, merged so a
// film on both lists is one record (one mark covers both lists).
//
// Douban list: weekly public snapshot from github.com/freez-5/douban-top250-tracker.
// IMDb list:   scripts/movies/imdb-top250.json (snapshot with hand-added Chinese titles).
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const DOUBAN_URL =
  'https://raw.githubusercontent.com/freez-5/douban-top250-tracker/master/data/douban/current.json';
const OUT = new URL('../site/movies/data/movies.json', import.meta.url);
const IMDB = new URL('./movies/imdb-top250.json', import.meta.url);

const norm = (s) => (s || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

const res = await fetch(DOUBAN_URL, { signal: AbortSignal.timeout(30000) });
if (!res.ok) throw new Error(`Douban snapshot: HTTP ${res.status}`);
const douban = await res.json();
if (!Array.isArray(douban.movies) || douban.movies.length < 200) {
  throw new Error('Douban snapshot looks incomplete');
}
const imdb = JSON.parse(await readFile(IMDB, 'utf8'));

const films = douban.movies.map((m) => {
  const did = (m.douban_url.match(/subject\/(\d+)/) || [])[1];
  return {
    id: 'd' + did,
    zh: m.title,
    orig: m.original_title || '',
    year: parseInt(m.year, 10) || null,
    region: m.region || '',
    genre: m.genre || '',
    dir: (m.director || '').split(/\s{2,}|主演/)[0].trim(),
    db: { rank: m.rank, score: m.rating, id: did },
  };
});

const byTitle = new Map();
for (const f of films) byTitle.set(norm(f.zh), f);

for (const e of imdb) {
  const im = { rank: e.rank, score: e.score, ...(e.tt ? { tt: e.tt } : {}) };
  const key = e.tt || 'i-' + norm(e.title);
  const hit = byTitle.get(norm(e.zh));
  if (hit && hit.year && Math.abs(hit.year - e.year) <= 1) {
    hit.imdb = im;
    hit.alt = key; // marks made before the film joined the Douban list still resolve
    if (!hit.orig) hit.orig = e.title;
  } else {
    films.push({ id: key, zh: e.zh, orig: e.title, year: e.year, imdb: im });
  }
}

await mkdir(new URL('.', OUT), { recursive: true });
const body = films.map((f) => JSON.stringify(f)).join(',\n');
await writeFile(
  OUT,
  `{"doubanAsOf":${JSON.stringify(douban.timestamp.slice(0, 10))},"imdbAsOf":"2026-06-02","films":[\n${body}\n]}\n`,
);
const both = films.filter((f) => f.db && f.imdb).length;
console.log(`${films.length} films (${both} on both lists) → ${OUT.pathname}`);
