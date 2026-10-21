# AI 协作机体测试

一个纯静态、零构建的在线问卷网站：访客回答 16 道日常 AI 协作情境题，从 4 个维度得到一个四维倾向，再匹配到 8 种「协作机体」之一，结果页给出人物插画、偏好与边界、可尝试的做法。作答数据静默写入 Supabase；前台页面不提供任何数据后台入口，后台页面保留在 `/admin.html`，只能手动输入地址访问。

新版（v2.0）要点：

- 16 道题 / 4 个维度 / 8 种协作机体；结果页只显示机体中文名和人物图，**不显示 M01–M08 编号，也不显示四字母代号**。
- 首页简化：首屏是轻量的**纯文字**机体目录（直接列出 8 种协作机体名称），不加载人物图片；人物插画只出现在结果页大图、并列候选小图、对照机体缩略图和分享落地页。
- 计分做了增强：每题声明主维度，三个选项在主维度上是一正、一负、一中性（`+2/+1`、`-2/-1`、`0`），部分选项额外带一个语义明确的次要维度 `±1`；配合「补偿下调」，四维原始分范围仍是 −8 ~ +8，归一化与百分比公式不变。
- 机体编号 M01–M08 只作为数据库内部类别标识（`result_code`）；真实四维方向另存在 `percents.match.profileCode` 里，仅用于数据留存。
- 纯静态：没有框架、没有打包、没有构建步骤、没有外部 CDN 或字体依赖，GitHub Pages 直接从 `main` 分支根目录发布。
- 数据通过 Supabase 记录；前台不显示「已上传 / 云端 / 本地预览」等状态，首页也没有后台入口。数据后台页面保留在 `/admin.html`，只能手动输入地址访问并登录查看（看板 / 单份答卷详情 / 筛选 / 导出 / 删除）。
- `resources/` 只是本地素材（题目说明与原始图片），已被 `.gitignore` 忽略，不发布、不引用。

## 线上地址与仓库

- 线上地址：<https://xiaopalll.github.io/ai-personality/>
- 仓库：<https://github.com/xiaopaLLL/ai-personality>（默认分支 `main`）
- 发布方式：GitHub Pages，Deploy from a branch → `main` / `(root)`，无构建步骤
- 数据项目：Supabase `https://pcwlaykrepvdvzgrtktp.supabase.co`，表 `ai_personality_responses`

## 目录结构与文件职责

| 路径 | 职责 |
| --- | --- |
| `index.html` | 前台唯一页面：首屏、答题、结果、分享落地页四个屏；首屏机体目录是纯文字，不加载人物图片 |
| `admin.html` | 数据后台页面：只能直接输入 `/admin.html` 访问；登录后查看看板、单份答卷详情、筛选、导出、删除；**前台没有任何入口** |
| `config.js` | 站点配置：数据后端、Supabase 地址与 anon key、分享链接前缀、采集字段开关 |
| `assets/css/style.css` | 前台与后台共用的基础样式（暗绿 + 荧光绿档案风，含移动端与减动效适配） |
| `assets/css/admin.css` | 数据后台页面专用样式 |
| `assets/js/questions.js` | 题库与站点文案（`window.SURVEY`）：16 题、4 维定义、`meta` 版本与首屏文字 |
| `assets/js/personality.js` | 计分与匹配引擎（`window.Engine`）：8 个原型坐标、距离匹配、8 种机体文案 |
| `assets/js/store.js` | 数据层：组装记录、提交 Supabase、失败时本地暂存重发；另含后台 API（`Store.admin` 登录 / 取数 / 删除）与 `Store.toCSV` 导出 |
| `assets/js/app.js` | 前台交互：路由、答题、结果渲染、分享落地页、旧链接提示 |
| `assets/js/admin.js` | 数据后台交互：登录、看板渲染、单份答卷详情（逐题答案 / 复制 JSON）、筛选、刷新、CSV / JSON 导出、删除 |
| `assets/img/` | `m01.webp`–`m08.webp`（900×900 人物大图）、`thumbs/`（420×420 缩略图）：用于结果页、并列候选、对照机体和分享页，首屏不加载；`overview.webp` 当前未引用 |
| `supabase/schema.sql` | 建表 + RLS 策略 + 可选统计 SQL，可重复执行，不会清数据 |
| `tests/` | 本地静态服务器、逻辑 / 冒烟 / 前台 E2E / 后台 E2E 测试、截图脚本 |
| `docs/` | [重新部署步骤](docs/重新部署步骤.md)、[问卷设计与结果简介](docs/问卷设计与结果简介.md) |
| `README.md` | 本文件 |
| `.gitignore` | 忽略 `resources/`、测试截图等 |
| `.nojekyll` | 让 GitHub Pages 跳过 Jekyll 处理 |
| `robots.txt` | 禁止搜索引擎收录 `/admin.html`、`tests/`、`resources/` |
| `resources/` | **仅本地**：新版题目与计分说明、原始图片，已 gitignore |

