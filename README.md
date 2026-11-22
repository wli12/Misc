# 热榜速读

把知乎热榜搬到一个安静的静态页面：列表里扫一眼，点进去读问题说明，迫不得已再跳去知乎网页版或 App。

- `site/` — 页面本体（单文件 `index.html`）和数据快照 `data/hot.json`
- `scripts/fetch.mjs` — 抓取知乎公开热榜接口，生成 `site/data/hot.json`
- `.github/workflows/pages.yml` — 每小时抓一次并部署到 GitHub Pages

## 上线

仓库 Settings → Pages → Source 选 **GitHub Actions**，之后工作流会自动部署。

## 本地预览

```sh
node scripts/fetch.mjs          # 可选：刷新数据
python3 -m http.server -d site  # 打开 http://localhost:8000
```

## 已知限制

知乎的回答正文接口需要登录并有反爬校验，所以页面里只有热榜自带的问题说明摘录，看回答要跳转到知乎。

## 片单标记（`site/movies/`）

豆瓣 Top 250 和 IMDb Top 250 的观影标记墙：点格子右上角的圆圈标记“看过”，点格子本身可以标“想看”、跳到各播放源搜索这部片，并记下哪个播放源有、播放页网址是什么。

- `site/movies/index.html` — 页面本体；标记存在浏览器 localStorage，可在“播放源与备份”里导出 / 导入
- `site/movies/data/movies.json` — 两个榜单合并后的片单（由脚本生成）
- `scripts/build-movies.mjs` — 拉取豆瓣榜单快照并与 `scripts/movies/imdb-top250.json` 合并
- 播放源默认有欧乐影院和爱壹帆，搜索网址可在页面里修改或添加

```sh
node scripts/build-movies.mjs   # 刷新片单
```
