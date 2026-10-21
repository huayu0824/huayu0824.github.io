# 博客后台

一个跑在 Cloudflare Workers 上的写作后台：用 GitHub 账号登录，在浏览器里写文章和随笔，保存即向仓库提交 commit，触发 GitHub Actions 自动构建部署。

站点本身仍然是纯静态的，**不需要任何服务器**。

---

## 它做什么

| 功能 | 行为 |
|------|------|
| 登录 | GitHub OAuth，只放行 `wrangler.toml` 里 `ALLOWED_LOGINS` 列出的账号 |
| 文章 | 增删改 `content/posts/<YYYY-MM-DD-slug>/index.md` |
| 随笔 | 增删改 `content/flows/YYYY/MM/DD.md` |
| 笔记 | 增删改 `content/notes/<slug>.md` |
| 系列 | 增删改 `content/series/<slug>/index.md`，勾选成员文章 |
| 书籍 | 增删改 `content/books/<slug>/index.md` + 逐章正文 `<id>.md` |
| 页面 | 增删改 `content/<name>.md`（关于、友链这类独立页） |
| 图片 | 正文里粘贴/拖拽、封面按钮上传，自动落到文章目录的 `images/` 下 |
| 改名 | 改 slug 或改日期时，旧目录会被清理，不留孤儿文件 |
| 保存 | 向仓库提交一次 commit，约 1 分钟后站点更新 |

后台**不做编辑以外的任何事**：没有数据库、没有草稿服务、没有第二份内容副本。所有内容始终只有仓库里那一份。

---

## 六种内容类型，一套代码

类型之间的差异全部收在 `admin/public/app.js` 顶部的 `TYPES` 注册表里：

```js
posts: {
    label: "文章",
    base: "/api/posts",
    key: "slug",                    // 主键字段
    newLabel: "＋ 新建文章",
    flags: ["draft", "featured"],   // 表单上出现哪两个勾选框
    fields: [
        { id: "fSlug", api: "slug", label: "网址别名 slug", kind: "text" },
        { id: "fTags", api: "tags", label: "标签（逗号分隔）", kind: "tags" },
        // ...
    ]
}
```

- `id` 是 DOM 元素 id，`api` 是后端字段名，**两者不一致时以 `api` 为准**。
- 新增一种内容只要加一段配置：列表、表单、保存、删除、校验全部自动生效。
- 系列成员面板、书籍章节面板是两种类型专用的「特殊面板」，在 `renderSpecialPanel()` 里按类型分派。

### 各类型在仓库里的落法

| 类型 | 路径 | 备注 |
|------|------|------|
| 文章 | `content/posts/<YYYY-MM-DD-slug>/index.md` | 目录名必须带日期前缀 |
| 随笔 | `content/flows/YYYY/MM/DD.md` | 也支持 `YYYY/MM/DD/index.md` 文件夹形式 |
| 笔记 | `content/notes/<slug>.md` | **扁平单文件**，写子目录会被 amytis 静默忽略 |
| 系列 | `content/series/<slug>/index.md` | 目录里必须恰好一个索引文件 |
| 书籍 | `content/books/<slug>/index.md` + `<id>.md` | 索引必须有 `title` + `date` + `chapters` |
| 页面 | `content/<name>.md` | 根级，复用 PostSchema，URL 是 `/<name>` |

**系列成员**用「文章 front matter 写 `series:` 字段」的方式自动收集，系列索引的 `posts` 数组强制留空。
这是故意的：amytis 里 `posts` 数组一旦非空就会变成手动排序，引用一个不存在的 slug 会**让整站构建直接失败**。

### 系列还是合集？

后台的「系列」表单里有一个**类型**开关，两者是同一种文件夹（都在 `content/series/<slug>/`），
靠索引 front matter 区分：

| | 系列 | 合集 |
|---|---|---|
| 索引写法 | `posts: []` | `type: collection` + `items:` |
| 成员怎么来 | 文章 front matter 的 `series:` 字段自动收集 | 手工挑，写在索引的 `items` 里 |
| 一篇文章能进几个 | 只能一个（`series:` 字段只有一个值） | 多个，互不影响 |
| 后台里的操作 | 勾选文章，会去改文章的 front matter | 挑文章/挑系列，不碰任何文章 |

合集的 `items` 两种条目：

```yaml
items:
  - post: posts/some-article      # 引用独立文章
  - post: other-series/week-11    # 引用另一个系列里的文章
  - series: other-series          # 整个系列收进来
    exclude: [week-11]            # 还能排除其中几篇
```

引用键的形态跟 amytis 的 `getCollectionKey` 一致：独立文章是 `posts/<slug>`，系列内文章是 `<series>/<slug>`。
后台的下拉里直接给出正确的键，不用手敲。

**两条硬约束**（后台会提前拦下来，不会让你把站点写挂）：

1. **合集至少要有 1 个成员**——amytis 的 `PostSchema` 明确规定 `Collections require at least one item`，空合集会让整站构建失败。
2. **引用的文章/系列必须真的存在**——引用不到任何文章时 amytis 会直接抛错。后台保存前会逐个校验。