## 本地预览

```powershell
cd D:\xiaopaLLL\MBAItest
node tests/serve.mjs 8000
# 浏览器打开 http://127.0.0.1:8000/
```

- 页面必须通过 http 服务器访问，**不要用 `file://` 直接双击**：Supabase 提交会被浏览器跨域限制拦掉，测不出真实数据链路。
- 默认启动会读取 `config.js` 里的线上 Supabase 配置，**本地每做一份答卷都会真实写进线上库**。只想看界面、不想写数据时加 `--force-local`：

```powershell
node tests/serve.mjs 8000 --force-local
```

`--force-local` 会在页面里注入配置覆盖，把 `backend` 锁成 `local`，数据只存当前浏览器。自动化测试默认都用这个模式，避免把测试数据写进线上库。

- 后台页面本地入口：<http://127.0.0.1:8000/admin.html>（前台没有链接，只能手动输入；用法见下文「数据记录」）。

## 测试

需要 Node.js（测试脚本用到 `import.meta.dirname`，建议 Node 20.11 及以上；本机已在 Node 26 上验证）与 Git。浏览器 E2E、后台 E2E / 截图测试还需要本机装有 Chrome 或 Edge。

```powershell
# 一次跑完四套（推荐；依次 engine → smoke → e2e → admin-e2e）
npm.cmd test

# 或者逐条跑
node tests/engine.test.mjs   # 计分引擎与数据层：问卷结构、四维计分、次要分补偿、8 机体匹配、记录字段、后台 API / CSV（26 项）
node tests/smoke.mjs         # 静态资源与页面约定：前台无后台入口、后台页面资源齐全、无编号泄漏、文档关键词（42 项）
node tests/e2e.mjs           # 前台 headless Chrome：答题 → 结果 → 分享页 → 旧链接 → 全中性并列（38 项）
node tests/admin-e2e.mjs     # 后台 headless Chrome：local 模式看板 49 项 + Supabase 登录页 8 项（57 项）
node tests/screenshots.mjs   # 可选：生成预览截图到 tests/screenshots/（已 gitignore）
```

- `npm test` 可能被 PowerShell 执行策略拦住（`npm.ps1` 不能运行），改用 `npm.cmd test` 或直接执行上面的 `node` 命令。
- 四套测试都不依赖网络、不会写线上 Supabase；后台 E2E 的 Supabase 部分只打开登录页检查，不会真的登录或读数据。E2E / 后台 E2E / 截图找不到 Chrome/Edge 时会打印提示并跳过（退出码 0）。
- `tests/smoke.mjs` 会检查前台没有后台入口、后台页面资源齐全，并检查 `README.md` 与 `docs/` 里是否还保留若干关键词。以后改文档时如果删掉了「GitHub Pages」「Supabase」「重新部署」「node tests/engine.test.mjs」「resources/」这类词，冒烟测试会失败——这是有意为之，按提示补回即可。
- 截图脚本需要 Chrome/Edge，输出目录 `tests/screenshots/` 已 gitignore。

## 修改内容指南

### 题目与首屏文案：`assets/js/questions.js`

- 题库在 `SURVEY.questions`，每题 `{ id, dim, text, options }`，`options` 固定 3 个；`dim` 是这道题的主维度。
- 计分规则：
  - 三个选项在**主维度**上分别是一正、一负、一中性：正分是 `+2` 或 `+1`，负分是 `-2` 或 `-1`，中性是 `0`。
  - 部分选项可以额外带**一个**语义明确的次要维度 `±1`（同一选项最多一个、且与主维度不同；全题库共 16 个次要分）。
  - 为保证每维理论极值仍是 `-8 ~ +8`，必须做**补偿下调**：每加一个次要 `+1`，就把该维一个原本 `+2` 的选项降为 `+1`；每加一个次要 `-1`，就把该维一个原本 `-2` 的选项降为 `-1`。不补偿会让百分比和原型匹配漂移，`node tests/engine.test.mjs` 也会失败。
  - 正 / 负 / 中性选项的位置不要按固定顺序排。
