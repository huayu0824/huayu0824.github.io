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
| 图片 | 正文里粘贴/拖拽、封面按钮上传，自动落到文章目录的 `images/` 下 |
| 改名 | 改 slug 或改日期时，旧目录会被清理，不留孤儿文件 |
| 保存 | 向仓库提交一次 commit，约 1 分钟后站点更新 |

后台**不做编辑以外的任何事**：没有数据库、没有草稿服务、没有第二份内容副本。所有内容始终只有仓库里那一份。

---

## 内容格式对齐

后台写入的 front matter 严格对齐 amytis 的 Zod schema（`src/lib/content/parse.ts` 的 `PostSchema`、`src/lib/content/flows.ts` 的 `FlowSchema`）。多一个字段少一个字段都会让站点构建失败，所以改这块务必先跑：

```bash
npm run verify
```

这个测试会用 **amytis 自己的加载器**（`getAllPosts()` / `getAllFlows()`）把后台生成的文件读回来验证，不是拿一份近似规则糊弄。

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

## 目录结构

```
admin/
  src/
    index.js      路由与各接口实现
    github.js     GitHub API 封装（tree / contents）
    content.js    路径规则：文章目录名、随笔两种存储形式、上传路径
    markdown.js   front matter 解析与序列化
    session.js    会话令牌签名与校验
  public/         后台前端（静态资源）
  scripts/
    verify-admin.mjs   内容格式回归测试
```
