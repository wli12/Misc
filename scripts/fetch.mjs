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

// Minimal feed reader: RSS <item> blocks and Atom <entry> blocks of well-formed feeds.
function feedItems(xml) {
  const decode = (s) =>
    clean(
      String(s ?? '')
        .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
        .replace(/&amp;(#?\w+;)/g, '&$1')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'),
    );
  return [...xml.matchAll(/<(item|entry)>([\s\S]*?)<\/\1>/g)].map(([, , body]) => {
    const tag = (name) => decode(body.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);
    return {
      title: tag('title'),
      link: tag('link') || body.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1] || body.match(/<link[^>]*href="([^"]+)"/)?.[1] || '',
      date: tag('pubDate') || tag('published') || tag('updated'),
      description: tag('description') || tag('summary'),
      creator: tag('dc:creator'), author: tag('author'),
    };
  });
}

// An English-language feed. Titles are given their Chinese translation later; see translate().
const englishFeed = (id, name, sub, home, feed, { tier = 1, skip } = {}) => ({
  id, name, sub, home, tier, english: true,
  async fetch() {
    return feedItems(await getText(feed)).filter((i) => !skip?.test(i.title)).slice(0, 10).map((i) => ({
      title: i.title, url: i.link, excerpt: i.description.slice(0, 240), time: iso(i.date),
    }));
  },
});

