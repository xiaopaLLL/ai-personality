# AI 人格测试 · 网页 + 数据后台

一个**纯静态、零构建**的在线测试网站：访客做 16 道选择题 → 得到自己的「AI 人格」类型 → 作答数据自动汇入你自己的后台，可以看统计、导 Excel/CSV。

- 前台：`index.html`（首屏 → 逐题作答 → 结果卡片 → 分享链接）
- 后台：`admin.html`（KPI、16 型分布、四维度分布、14 天趋势、单题选项分布、明细、CSV/JSON 导出）
- 问卷：`assets/js/questions.js`（**你要改题目只改这一个文件**）
- 数据：`config.js` 一个开关切换 3 种后端（本地 / Supabase / 自定义接口）
- 没有 npm、没有打包、没有任何外部 CDN 依赖 → 丢到 GitHub Pages 就能跑

---

## 0. 三种上线方案，先选一个

| 方案 | 前端 | 数据后台 | 费用 | 后台看统计 | 适合 |
| --- | --- | --- | --- | --- | --- |
| **A（推荐）** | GitHub Pages | Supabase（Postgres） | 免费额度足够 | `admin.html` 直接看 | 想省事、想有正规后台 |
| B | GitHub Pages | Google Apps Script + 表格 | 免费 | 直接看 Google 表格，也可接 `admin.html` | 不想注册新服务 |
| C | Cloudflare Pages | Cloudflare Worker + KV | 免费 | `admin.html` 直接看 | 仓库想设为私有、想用自己的域名 |

下面第 1~6 章走**方案 A**（最完整），第 7、8 章是方案 B / C 的替换步骤。

部署完你会拿到这样的网址：`https://你的用户名.github.io/仓库名/`，或你自己的域名 `https://test.你的域名.com/`。

---

## 1. 本机先跑起来（1 分钟）

**方式一（最快）**：直接双击 `index.html`。默认 `backend: 'local'`，可以完整答题、看结果，数据只存在你自己浏览器里。

**方式二（推荐，和线上环境一致）**：

```powershell
cd D:\xiaopaLLL\MBAItest
python -m http.server 8000
# 浏览器打开 http://localhost:8000
```

> 注意：不要用 `file://` 方式测 Supabase/自定义接口（浏览器会拦跨域）。测数据链路一定要用 http 服务器。

跑一下自检（可选，确认你没改坏东西）：

```powershell
npm test          # 一次跑完全部 4 套测试（需要装 Node.js；没有 npm 也可以直接 node）
# 如果 PowerShell 提示"禁止运行脚本"（npm.ps1 被执行策略拦住），改用 npm.cmd test，
# 或者直接一条条 node 跑下面这些：
node tests/engine.test.mjs    # 计分引擎 / 数据层 逻辑测试（20 项）
node tests/smoke.mjs          # 页面与静态资源冒烟测试（21 项）
node tests/e2e.mjs            # 真实浏览器：答题→落库→后台统计→删除（53 项）
node tests/e2e-supabase.mjs   # 真实浏览器 + 模拟 Supabase：提交→登录→读数据→删除→故障诊断（41 项）
node tests/check-supabase.mjs # 体检你自己的 Supabase 配置（只读，不会写数据）
```

> 两个 E2E 测试用的服务器会带 `--force-local`，**强制 local 模式**，即使你已经把 `config.js`
> 改成 `supabase`，自动化测试也绝不会把假数据写进你的线上数据库。

---

## 2. 改成你自己的问卷（你要的「之后我也能修改」）

只改 **`assets/js/questions.js`** 一个文件，不需要动任何其他代码。

### 2.1 加/删/改题目

```js
{
  id: 'q17',                                  // 唯一编号，加题就往下排
  text: '你更愿意把 AI 用在什么地方？',        // 题干
  options: [
    { text: '选项文字 A', scores: { drive: 2, order: -1 } },
    { text: '选项文字 B', scores: { drive: -2, order: 1 } },
    { text: '选项文字 C', scores: { role: 1 } }
  ]
}
```