---

## 交互

| 功能 | 说明 |
|------|------|
| Markdown 工具栏 | H2/H3、加粗/斜体/删除线、行内代码、有序无序列表、引用、代码块、链接、图片、`[[双链]]` |
| 双链补全 | 输入 `[[` 弹出候选，**按 slug 插入**（amytis 按 slug 解析，插标题会解析失败） |
| 三种布局 | 只编辑 / 分栏 / 只预览，右上角一键切换，选择记在 localStorage |
| 专注模式 | 收起侧栏只留正文 |
| 本地自动草稿 | 改动 500ms 后自动存 localStorage，关页面不丢稿；重新打开时提示恢复 |
| 批量操作 | 「多选」进入多选态，可批量删除或批量转草稿 |
| 服务端搜索 | 筛选框走 GitHub code search，命中路径才去读文件；接口失败时退回本地筛选 |
| 排序 | 最新在前 / 最早在前 / 字数最多 / 标题排序 |
| 版本历史 | 右侧抽屉列出该文件的提交历史，可一键回滚到某个版本 |
| 图片库 | 弹窗浏览仓库里所有图片，可直接插入正文或删除 |
| 快捷键 | `?` 键打开快捷键面板 |
| 移动端 | 列表/编辑二选一，底部有操作栏 |

---

## 内容格式对齐

后台写入的 front matter 严格对齐 amytis 的 Zod schema（`src/lib/content/parse.ts` 里的 `PostSchema`、`FlowSchema` 等）。多一个字段少一个字段都会让站点构建失败，所以改这块务必先跑：

```bash
npm run verify
```

这个测试会用 **amytis 自己的加载器**（`getAllPosts()` / `getAllFlows()` / `getAllNotes()` / `getAllPages()` / `getAllSeries()` / `getSeriesPosts()` / `getAllBooks()`）把后台生成的文件读回来验证，不是拿一份近似规则糊弄。

> 注意：amytis 的 `posts.ts` / `series.ts` 用了 `createKeyedMemo`，**dev 模式下也缓存**。
> 所以验证脚本必须先把全部素材写完再断言，否则后写的文件会「找不到」。

---

## 三层验证

| 命令 | 验什么 |
|------|--------|
| `npm run verify` | 内容格式：用 amytis 真实加载器读回后台产物（53 项断言） |
| `npm run verify:worker` | Worker 端到端：打桩 GitHub API，跑真实 Worker 代码（40 项断言） |
| `npm run verify:ui` | 前端交互：happy-dom 加载真实 index.html + app.js，驱动点击，断言最后发出的请求体（10 项断言） |
| `npm run mock` | 本地假服务器：内存仓库 + 假 API + 托管前端，用来在浏览器里点 |

```bash
npm run mock     # 打开 http://127.0.0.1:8788
```

假服务器有三个坑已经踩平，改动时留意：

1. **静态资源必须带 `Cache-Control: no-store`**。不带的话浏览器会缓存 `app.js`，
   改完代码刷新页面拿到的还是旧版，会出现「明明改对了，界面却没反应」这种极难查的问题。
   线上 Worker 也一样：`serveAsset()` 会给 html/js/css 强制加 `no-store`。
2. **响应要带 `Content-Length`**。用 chunked 编码时浏览器的 `fetch` 会一直等不到响应体结束。
3. 内存仓库里的 front matter 解析器要支持 `chapters` 这种对象数组（`- title: x` / `id: y`），
   否则书籍章节面板是空的。

---

## 部署

需要两样东西，都免费：

1. **一个 Cloudflare 账号**（Workers 免费额度每天 10 万次请求，个人博客远远用不完）
2. **一个 GitHub OAuth App**

### 1. 建 GitHub OAuth App

<https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**

| 字段 | 填什么 |
|------|--------|
| Application name | 随意，例如 `花羽博客后台` |
| Homepage URL | `https://<你的-worker域名>` |
| Authorization callback URL | `https://<你的-worker域名>/auth/callback` |

> callback URL 只能填一个，且必须和部署后的域名完全一致（含 `https://`、无结尾斜杠）。
> 本地开发要用 `http://localhost:8787/auth/callback` 调试的话，得临时改这里再改回来。

建好后页面会给出 **Client ID**，点 **Generate a new client secret** 得到 **Client Secret**。

### 2. 部署 Worker

```bash
npm install
npx wrangler login          # 第一次会让你在浏览器授权 Cloudflare
npx wrangler deploy         # 部署完会打印 *.workers.dev 域名
```