// tier is the depth rating shown as a filter on the page: 1 深度 (★★★), 2 有料 (★★), 3 消遣 (★).
const SOURCES = [
  {
    id: 'zhihu', tier: 3, name: '知乎', sub: '热榜', home: 'https://www.zhihu.com/hot',
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
    id: 'zhihu-daily', tier: 2, name: '知乎日报', sub: '今日', home: 'https://daily.zhihu.com/',
    async fetch() {
      const body = await getJson('https://daily.zhihu.com/api/4/news/latest');
      return body.stories.map((s) => ({ title: clean(s.title), url: s.url, meta: [clean(s.hint)] }));
    },
  },
  {
    id: 'hackernews', tier: 2, name: 'Hacker News', sub: '首页', home: 'https://news.ycombinator.com/',
    async fetch() {
      const body = await getJson('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30');
      return body.hits.map((h) => ({
        title: clean(h.title), url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
        meta: [`${h.points} 分`, `${h.num_comments} 评论`], time: iso(h.created_at),
      }));
    },
  },
  {
    id: 'v2ex', tier: 2, name: 'V2EX', sub: '分享创造', home: 'https://www.v2ex.com/go/create',
    async fetch() {
      // The node's newest topics; the site-wide hot list was mostly small talk.
      const list = await getJson('https://www.v2ex.com/api/topics/show.json?node_name=create');
      return list.map((t) => ({
        title: clean(t.title), url: t.url, excerpt: clean(t.content).slice(0, 300),
        meta: [`${t.replies} 回复`], time: iso(t.created * 1000),
      }));
    },
  },
  {
    id: 'latepost', tier: 1, name: '晚点', sub: 'LatePost', home: 'https://www.latepost.com/',
    async fetch() {
      const body = await getJson('https://www.latepost.com/news/get-news-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'page=1&limit=10&programa=',
      });
      return body.data.map((a) => ({
        title: clean(a.title), url: `https://www.latepost.com${a.detail_url ?? `/news/dj_detail?id=${a.id}`}`, excerpt: clean(a.abstract),
        meta: [clean(a.release_time)],
      }));
    },
  },
  {
    id: 'zhangxiaojun', tier: 1, name: '张小珺', sub: '商业访谈录（播客）', home: 'https://www.xiaoyuzhoufm.com/podcast/626b46ea9cbbf0451cf5a962',
    async fetch() {
      // The podcast page embeds its episode list as JSON.
      const html = await getText('https://www.xiaoyuzhoufm.com/podcast/626b46ea9cbbf0451cf5a962');
      const page = JSON.parse(html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)[1]);
      return page.props.pageProps.podcast.episodes.map((e) => ({
        title: clean(e.title), url: `https://www.xiaoyuzhoufm.com/episode/${e.eid}`, excerpt: clean(e.description).slice(0, 240),
        meta: [`${Math.round(e.duration / 60)} 分钟`], time: iso(e.pubDate),
      }));
    },
  },
  {
    id: 'ruanyifeng', tier: 2, name: '阮一峰', sub: '科技爱好者周刊', home: 'https://www.ruanyifeng.com/blog/weekly/',
    async fetch() {
      return feedItems(await getText('https://www.ruanyifeng.com/blog/atom.xml')).map((i) => ({
        title: i.title, url: i.link.replace(/^http:/, 'https:'), excerpt: i.description.slice(0, 240), time: iso(i.date),
      }));
    },
  },
  {
    id: 'guokr', tier: 2, name: '果壳', sub: '科学人', home: 'https://www.guokr.com/scientific/',
    async fetch() {
      const list = await getJson('https://www.guokr.com/beta/proxy/science_api/articles?retrieve_type=by_category&page=1');
      return list.map((a) => ({
        title: clean(a.title), url: `https://www.guokr.com/article/${a.id}/`, excerpt: clean(a.summary),
        meta: [clean(a.author?.nickname)], time: iso(a.date_published),
      }));
    },
  },
  {
    id: 'jiqizhixin', tier: 2, name: '机器之心', sub: '文章库', home: 'https://www.jiqizhixin.com/articles',
    async fetch() {
      const body = await getJson('https://www.jiqizhixin.com/api/article_library/articles.json?sort=time&page=1&per=30');
      // Pieces signed 新闻资讯 are company announcements, not the site's own reporting.
      return body.articles.filter((a) => clean(a.author) !== '新闻资讯').map((a) => ({
        title: clean(a.title), url: `https://www.jiqizhixin.com/articles/${a.slug}`, excerpt: clean(a.content).slice(0, 300),
        meta: [clean(a.author)], time: iso(`${String(a.publishedAt).replace(/\//g, '-').replace(' ', 'T')}:00+08:00`),
      }));
    },
  },
  englishFeed('semianalysis', 'SemiAnalysis', '半导体与算力', 'https://newsletter.semianalysis.com/', 'https://newsletter.semianalysis.com/feed'),
  englishFeed('dwarkesh', 'Dwarkesh', '长访谈', 'https://www.dwarkesh.com/', 'https://www.dwarkesh.com/feed'),
  englishFeed('importai', 'Import AI', 'AI 周报', 'https://jack-clark.net/', 'https://importai.substack.com/feed'),
  englishFeed('simonwillison', 'Simon Willison', '大模型实测', 'https://simonwillison.net/', 'https://simonwillison.net/atom/entries/', { tier: 2 }),
  englishFeed('interconnects', 'Interconnects', '模型与开源', 'https://www.interconnects.ai/', 'https://www.interconnects.ai/feed'),
  englishFeed('chinatalk', 'ChinaTalk', '中国科技政策', 'https://www.chinatalk.media/', 'https://www.chinatalk.media/feed'),
  englishFeed('damodaran', 'Damodaran', '估值与市场', 'https://aswathdamodaran.blogspot.com/', 'https://aswathdamodaran.blogspot.com/feeds/posts/default?alt=rss&max-results=15'),
  englishFeed('construction-physics', 'Construction Physics', '基建与制造', 'https://www.construction-physics.com/', 'https://www.construction-physics.com/feed',
    { skip: /^Reading List\b/i }), // the weekly link round-ups; keep the essays

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

// ---- Chinese titles for the English feeds ----
// Translated by hand: translations/titles.json maps an English title to its Chinese
// title; translations/semianalysis.json is an earlier batch that also carries a
// Chinese summary. A post in neither file is shown in English. Hacker News is not
// translated.
async function translate() {
  const read = async (name) => JSON.parse(await readFile(resolve(HERE, 'translations', name), 'utf8'));
  const titles = await read('titles.json');
  const withSummary = await read('semianalysis.json');
  let missing = 0;
  for (const src of sources.filter((s) => s.english)) {
    for (const it of src.items) {
      const en = it.original ?? it.title;
      const zh = withSummary[en] ? { title: withSummary[en][0], excerpt: withSummary[en][1] } : titles[en] && { title: titles[en] };
      if (zh) Object.assign(it, { title: zh.title, excerpt: zh.excerpt ?? it.excerpt, original: en });
      else { it.title = en; delete it.original; missing++; }
    }
  }
  console.log(`translation: ${missing} titles still in English`);
}
await translate();
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ updatedAt: now, sources }, null, 1) + '\n');
console.log(`wrote ${sources.reduce((n, s) => n + s.items.length, 0)} items to ${OUT}`);