**打分规则**（4 个维度，正分靠左、负分靠右）：

| key | 正分（+） | 负分（−） | 含义 |
| --- | --- | --- | --- |
| `drive` | E 探索派 | D 交付派 | 先试错探索，还是先定目标交付 |
| `heart` | W 共情派 | L 逻辑派 | 先对齐感受，还是只看信息准确 |
| `order` | S 结构派 | I 灵感派 | 靠流程复利，还是靠临场灵感 |
| `role` | P 主导派 | C 副驾派 | 我定方向，还是它给方案我掌舵 |

- 数值大小只代表「倾向强度」，程序会按每题的理论最高/最低分自动归一化，你把 `2` 改成 `3` 不会让百分比失真。
- 每个维度至少留 3~4 道题，结果才稳定；题目总数建议保持 12~20 题（人不会中途跑掉）。
- 删题、换顺序、改文字都随意，`id` 不要重复。

### 2.2 改站点文案

同一个文件顶部的 `meta` 里：

| 字段 | 作用 |
| --- | --- |
| `title` / `subtitle` | 网站标题、副标题 |
| `intro` | 首屏说明（`\n` 可换行） |
| `estimated` | 「约 3 分钟」这类提示 |
| `privacyNote` | 提交前的隐私告知（合规用） |
| `requireConsent` | `true` 时必须勾选同意才能开始 |
| `askNickname` | 是否让访客填昵称 |
| `footerNote` | 结果页底部备注 |

### 2.3 改人格类型文案

`assets/js/personality.js` 里的 `TYPES` 对象：16 个四字代码（如 `EWSP`）各对应 `name / emoji / tagline / desc / strengths / watch / tips`。改文案随便改，**不要改 key**（key 是维度字母拼出来的）。

### 2.4 改完必做一步

把 `questions.js` 里 `meta.version` 从 `v1.0` 改成 `v1.1`。这样后台能看到每条数据是哪一版问卷答的，方便你对比改版效果。

然后重新推送到 GitHub（见第 4 章），访客刷新即可看到新问卷。

---

## 3. 建立数据后台（Supabase，免费，约 10 分钟）

### 3.1 注册并新建项目

1. 打开 <https://supabase.com> → 右上角 **Start your project** → 用 GitHub 或邮箱注册。
2. 控制台点 **New project**：
   - Name：`ai-personality`
   - Database Password：点 **Generate a password**，复制保存（后面基本用不到，但别丢）
   - Region：选 **Southeast Asia (Singapore)**（国内访问相对快）
   - Plan：Free
3. 等 1~2 分钟项目初始化完成。

### 3.2 建表 + 配权限（复制粘贴即可）

1. 左侧菜单 **SQL Editor** → **New query**。
2. 打开本项目里的 `supabase/schema.sql`，**全选复制**，粘贴进去。
3. 点右下角 **Run**，看到 `Success` 就好了。

这一步做完了 4 件事：

| 做的事 | 意义 |
| --- | --- |
| 建表 `ai_personality_responses` | 问卷数据存这里 |
| 开启 RLS | 行级安全 |
| 匿名访客**只能插入** | 前端提交答卷 |
| 登录用户**可读可删** | 只有你的后台账号能看数据 |

> 所以 `anon key` 放在前端页面里是**安全且官方设计如此**的：别人拿到它也只能往表里写，读不到任何人的作答。
> ⚠️ 绝对不要把 **`service_role` key** 写进 `config.js` 或推到 GitHub —— 那个 key 能绕过 RLS 读全表。

### 3.3 拿 URL 和 anon key

左侧 **Project Settings（齿轮）→ API**：

- **Project URL**：`https://xxxxxxxxxxxx.supabase.co`
- **Project API keys → `anon` `public`**：`eyJhbGciOi...`（很长一串）

### 3.4 建你的后台账号

左侧 **Authentication → Users → Add user → Create new user**：

- Email：你自己的邮箱
- Password：设一个强密码
- 勾选 **Auto Confirm User**（否则要邮箱验证）

这个邮箱密码就是 `admin.html` 的登录账号。