### 3. 设置密钥

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
```

第三条用一串足够长的随机串，可以这样生成：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

设完再 `npx wrangler deploy` 一次让配置生效。

### 4. 确认白名单

`wrangler.toml` 里：

```toml
ALLOWED_LOGINS = "huayu0824"
```

**这一行务必填你自己的 GitHub 用户名。** 留空意味着任何能登录 GitHub 的人都能通过 OAuth 进后台并改你的博客。

---

## 本地开发

```bash
npm install
npm run dev        # http://localhost:8787
npm run verify     # 用 amytis 真实加载器校验内容格式
```

本地需要 `admin/.dev.vars`（已在 `.gitignore` 中）：

```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
SESSION_SECRET=...
```

登录回调在本地跑不通（GitHub OAuth App 只认一个 callback URL），其余接口可以用伪造的会话令牌直接测。

---

## 配置项

`wrangler.toml` 的 `[vars]` 段：

| 变量 | 说明 |
|------|------|
| `GITHUB_OWNER` / `GITHUB_REPO` | 站点所在仓库 |
| `GITHUB_BRANCH` | 构建分支 |
| `ALLOWED_LOGINS` | 允许登录的 GitHub 用户名，逗号分隔 |
| `DEFAULT_AUTHOR` | 新文章的默认作者 |
| `GITHUB_SCOPE` | `public_repo`；仓库若改成私有则用 `repo` |

---

## 站点设置

后台右上角的齿轮按钮打开「站点设置」，改的是仓库根目录的两个文件：

| 文件 | 管什么 |
|------|--------|
| `site.settings.json` | 博客名称、描述、Logo、分享图、首页文案、**页面开关**、导航、页脚、社交账号 |
| `site.texts.json` | 页面文字（覆盖 amytis 的 i18n 词条，比如页面标题、说明、按钮） |

**构建时它们会覆盖掉 `site.config.ts` / `src/i18n/translations.ts` 里的默认值。**
所以改了设置要改这两个文件（或用后台改），改 `site.config.ts` 里的默认值不生效——
那里的值只作兜底（JSON 里缺哪个键就用哪个）。

改完点保存 → 提交一次 commit → CI 重建 → 约 1 分钟后站点生效。

### 能调哪些开关

| 开关 | 作用 |
|------|------|
| 文章 / 系列 / 书籍 / 随笔 | 关掉的页面，导航里也不再出现（amytis 的 `features`） |
| 首页分区 | 精选文章 / 最新文章 / 最近随笔 / 精选系列 / 精选书籍，逐个开关 + 改条数 |
| 导航 | 增删条目、改名字和链接、调顺序、给「更多」加子项 |
| 页脚 | 探索 / 链接两组链接、社交账号、版权文字 |
| 页面文字 | 站点各处文案，带搜索；只保存你改过的词条 |

### 两道保险

设置写坏了，站点会直接构建失败。所以后台在保存前会拦：

1. **结构校验**——`nav` 的每一项要有 name 和 url，`features.*.enabled` 必须是布尔值，`homepage.sections[].id` 不能空，等等。
2. **文案键校验**——`site.texts.json` 里的键必须是 i18n 词条里真有的，否则写了也不生效。

另外 `site.texts.json` 的形状允许变（比如只留 zh），构建层用了不依赖静态类型的写法，改了语言也不会把 TS 编译搞挂。

---

## 目录结构

```
admin/
  src/
    index.js      路由与各接口实现
    github.js     GitHub API 封装（tree / contents / code search / Git Data 批量提交）
    content.js    路径规则：六种内容的落盘位置、上传路径
    markdown.js   front matter 解析与序列化
    settings.js   站点设置的读写与结构校验
    session.js    会话令牌签名与校验
  public/         后台前端（静态资源）
    index.html    页面骨架
    app.js        数据驱动的类型注册表 + 全部交互
    settings.js   站点设置面板
    app.css       样式（含明暗两套主题、移动端适配）
  scripts/
    verify-admin.mjs   内容格式回归测试（amytis 真实加载器）
    verify-worker.mjs  Worker 端到端测试（打桩 GitHub API）
    verify-ui.mjs      前端交互测试（happy-dom 驱动真实 DOM）
    dev-mock.mjs       本地假服务器
```

---

## 接口

所有列表接口统一返回 `{ items, total, offset, limit, truncated, searched }`，
详情统一返回 `{ key, title, content, path, url, ... }`。

```
GET/POST          /api/posts | /api/flows | /api/notes | /api/series | /api/books | /api/pages
GET/PUT/DELETE    /api/{type}/{key}
PUT               /api/series/:slug/posts      { slugs: [...] }   批量挂载/取消成员
PUT/DELETE        /api/books/:slug/chapters/:id
GET               /api/history?type=&key=      POST /api/history { type, key, sha }
GET/DELETE        /api/images[?path=]
POST              /api/batch { type, action: delete|draft, keys: [...] }
POST              /api/upload
GET               /api/session
GET/PUT           /api/settings                站点设置（site.settings.json）
GET/PUT           /api/texts                   页面文字（site.texts.json）
```

主键字段名按类型不同：文章/笔记/系列/书籍是 `slug`，随笔是 `date`，页面是 `name`。

---

## 两个容易踩的坑

1. **处理函数不要直接返回 `Response`**。Worker 里统一用 `ok()` / `fail()` / `respond()` 返回值约定，
   直接返回 `Response` 会被二次 `json()` 包装吞掉状态码。
2. **批量写文件走 Git Data API**（`github.js` 里的 `commitFiles`），文件内容内联进 tree，
   改 N 个文件只花 5 次请求。用 Contents API 逐个写会撞上 Cloudflare 免费版 50 次子请求上限。