- 维度定义在 `SURVEY.dimensions`，顺序为 `drive / heart / order / role`，对应四维表见[设计说明](docs/问卷设计与结果简介.md)。
- 首屏标题、副标题、简介、隐私告知、是否必须勾选同意、是否收集昵称等，都在 `SURVEY.meta`。
- 改完题目后**把 `meta.version` 升一版**（例如 `v2.0` → `v2.1`）：数据库里能区分改版前后的答卷；旧版本的未完成作答进度也会被自动丢弃。
- 同时把 `index.html`、`admin.html` 里脚本 / 样式引用末尾的 `?v=2.2` 改成新版本号，避免访客浏览器继续用缓存。

### 机体文案与原型坐标：`assets/js/personality.js`

- 8 种机体的 `name / tagline / desc / strengths / watch / tips` 在 `CONTENT` 里，结果页直接读取这些字段；`oppositeNote` 是备用的对照说明文案，当前结果页的「对照机体」用的是固定说明 + 对照机体的 `tagline`。
- 8 个原型坐标在 `PROTOTYPES`（顺序固定为 `drive / heart / order / role`），相反画像在 `OPPOSITE`。坐标变了要重跑 `node tests/engine.test.mjs`。
- `id`（M01–M08）和 `slug` 是数据与分享链接的契约，**不要随意改**：改了之后旧的分享链接会变成「链接没有接上」。分享链接形如 `?type=machine-soul`，slug 与机体的对应写在 `PROTOTYPES` 里。
- 结果页展示顺序由 `PROTOTYPES` 数组顺序决定；并列时前端先展示数组里靠前的那一个，但页面上会明确说明这只是并列候选之一。

### 图片：`assets/img/`

- 替换同名文件即可：`assets/img/m01.webp` … `m08.webp`（建议 900×900）与 `assets/img/thumbs/m01.webp` … `m08.webp`（建议 420×420）。
- 文件名保持小写；线上是 Linux，大小写不一致会 404。路径都写相对路径（`assets/...`），不要引用 `resources/` 里的原图。
- `assets/img/overview.webp` 是总览插图素材，当前页面未引用，但冒烟测试会检查它能访问；如果决定删除，请同步调整 `tests/smoke.mjs` 中的资源清单。

### 站点配置：`config.js`

- `backend`：`'supabase'`（当前线上）、`'custom'`（自建接口）、`'local'`（只存本机，适合纯预览）。
- `supabase.url / anonKey / table`：`anon key` 设计上可以公开，写权限由 `supabase/schema.sql` 的 RLS 控制（匿名只能 insert，不能 select / delete）。
- `site.publicUrl`：分享链接前缀。换域名 / 换仓库名时必须同步修改，末尾带 `/`。
- `collect.*`：采集字段开关（设备信息、耗时、昵称）；关掉就完全不采集对应字段。

### 数据后台页面：`admin.html` / `assets/css/admin.css` / `assets/js/admin.js`

- 后台页面只能通过地址栏 `/admin.html` 手动访问；**前台不要加任何入口、链接或「数据后台」提示**，`robots.txt` 的 `Disallow: /admin.html` 和后台页面的 `<meta name="robots" content="noindex, nofollow">` 要保留。
- 登录账号在 Supabase → Authentication → Users 里创建（邮箱 + 密码，并在创建时确认邮箱）；后台本身不维护账号体系。
- 看板/样式改动只动这三个文件；数据访问接口在 `assets/js/store.js` 的 `Store.admin`（登录 / 会话 / 取数 / 删除），CSV 导出在 `Store.toCSV`。
- 改完后台页面或 `Store.admin` 后，跑 `node tests/admin-e2e.mjs` 和 `node tests/smoke.mjs`。

### 改完必做的检查

```powershell
node tests/engine.test.mjs
node tests/smoke.mjs
# 改过后台页面 / Store.admin / Store.toCSV 时再跑：
node tests/admin-e2e.mjs
```

题目结构、四维极值、8 机体匹配、前台页面约定、后台资源与关键容器，任何一项被改坏，这些命令都会直接报出来。

## 数据记录（Supabase）

表和字段定义在 `supabase/schema.sql`，线上已建好。一条记录主要包含：