### 3.5 填 `config.js`

```js
window.APP_CONFIG = {
  backend: 'supabase',                                  // ← 从 'local' 改成 'supabase'
  supabase: {
    url: 'https://xxxxxxxxxxxx.supabase.co',             // ← 粘贴 Project URL
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6...',          // ← 粘贴 anon public key
    table: 'ai_personality_responses'
  },
  site: {
    name: 'AI 人格测试',
    publicUrl: ''                                        // ← 部署后填正式网址（第 4.6 步）
  },
  ...
};
```

### 3.6 本地验证数据链路（重要）

1. 起本地服务器：`python -m http.server 8000`
2. 打开 <http://localhost:8000>，做完一次测试，结果页应显示「✅ 作答数据已记录」。
3. 打开 <http://localhost:8000/admin.html>，用 3.4 建的邮箱登录，应该能看到 1 条记录。

看到数据 = 链路通了，可以上线。

**（可选）用 SQL 直接核对**：SQL Editor 里跑

```sql
select created_at, result_code, result_name, nickname, duration_ms
from public.ai_personality_responses
order by created_at desc limit 20;
```

---

## 4. 部署到 GitHub Pages（拿到公开网址）

### 4.1 新建仓库

打开 <https://github.com/new>：Repository name 填 `ai-personality`，选 **Public**（免费账号的 Pages 只支持公开仓库；要私有仓库请看第 8 章方案 C），**不要**勾 Add README，点 Create。

### 4.2 推送代码（命令行）

在 PowerShell 里逐段执行：

```powershell
cd D:\xiaopaLLL\MBAItest

git init
git add .
git commit -m "AI 人格测试：问卷 + 前台 + 数据后台"

git branch -M main
git remote add origin https://github.com/你的用户名/ai-personality.git
git push -u origin main
```

第一次推送会弹浏览器让你登录 GitHub 授权，按提示走完即可。

> 如果你用了方案 B/C，`config.js` 里的 `custom.endpoint` 也是可以公开的；但**任何 token/密钥都不要写进前端文件**。

### 4.3 或者用网页上传（不想装 git）

GitHub 仓库页 → **Add file → Upload files** → 把 `index.html`、`admin.html`、`config.js`、`assets/`、`supabase/`、`deploy/`、`README.md`、`.nojekyll` 全部拖进去 → Commit changes。
（注意保持目录结构，`assets/js/...` 不能拍平。）

### 4.4 打开 Pages

仓库 → **Settings → Pages**：

- **Source**：`Deploy from a branch`
- **Branch**：`main`，目录 `/ (root)` → **Save**

等 1~2 分钟（Actions 里能看到 "pages build and deployment" 跑完）。

### 4.5 访问你的网站

```
https://你的用户名.github.io/ai-personality/
```

手机、电脑各打开一次，完整做一遍测试，确认：
- 结果页显示「✅ 作答数据已记录」
- `https://你的用户名.github.io/ai-personality/admin.html` 登录后能看到这两条数据

> 项目里已经放了 `.nojekyll` 空文件：它让 GitHub Pages 跳过 Jekyll 处理，避免某些文件被忽略。

### 4.6 回填正式网址（让分享链接正确）

`config.js` 里：

```js
site: { name: 'AI 人格测试', publicUrl: 'https://你的用户名.github.io/ai-personality/' }
```

改完再推一次：

```powershell
git add config.js
git commit -m "填正式网址"
git push
```

这样结果页的「复制分享链接」才会生成 `...?result=EWSP` 这种能被朋友打开的形式。

### 4.7 上线验收清单

- [ ] 首页打开无样式错乱（手机 + 电脑）
- [ ] 16 题都能答，能返回上一题，键盘 1/2/3 可用
- [ ] 结果页出现类型卡、四维度条、优势/盲点/建议
- [ ] 刷新后「继续上次作答」可用
- [ ] 结果页显示「✅ 作答数据已记录」
- [ ] `admin.html` 能看到刚才的记录，导出 CSV 成功
- [ ] 分享链接能在无痕窗口打开（显示朋友的类型）
- [ ] `admin.html` 在搜索引擎里搜不到（已加 `noindex`）

