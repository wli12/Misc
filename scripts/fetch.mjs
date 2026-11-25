#!/usr/bin/env node
// Fetches every source and writes site/data/hot.json.
// A source that fails keeps the items it had in the last published data; the run
// only exits non-zero when nothing at all could be fetched.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../site/data/hot.json');
const PREVIOUS_URL = 'http://news.hackerfun.org/data/hot.json';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function get(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, ...init.headers },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}
const getJson = async (url, init) => (await get(url, init)).json();
const getText = async (url, init) => (await get(url, init)).text();

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const iso = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const wan = (n) => (n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')} 万` : String(n));

// Minimal RSS reader: enough for well-formed feeds with <item> blocks.
function rssItems(xml) {
  const decode = (s) =>
    clean(
      String(s ?? '')
        .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'),
    );
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, body]) => {
    const tag = (name) => decode(body.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);
    return {
      title: tag('title'), link: tag('link'), date: tag('pubDate'), description: tag('description'),
      creator: tag('dc:creator'), author: tag('author'),
    };
  });
}

const SOURCES = [
  {
    id: 'zhihu', name: '知乎', sub: '热榜', home: 'https://www.zhihu.com/hot',
    async fetch() {
      const body = await getJson('https://api.zhihu.com/topstory/hot-list?limit=50&reverse_order=0', {
        headers: { Accept: 'application/json' },
      });
      return body.data.map((entry) => {
        const t = entry.target ?? {};
        // Question ids exceed Number.MAX_SAFE_INTEGER, so read them from string fields
        // rather than the numeric target.id that JSON.parse has already rounded.
        const id = (t.url ?? '').match(/(\d+)\/?$/)?.[1] ?? (entry.card_id ?? '').match(/(\d+)$/)?.[1];
        return {
          title: clean(t.title),
          url: id && `https://www.zhihu.com/question/${id}`,
          excerpt: clean(t.excerpt),
          meta: [clean(entry.detail_text).replace(/\s+/g, ''), `${wan(t.answer_count ?? 0)} 回答`],
          isNew: Boolean(entry.debut),
          image: entry.children?.find((c) => c.thumbnail)?.thumbnail ?? '',
        };
      });
    },
  },
  {
    id: 'zhihu-daily', name: '知乎日报', sub: '今日', home: 'https://daily.zhihu.com/',
    async fetch() {
      const body = await getJson('https://daily.zhihu.com/api/4/news/latest');
      return body.stories.map((s) => ({ title: clean(s.title), url: s.url, meta: [clean(s.hint)] }));
    },
  },
  {
    id: 'hackernews', name: 'Hacker News', sub: '首页', home: 'https://news.ycombinator.com/',
    async fetch() {
      const body = await getJson('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30');
      return body.hits.map((h) => ({
        title: clean(h.title), url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        meta: [`${h.points} 分`, `${h.num_comments} 评论`], time: iso(h.created_at),
      }));
    },
  },
  {
    id: 'v2ex', name: 'V2EX', sub: '最热', home: 'https://www.v2ex.com/?tab=hot',
    async fetch() {
      const list = await getJson('https://www.v2ex.com/api/topics/hot.json');
      return list.map((t) => ({
        title: clean(t.title), url: t.url, excerpt: clean(t.content).slice(0, 300),
        meta: [clean(t.node?.title), `${t.replies} 回复`],
      }));
    },
  },
  {
    id: 'wallstreetcn', name: '华尔街见闻', sub: '日排行', home: 'https://wallstreetcn.com/',
    async fetch() {
      const body = await getJson('https://api-one-wscn.awtmt.com/apiv1/content/articles/hot?period=all');
      return body.data.day_items.map((a) => ({
        title: clean(a.title), url: a.uri,
        meta: [a.pageviews ? `${wan(a.pageviews)} 阅读` : ''], time: iso(a.display_time * 1000),
      }));
    },
  },
  {
    id: 'huxiu', name: '虎嗅', sub: '最新文章', home: 'https://www.huxiu.com/',
    async fetch() {
      return rssItems(await getText('https://rss.huxiu.com/')).map((i) => ({
        title: i.title, url: i.link.replace(/\?f=rss$/, ''), excerpt: i.description.slice(0, 200),
        meta: [i.author], time: iso(i.date),
      }));
    },
  },
  {
    id: 'sspai', name: '少数派', sub: '热门文章', home: 'https://sspai.com/',
    async fetch() {
      const body = await getJson(`https://sspai.com/api/v1/article/tag/page/get?limit=20&offset=0&tag=${encodeURIComponent('热门文章')}`);
      return body.data.map((a) => ({
        title: clean(a.title), url: `https://sspai.com/post/${a.id}`, excerpt: clean(a.summary),
        meta: [clean(a.author?.nickname)], time: iso(a.released_time * 1000),
      }));
    },
  },
  {
    id: 'guokr', name: '果壳', sub: '科学人', home: 'https://www.guokr.com/scientific/',
    async fetch() {
      const list = await getJson('https://www.guokr.com/beta/proxy/science_api/articles?retrieve_type=by_category&page=1');
      return list.map((a) => ({
        title: clean(a.title), url: `https://www.guokr.com/article/${a.id}/`, excerpt: clean(a.summary),
        meta: [clean(a.author?.nickname)], time: iso(a.date_published),
      }));
    },
  },
  {
    id: 'jiqizhixin', name: '机器之心', sub: '文章库', home: 'https://www.jiqizhixin.com/articles',
    async fetch() {
      const body = await getJson('https://www.jiqizhixin.com/api/article_library/articles.json?sort=time&page=1&per=20');
      return body.articles.map((a) => ({
        title: clean(a.title), url: `https://www.jiqizhixin.com/articles/${a.slug}`, excerpt: clean(a.content).slice(0, 300),
        meta: [clean(a.author)], time: iso(`${String(a.publishedAt).replace(/\//g, '-').replace(' ', 'T')}:00+08:00`),
      }));
    },
  },
  {
    id: 'semianalysis', name: 'SemiAnalysis', sub: '中文标题', home: 'https://newsletter.semianalysis.com/',
    async fetch() {
      // Titles are translated by hand in translations/semianalysis.json; a post that
      // is not in that file yet is shown in English.
      const zh = JSON.parse(await readFile(resolve(HERE, 'translations/semianalysis.json'), 'utf8'));
      return rssItems(await getText('https://newsletter.semianalysis.com/feed')).map((i) => {
        const [title, excerpt] = zh[i.title] ?? [];
        return {
          title: title ?? i.title, url: i.link, excerpt: excerpt ?? i.description,
          original: title ? i.title : undefined, meta: [i.creator], time: iso(i.date),
        };
      });
    },
  },
];

async function previous() {
  try { return await getJson(PREVIOUS_URL); } catch {}
  try { return JSON.parse(await readFile(OUT, 'utf8')); } catch {}
  return null;
}

const before = await previous();
const now = new Date().toISOString();
const sources = await Promise.all(SOURCES.map(async ({ fetch: run, ...info }) => {
  try {
    const items = (await run())
      .filter((x) => x.title && x.url)
      .map((x) => ({ ...x, meta: (x.meta ?? []).filter(Boolean) }));
    if (items.length === 0) throw new Error('no items');
    console.log(`${info.id}: ${items.length} items`);
    return { ...info, updatedAt: now, items };
  } catch (err) {
    const old = before?.sources?.find((s) => s.id === info.id);
    console.log(`${info.id}: FAILED (${err.message})${old ? ', keeping the previous items' : ''}`);
    return { ...info, updatedAt: old?.updatedAt ?? null, items: old?.items ?? [] };
  }
}));

if (!sources.some((s) => s.updatedAt === now)) throw new Error('every source failed');
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ updatedAt: now, sources }, null, 1) + '\n');
console.log(`wrote ${sources.reduce((n, s) => n + s.items.length, 0)} items to ${OUT}`);
