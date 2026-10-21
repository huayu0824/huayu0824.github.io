# 天道

> 神即道，道即规律，如来。—— 豆豆《遥远的救世主》

花羽的成长记录。记下我想过的、做过的，和一路上变了什么——随笔、笔记、拆开又装回去的东西，都在这。

站名取自《遥远的救世主》——不靠救世主，靠规律。

基于 [Amytis](https://github.com/hutusi/amytis)（Next.js 16 + Bun + Tailwind v4）构建，部署在 GitHub Pages。

线上地址：<https://huayu0824.github.io>

---

## 内容怎么组织

所有文章都在 `content/` 下，写的是纯 Markdown，可以直接用 Obsidian 打开仓库编辑。

```
content/
  posts/                            文章
    2026-06-23-with-u/
      index.md                      正文 + front matter
      images/                       随文图片（构建时自动复制到 /posts/with-u/）
  flows/                            每日随笔 Flow：YYYY/MM/DD.md
  templates/                        不进构建，放模板文件
  about.md                          关于页      → /about
  links.md                          友链页      → /links
```

### 文章文件名的规则

目录名必须是 `YYYY-MM-DD-slug`，**日期前缀不能省**：

- `2026-06-23-with-u/` → 网址是 `/posts/with-u/`，日期从文件名取
- 文件名里不带日期的话，日期会退化成文件修改时间，排序会乱

### front matter 字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `title` | 是 | 文章标题 |
| `date` | 否 | `YYYY-MM-DD`，不写则取文件名 |
| `excerpt` | 否 | 列表页和首页卡片的摘要，不写自动从正文截取 |
| `category` | 否 | 分类，默认 `Uncategorized` |
| `tags` | 否 | 标签数组 |
| `authors` | 否 | 作者数组，默认取 `site.config.ts` 里的配置 |
| `coverImage` | 否 | 封面图，相对本文章目录，如 `images/cover.png` |
| `featured` | 否 | `true` 时进首页「精选文章」 |
| `draft` | 否 | `true` 时生产环境不显示 |
| `redirectFrom` | 否 | 旧网址列表，**不要带结尾斜杠**，如 `"/p/old-slug"` |

### 图片怎么放

文章文件夹里除 `.md` 外的任何文件都会自动复制到 `/posts/<slug>/`，正文里用相对路径引用即可：

```markdown
![说明](./images/screenshot.png)
```

Obsidian 里粘贴图片会存在 `index.md` 旁边（已配置 `attachmentFolderPath: "."`），构建时会自动带上。

---

## 用 Obsidian 写

把**仓库根目录**当作 vault 打开（`.obsidian/` 在根目录）。

已经配好的：

- `content/flows` + `YYYY/MM/DD` 格式 → 每日笔记插件产出的笔记**直接就是 amytis 的 Flow**，不用手动搬
- 模板放在 `templates/`，每日笔记用 `flow.md`
- 图片粘在当前文件旁边
- `node_modules`、`out`、`.next`、`src` 等构建目录已在 `app.json` 的 `userIgnoreFilters` 里排除，不会拖慢索引

写完 `git push`，Actions 会自动重新构建部署。

---

## 本地开发

需要 [Bun](https://bun.sh)（本机装在 `D:\DevTools\bun\bun-windows-x64`）。

```bash
bun install          # 装依赖
bun run dev          # 本地预览 http://localhost:3000
bun run build        # 构建，产物在 out/
bun run new "标题"    # 新建文章（会按 YYYY-MM-DD-slug 命名）
bun run new-flow      # 新建一条 Flow
```

改了 `site.config.ts`（站点标题、导航、首页分区、评论、统计）之后重新 `bun run build` 即可。

---

## 部署

推 `main` 分支触发 `.github/workflows/deploy.yml`：GitHub Actions 装 Bun → `bun run build` → 产物发到 GitHub Pages，约 1~2 分钟。

---

## 后台

`admin/` 是一个独立的 Cloudflare Worker，提供 GitHub 登录的写作后台，文章和随笔都能写，保存即向仓库提交 commit 触发自动部署。

部署步骤见 [`admin/README.md`](admin/README.md)。不需要服务器。

---

## 旧站备份

原来的 Hugo + Stack 站点完整保留在 `hugo-site` 分支，需要时 `git checkout hugo-site` 即可切回。