---

## 5. 绑定自己的域名（可选，但推荐）

### 5.1 买域名

阿里云 / 腾讯云 / Namecheap / Cloudflare Registrar 都行，`.top` `.xyz` 一年十几块。

### 5.2 加 CNAME 文件

在仓库根目录新建一个**文件名就叫 `CNAME`**（无扩展名）的文件，内容只有一行：

```
test.你的域名.com
```

### 5.3 配置 DNS 解析

**情况 A：用顶级域名（`你的域名.com`）** → 加 4 条 A 记录：

| 类型 | 主机记录 | 记录值 |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

**情况 B：用子域名（`test.你的域名.com`，推荐）** → 加 1 条 CNAME：

| 类型 | 主机记录 | 记录值 |
| --- | --- | --- |
| CNAME | test | 你的用户名.github.io |

> 如果 DNS 托管在 Cloudflare：把这条记录的**橙色云朵点成灰色（DNS only）**，否则 GitHub 可能签不下 HTTPS 证书。证书签发成功后想再开代理也行。

### 5.4 在 GitHub 里填域名

仓库 → **Settings → Pages → Custom domain**：填 `test.你的域名.com` → **Save** → 等 DNS check 通过（几分钟到 24 小时）→ 勾上 **Enforce HTTPS**。

### 5.5 更新配置

```js
site: { publicUrl: 'https://test.你的域名.com/' }
```

推上去即可。原 `github.io` 网址会自动 301 跳转到你的域名。

---

## 6. 日常使用：看统计 / 导数据

打开 `https://你的网址/admin.html`，用 Supabase 里建的邮箱登录：

| 区块 | 能看什么 |
| --- | --- |
| KPI 卡片 | 总作答数、今天新增、平均用时、最热人格、填了昵称的人数 |
| 人格类型分布 | 16 型各占多少、占比百分比 |
| 四维度倾向 | 每个维度左右两派的占比 + 平均倾向分 |
| 14 天趋势 | 每天多少人作答 |
| 单题选项分布 | 每道题各选项被选中的次数（哪题没人选 → 该题区分度差，可以改） |
| 作答明细 | 时间/类型/昵称/用时/四维度；点「详情」看每道题的原始选择、设备、来源页；可删除 |

筛选：时间区间（今天 / 7 天 / 30 天 / 自定义）、类型、关键词搜索；支持「合并本机数据」（把 `localStorage` 里暂存/导入的数据一起统计）。

导出：**导出 CSV**（Excel 直接双击打开，已处理中文 BOM）、**导出 JSON**（做二次分析）；**导入 JSON** 可以把导出的数据合进本机视图。

### 直接用 SQL 查（在 Supabase SQL Editor）

```sql
-- 各类型人数
select result_code, result_name, count(*) as n
from public.ai_personality_responses group by 1,2 order by 3 desc;

-- 每天多少人
select date_trunc('day', created_at)::date as day, count(*)
from public.ai_personality_responses group by 1 order by 1 desc;

-- 某道题（q05）的选项分布
select answers->>'q05' as option_index, count(*)
from public.ai_personality_responses group by 1 order by 1;
```

### 自由额度参考（Supabase Free）

500 MB 数据库 / 每月 5 GB 出网流量。一条记录约 1~2 KB，**大约能存 20~30 万份答卷**，个人测试完全够用。
注意：免费项目连续 7 天没有任何请求会被暂停（暂停后在控制台点 Restore 即可，数据不丢）。

---

## 7. 方案 B：不想用 Supabase，就用 Google 表格

1. 打开 <https://sheets.new> 新建表格，命名 `AI人格测试数据`。
2. 菜单 **扩展程序 → Apps Script**。
3. 把 `deploy/apps-script.gs` 全部粘贴进去，覆盖默认内容；把里面的 `ADMIN_TOKEN` 改成你自己的长随机字符串；保存。
4. 右上 **部署 → 新建部署 → 类型：Web 应用**：
   - 执行身份：**我**
   - 谁可以访问：**任何人**（必须选这个，否则收不到数据）
   - 部署 → 授权（提示「未验证应用」时点 高级 → 继续前往）