| 字段 | 含义 |
| --- | --- |
| `survey_version` | 问卷版本（当前 `v2.0`；旧版 16 型记录沿用旧版本号） |
| `result_code` / `result_name` | 新版为 `M01`–`M08` / 机体中文名；**仅内部与数据用途** |
| `scores` | 四维原始分 `{drive, heart, order, role}`，范围 −8 ~ +8 |
| `percents` | 四维展示百分比（左 / 右 / 中性），新版额外带 `percents.match` |
| `answers` / `answer_detail` | 每题所选选项下标 / 选项文字与各维度分值（主维度 + 可能一个次要维度） |
| `answered` / `total` / `duration_ms` | 完成题数、总题数、作答耗时 |
| `nickname` / `user_agent` / `referrer` / `lang` / `screen` / `timezone` | 可选的昵称与设备信息 |

`percents.match` 是新版匹配元数据（不改表结构，直接放在原有 jsonb 列里）：

| 键 | 含义 |
| --- | --- |
| `profileCode` | 四维方向，如 `EWSP`；某维原始分为 0 时该位为 `X` |
| `display` | 本次展示的机体编号（并列时只是先展示的那一个） |
| `candidates` | 距离并列的全部机体编号；全中性时是 8 个 |
| `tie` / `allNeutral` | 是否并列 / 是否四维全中性 |
| `near` | 与最佳距离差不超过 1/16 的「同时接近」机体 |
| `bestDistance` / `secondDistance` | 最佳 / 次佳距离 |

查看数据有两条路径（前台没有任何入口，不要往首页加）：

1. **数据后台页面**：直接在浏览器地址栏打开 `/admin.html`（线上是 `https://xiaopalll.github.io/ai-personality/admin.html`，本地预览是 `http://127.0.0.1:8000/admin.html`）。
   - `backend: 'supabase'`（当前线上）：用 Supabase → Authentication → Users 里创建的邮箱账号登录。登录后可查看 KPI、8 机体分布（旧的 16 型类型单独一块）、四维平均、16 题选项分布、最近 14 天趋势和答卷记录表；支持版本 / 时间 / 机体筛选、刷新、导出 CSV / JSON、删除单条记录（删除不可恢复）和退出登录。**答卷表格每行可点「查看」（也可点整行）打开单份答卷详情，查看逐题答案、四维百分比与原始分、匹配元数据，并可复制该条 JSON。** 后台默认读取最近 1,000 条，表格最多显示 500 行。
   - 登录过期（401）会自动回到登录页，重新登录即可；能登录但看不到数据（403）通常是 Supabase RLS 的 `auth_can_read` 策略缺失，删除失败多为 `auth_can_delete` 缺失，按 `supabase/schema.sql` 检查。
   - `backend: 'local'`：无需登录，直接看当前浏览器 localStorage 里的记录（顶部提示「本地模式」）。
   - `backend: 'custom'`：后台暂不支持，只显示未配置提示。
   - 后台页面带 `noindex`，`robots.txt` 也禁止收录，但这只影响搜索引擎，不影响地址栏手动访问。
2. **Supabase 控制台**：登录 → Table Editor（或 SQL Editor），适合直接看表、写统计 SQL。

匿名访客即使拿到 anon key 也只能写入，读不到任何人的作答；后台读取和删除必须用登录账号并通过 RLS 授权。

提交是静默的：网络失败时记录会先存到访客浏览器（`localStorage`），下次打开页面自动重试。排查「数据没进库」时可以先看浏览器开发者工具 → Application → Local Storage 里的 `aipt:pending:v2`。

## 部署

完整步骤、验收清单与回滚方式见 **[docs/重新部署步骤.md](docs/重新部署步骤.md)**。日常改完内容后的简版流程：

1. 本地预览 + 跑测试（`node tests/engine.test.mjs`、`node tests/smoke.mjs`、`node tests/e2e.mjs`、`node tests/admin-e2e.mjs`）。
2. `git add -A` → `git status` 核对 → `git commit -m "..."`。
3. `git push origin main`。
4. 等 GitHub Pages 自动发布（仓库 Actions 里 `pages build and deployment`，一般 1–3 分钟）。
5. 打开线上地址 `Ctrl+F5` 强刷，按部署文档里的线上验收清单逐项检查。
6. 需要看数据时，地址栏打开 `/admin.html` 登录后台（或登录 Supabase 控制台）；不要给前台加任何后台入口。

## 视觉与素材约定

