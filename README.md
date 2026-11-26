# 热榜速读

把几个中文热榜和信息源放在一个安静的页面里：知乎热榜、知乎日报、Hacker News、V2EX、晚点、张小珺商业访谈录、阮一峰周刊、果壳、机器之心、SemiAnalysis，以及七个英文来源（Dwarkesh、Import AI、Simon Willison、Interconnects、ChinaTalk、Damodaran、Construction Physics）。点条目跳到原站。

线上地址：<https://news.hackerfun.org/>。

每个来源有一个深度星级（★★★ 深度、★★ 有料、★ 消遣，标准与 HackerFun 主站相同，定义在 `scripts/fetch.mjs` 的 `tier` 字段），页面顶部的三个按钮按星级筛选来源。

- `site/` — 页面本体（单文件 `index.html`）和数据快照 `data/hot.json`
- `scripts/fetch.mjs` — 逐个抓取各来源的公开接口或 RSS，生成 `site/data/hot.json`；某个来源失败时沿用它上一次的内容
- `scripts/translations/` — 英文来源标题的中文翻译，人工维护（`titles.json` 只有标题，`semianalysis.json` 是早先连副标题一起翻的一批）；没翻译的新文章显示英文，Hacker News 不翻译
- `.github/workflows/pages.yml` — 抓取并部署到 GitHub Pages，由 Google Cloud Scheduler 每小时触发一次

## 本地预览

```sh
node scripts/fetch.mjs          # 可选：刷新数据
python3 -m http.server -d site  # 打开 http://localhost:8000
```

## 已知限制

- 知乎的回答正文接口需要登录并有反爬校验，所以页面里只有热榜自带的问题说明摘录，看回答要跳转到知乎。
- 手机上点条目是在当前标签页打开知乎：知乎的手机网页在拒绝“打开 App”后会关掉由别的网页打开的标签页。

## 片单标记（`site/movies/`）

豆瓣 Top 250 和 IMDb Top 250 的观影标记墙：点格子右上角的圆圈标记“看过”，点格子本身可以标“想看”、跳到各播放源搜索这部片，并记下哪个播放源有、播放页网址是什么。

- `site/movies/index.html` — 页面本体；标记存在浏览器 localStorage，可在“播放源与备份”里导出 / 导入
- `site/movies/data/movies.json` — 两个榜单合并后的片单（由脚本生成）
- `scripts/build-movies.mjs` — 拉取豆瓣榜单快照并与 `scripts/movies/imdb-top250.json` 合并
- `site/movies/config.js` — 登录与云端同步的配置；留空时不显示登录，标记只存本地
- 播放源默认有欧乐影院和爱壹帆，搜索网址可在页面里修改或添加

```sh
node scripts/build-movies.mjs   # 刷新片单
```

### 开启登录和云端同步（可选）

登录用的是 Firebase（Google 账号、邮箱登录链接），标记存在 Firestore 里，每个账号只能读写自己的那一份。

1. 在 [Firebase 控制台](https://console.firebase.google.com/) 新建一个项目（免费的 Spark 方案即可）。
2. **Authentication → 登录方法**：启用 “Google”；启用 “电子邮件/密码”，并勾选其中的 “电子邮件链接（无密码登录）”。
3. **Authentication → 设置 → 授权网域**：添加网站的域名（GitHub Pages 是 `<用户名>.github.io`）。
4. **Firestore Database**：创建数据库（生产模式），把“规则”换成：

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

5. **项目设置 → 你的应用**：添加一个 Web 应用，把给出的 `firebaseConfig` 填进 `site/movies/config.js`。这段配置是公开信息，可以提交；数据靠上面的规则和授权网域保护。

第一次在某个浏览器登录时，本地已有的标记会和云端合并；之后以云端为准，多台设备实时同步。