5. 复制生成的网址（`https://script.google.com/macros/s/AKfy.../exec`）。
6. 改 `config.js`：

```js
backend: 'custom',
custom: {
  endpoint: 'https://script.google.com/macros/s/AKfy.../exec',
  adminUrl: 'https://script.google.com/macros/s/AKfy.../exec',   // 同一网址
  adminToken: '和第 3 步的 ADMIN_TOKEN 一致'
}
```

之后：数据实时进 Google 表格；打开 `admin.html` 也能看到同一套统计图。改问卷不影响表格结构（每题的选择存成 JSON 字段）。

---

## 8. 方案 C：Cloudflare Pages（仓库可以设为私有）

1. 注册 <https://dash.cloudflare.com>。
2. **Workers & Pages → KV → Create namespace**，名字 `AI_PERSONALITY`。
3. **Workers & Pages → Create → Worker**，名字 `ai-personality-api` → Edit code，把 `deploy/cloudflare-worker.js` 粘进去 → Deploy。
4. 该 Worker → **Settings**：
   - Variables and Secrets → 加 Secret：`ADMIN_TOKEN = 你的长随机串`
   - Bindings → 加 KV Namespace Binding：变量名 `AI_PERSONALITY` → 选第 2 步的 namespace
   - 改完再 Deploy 一次
5. 记下 Worker 地址（`https://ai-personality-api.xxx.workers.dev`），填进 `config.js`：

```js
backend: 'custom',
custom: {
  endpoint: 'https://ai-personality-api.xxx.workers.dev',
  adminUrl: 'https://ai-personality-api.xxx.workers.dev/admin',
  adminToken: '与 ADMIN_TOKEN 相同'
}
```

6. 部署前端：**Workers & Pages → Create → Pages → Connect to Git** → 选你的私有仓库：
   - Framework preset：`None`
   - Build command：留空
   - Build output directory：`/`
   保存后得到 `https://ai-personality.pages.dev`，并可在 **Custom domains** 里绑定自己的域名（Cloudflare 会自动配好 DNS 和 HTTPS）。

---

## 9. 常见问题排查

> **先做这一步**：打开 `admin.html` 点 **「运行诊断」**（登录页和看板右上角都有）。它会逐项检查
> backend / URL / key 结构 / 网络 / 数据表 / RLS / 账号密码，直接告诉你哪一项是红的、该怎么修。
> 也可以在终端跑 `node tests/check-supabase.mjs`（只读，不会写入任何数据）。