- 视觉沿用当前「暗绿底 + 荧光绿线稿 + 档案卡片」风格；没有外部字体和图标库，背景网格、暗角等全部由 CSS 绘制。
- 人物插画统一放在 `assets/img/` 与 `assets/img/thumbs/`，格式 WebP；**首屏是纯文字机体目录，不加载任何图片**，人物插画只出现在结果页大图、并列候选小图、对照机体缩略图和分享落地页。
- `resources/`（原始题目说明与图片）只留在本地，**不要提交、不要在页面里引用**；版本库只保留转换后的 `assets/img/*.webp`。
- 样式 / 脚本改动后记得升 `index.html` 与 `admin.html` 里的 `?v=` 缓存参数。

## 常见问题

| 症状 | 处理 |
| --- | --- |
| 线上还是旧页面 | 确认 `git push` 成功、Actions 里 Pages 构建完成（1–3 分钟），再 `Ctrl+F5` 强刷或等 CDN 缓存刷新。 |
| 图片 404 | 确认 `assets/img/`（含 `thumbs/`）已提交、文件名小写且与 `personality.js` 里一致；线上区分大小写。 |
| 首页看不到人物图片 | 正常：首屏是纯文字机体目录，不加载图片；人物插画只出现在结果页、并列候选、对照机体和分享落地页。 |
| 找不到数据后台入口 | 正常：前台不提供入口，直接在浏览器地址栏输入 `/admin.html`；后台页面带 `noindex`、`robots.txt` 也禁止收录，但可以手动访问。 |
| 后台登录失败 | ① 账号是否存在：去 Supabase → Authentication → Users 创建邮箱账号并确认邮箱；② 邮箱 / 密码是否正确；③ `config.js` 的 `supabase.url` 与 `anonKey` 是否来自同一个项目；④ 当前 `backend` 是否为 `'supabase'`（`local` 模式后台不用登录，`custom` 模式后台不支持）。 |
| 后台提示登录已过期 / 401 | 会话过期会自动回到登录页，重新登录即可；后台会自动尝试刷新 token。 |
| 后台能登录但看不到数据 / 403 | RLS 权限问题：需要给 `authenticated` 开 `select`（`auth_can_read`）才能读，删除还需要 `delete`（`auth_can_delete`）。按 `supabase/schema.sql` 检查策略，修好后重新登录并刷新。 |
| 后台删除失败 | 同上，检查 `auth_can_delete`；删除不可恢复，先导出 CSV / JSON 备份。 |
| 想单独看某一份答卷的答案 | 在后台答卷表格里点该行的「查看」（也可以点整行），弹层里能看到该份的 16 题所选答案、四维得分和匹配信息；右上角 ×、点遮罩或按 ESC 可关闭。 |
| 分享链接前缀不对 | 改 `config.js` 的 `site.publicUrl`，改成正式地址并保留末尾 `/`，提交推送后重新复制链接。 |
| 旧链接打不开 / 显示旧版提示 | 形如 `?result=EWSP` 的旧版 16 型链接已下线，页面会提示「旧版 16 型结果已经下线」并引导重新测试；新版分享链接是 `?type=<slug>`。 |
| 数据没进 Supabase | 打开开发者工具看 `POST /rest/v1/ai_personality_responses` 是否报错；核对 `config.js` 的 URL / anon key / 表名，确认表存在、RLS 的匿名 insert 策略还在。也可以先打开 `/admin.html` 看有没有新记录。表结构没变时**不需要重跑 `schema.sql`**。 |
| 本地预览写脏了线上数据 | 预览时加 `--force-local`；已经写入的记录可以打开 `/admin.html` 删除（或去 Supabase 控制台按时间清理）。 |
| PowerShell 里 `npm test` 报「禁止运行脚本」 | 用 `npm.cmd test`，或直接 `node tests/*.mjs`。 |
| `node tests/e2e.mjs` / `node tests/admin-e2e.mjs` 提示找不到浏览器 | 安装 Chrome 或 Edge 后重试；这些测试跳过不影响其它检查。 |
| 改了 JS/CSS 线上没生效 | 检查是否升了 `index.html` / `admin.html` 里的 `?v=`，再强刷；Pages 发布本身也有 1–3 分钟延迟。 |

## 免责声明

本测试仅供趣味性的自我探索参考，不是心理诊断，也不是科学的人格概率或能力评级。8 种机体是协作风格的典型画像，没有高低优劣。作答数据的用途与范围以首屏隐私告知为准；如不希望提交数据，可在 `config.js` 中关闭对应采集开关，或把 `backend` 改为 `local`。