| 症状 | 原因 | 解决 |
| --- | --- | --- |
| **后台一直提示「登录失败」**（新手最容易踩） | ① **anonKey 被复制残缺**（多一个/少一个字符）→ Supabase 对**所有**请求返回 `401 Invalid API key`，登录接口同样不通；② 账号没建，或建的时候没勾 Auto Confirm（邮箱未确认）；③ 密码错；④ URL 和 anonKey 不是同一个项目 | ① 看诊断里的「anonKey 签名长度」：必须是 **32 字节 / 43 个字符**（整把 key 通常 200+ 字符）。长度不对 = 复制残缺，回 Project Settings → API Keys 重新完整复制；② Authentication → Users 新建用户并勾 **Auto Confirm User**，或对已有用户点「…」→ **Confirm email**；③ 对用户 Reset password 重设密码；④ 两个值都从同一个项目重新复制 |
| 登录成功后进不去看板 / 又被弹回登录页 | 旧版本会把「读数据失败」误报成登录失败（已修复）。真实原因通常是数据表不存在或 RLS 读策略缺失 | 看板顶部现在会明确写出「数据表不存在 → 跑 schema.sql」；重跑 `supabase/schema.sql` 后退出重新登录 |
| 提示 `Invalid API key` | 同上第 ① 项；也可能是项目已停用 legacy JWT key | 改用控制台里的新版密钥（`sb_publishable_…`）或重新复制 legacy anon 公钥。诊断面板会显示 key 的 role / ref / 有效期 |
| 诊断里 role = `service_role` | 把 service_role 密钥填到了前端 | 立刻换回 anon public / `sb_publishable_…`，并在控制台**轮换（rotate）**刚才泄露的 service_role 密钥 |
| 结果页显示「未接入后台」 | `config.js` 里 `backend` 还是 `local` | 改成 `'supabase'` 并填 url/anonKey |
| 结果页显示「已暂存，下次补传」 | 网络抖动或网址写错 | 检查 `supabase.url` 是否 `https://` 开头、表名是否一致；数据会在下次打开页面时自动补传 |
| 提交后后台没数据 | RLS 策略没跑 / 表名不一致 | 重跑 `supabase/schema.sql`；核对 `config.js` 的 `table` |
| 后台登录报 `Invalid login credentials` | 账号没建或密码错 | Authentication → Users 里新建，勾 Auto Confirm |
| 后台登录后列表 401/403 | 未登录或登录过期 | 退出重新登录；确认 RLS 里 `auth_can_read` 策略存在 |
| `admin.html` 打开是 404 | 文件名大小写或路径错 | 线上是 Linux，严格区分大小写；确认文件在仓库根目录 |
| 页面没样式 | 资源路径写成 `/assets/...` 了 | 本项目全部用相对路径（`assets/...`），子目录部署才正常 |
| 改了 `config.js` 线上没变化 | 浏览器/GitHub Pages 缓存 | `Ctrl+F5` 强刷；Pages 构建约需 1~2 分钟 |
| Pages 上是旧版本 | 推送没成功 / 构建还在跑 | 看仓库 Actions 标签页，等绿色对勾 |
| 手机上按钮太小 | —— | 已做响应式，`< 560px` 会自动切换单列布局；如不满意改 `assets/css/style.css` 的媒体查询 |
| Excel 打开 CSV 中文乱码 | —— | 已加 UTF-8 BOM，正常双击即可；若仍乱码选「数据 → 自文本导入 → UTF-8」 |
| 有人恶意刷数据 | 公开接口无法完全防 | 后台可手动删除；或加 Cloudflare Turnstile；或按 `duration_ms < 3000` 的记录批量清理（见 `schema.sql` 末尾） |
| Supabase 项目被暂停 | 免费项目 7 天无请求 | 控制台 Restore，数据不丢 |

### 9.1 怎么一眼看出 anonKey 有没有复制坏

一把正常的 Supabase legacy anon key 长这样：三段用 `.` 分隔，最后一段**正好 43 个字符**。

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 . eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6... . <43 个字符>
         header（36 字符）                       payload（约 127 字符）                  signature
```

`node tests/check-supabase.mjs` 会直接把它算出来告诉你：

```
✅ 签名长度：32 字节（应为 32 字节 / 43 个字符，当前 43 个字符）   ← 正常
❌ 签名长度：33 字节（应为 32 字节 / 43 个字符，当前 44 个字符）   ← 复制多了/少了一个字符
```

---

## 10. 数据与合规

- **收集了什么**：每题的选项、结果类型、四维度得分、作答耗时，以及浏览器默认发送的设备信息（User-Agent、来源页、语言、屏幕尺寸、时区）。**不收集**姓名、手机号、邮箱、IP 落库（Supabase 侧日志另计）。
- 首屏有隐私告知，且必须勾选同意才能开始（`meta.requireConsent`）。
- 想彻底不收集设备信息：把 `config.js` 里 `collect` 下对应开关改成 `false`；想不记录耗时就把 `duration: false`。
- 想改成完全匿名：同时把 `meta.askNickname` 设为 `false`。
- 上线建议加一句「本测试仅供自我探索，不是心理测评」——结果页底部已有默认文案。
- `anon key` 公开是设计如此，安全性由 RLS 保证；**`service_role` key 永远不要进前端**。
- 后台默认 `noindex, nofollow`，并且仓库里已经带了 `robots.txt`（禁止收录 `admin.html` 和 `tests/`）。
- 前台页脚有一个「数据后台」入口方便你自己进入；如果不想让访客看到这个入口，把 `index.html` 里 `<div id="footerLinks">…</div>` 整段删掉即可（后台网址照样能直接访问，只是不再露出）。

---

## 11. 文件清单

| 路径 | 作用 | 你需要改吗 |
| --- | --- | --- |
| `index.html` | 前台页面 | 一般不用 |
| `admin.html` | 数据后台页面 | 一般不用 |
| `config.js` | **后端与站点配置** | ✅ 部署时必改 |
| `assets/js/questions.js` | **问卷题目 + 文案** | ✅ 想改题目时改这里 |
| `assets/js/personality.js` | 计分引擎 + 16 型人格文案 | 改类型文案时才动 |
| `assets/js/app.js` | 前台交互逻辑 | 一般不用 |
| `assets/js/admin.js` | 后台统计逻辑 | 一般不用 |
| `assets/js/store.js` | 数据层（三种后端 + 重传队列 + CSV） | 一般不用 |
| `assets/css/style.css` | 前台样式 | 想做视觉定制时改 |
| `assets/css/admin.css` | 后台样式 | 同上 |
| `supabase/schema.sql` | 建表 + 权限脚本 | 建库时跑一次 |
| `deploy/apps-script.gs` | 备选后端（Google 表格） | 用方案 B 时用 |
| `deploy/cloudflare-worker.js` | 备选后端（Cloudflare Worker） | 用方案 C 时用 |
| `tests/engine.test.mjs` | 计分与数据层逻辑自检（20 项） | 改完问卷可跑一次 |
| `tests/smoke.mjs` | 页面与资源冒烟自检（21 项） | 同上 |
| `tests/e2e.mjs` + `tests/e2e.html` | 真实浏览器端到端（53 项） | 想验证交互时跑 |
| `tests/e2e-supabase.mjs` + `tests/mock-server.mjs` | Supabase 链路端到端（41 项，含各种登录失败场景与诊断） | 验证云端链路时跑 |
| `tests/check-supabase.mjs` | **配置体检工具**（读 config.js，只读地检查 key / 表 / RLS） | 登录不上时先跑这个 |
| `tests/browser-run.mjs` | 浏览器测试公共工具（端口/进程/解析） | 不用管 |
| `tests/serve.mjs` | 本地静态服务器（`npm run serve`；`--force-local` 供测试隔离真实数据库） | 本地预览用 |
| `tests/screenshots.mjs` + `tests/screenshots/` | 一键生成预览截图（含诊断面板） | 想看视觉效果时跑 |
| `package.json` | 只是给 `npm test` 用的脚本，无任何依赖 | 不用管 |
| `robots.txt` | 不让搜索引擎收录后台 | 别删 |
| `.nojekyll` | 让 GitHub Pages 跳过 Jekyll | 别删 |

---

## 12. 一句话版部署流程

```powershell
# 1) 本地改好 config.js（backend + Supabase url/anonKey）
# 2) 本地验证：npm run serve → 答题 → admin.html 看到数据
# 3) 推到 GitHub
cd D:\xiaopaLLL\MBAItest
git init; git add .; git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/ai-personality.git
git push -u origin main
# 4) GitHub 仓库 Settings → Pages → main /(root) → Save
# 5) 打开 https://你的用户名.github.io/ai-personality/
# 6) 把该网址填回 config.js 的 site.publicUrl，再 push 一次
```

---

## 13. 附录：`APP_CONFIG_OVERRIDE`（多环境部署用）

如果同一份代码要分别部署到「测试环境」和「生产环境」，可以在 `config.js` **之前**插入一段脚本覆盖配置，不用改 `config.js` 本身：

```html
<script>
  window.APP_CONFIG_OVERRIDE = {
    backend: 'supabase',
    supabase: { url: 'https://测试项目.supabase.co', anonKey: 'xxx' }
  };
</script>
<script src="config.js"></script>
```

自动化测试（`tests/mock-server.mjs`）就是用这个机制把前端指向模拟 Supabase 的。
