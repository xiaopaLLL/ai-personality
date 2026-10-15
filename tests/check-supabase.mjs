/**
 * 配置体检工具（只读，不会写入任何数据）：
 *     node tests/check-supabase.mjs
 * 直接读 config.js，然后：
 *   1) 本地检查 anonKey 有没有被复制残缺、是否用错项目的 key、是否误用 service_role；
 *   2) 联网访问你的 Supabase 项目（只发 GET），确认 key 有效、数据表是否存在、RLS 是否生效。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');

/* ---------------- 读出 config.js 里的配置 ---------------- */
const sandbox = { window: {}, console };
sandbox.window.APP_CONFIG = null;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8'), sandbox, { filename: 'config.js' });
const CFG = sandbox.window.APP_CONFIG || {};

const backend = CFG.backend || 'local';
const url = String((CFG.supabase || {}).url || '').trim().replace(/\/+$/, '');
const key = String((CFG.supabase || {}).anonKey || '').trim();
const table = (CFG.supabase || {}).table || 'ai_personality_responses';

const OK = (s) => '✅ ' + s;
const BAD = (s) => '❌ ' + s;
const WARN = (s) => '⚠️  ' + s;
const mask = (k) => (k.length > 28 ? k.slice(0, 18) + '…' + k.slice(-6) + '（共 ' + k.length + ' 字符）' : k || '（空）');

console.log('═══════════ AI 人格测试 · 配置体检 ═══════════\n');
console.log('backend = ' + backend);
console.log('url     = ' + (url || '（空）'));
console.log('anonKey = ' + mask(key));
console.log('table   = ' + table + '\n');

/* ---------------- 1. 本地检查 key ---------------- */
console.log('── 1. anonKey 本地体检（不需要联网）──');
let keyFatal = false;
const b64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4), 'base64');

if (!key) {
  console.log(BAD('anonKey 是空的：去 Project Settings → API Keys 复制 Project API key'));
  keyFatal = true;
} else if (/^sb_secret_/.test(key)) {
  console.log(BAD('这是 sb_secret_ 密钥，权限等同 service_role，绝不能放前端！请换成 sb_publishable_ 或 anon 公钥'));
  keyFatal = true;
} else if (/^sb_publishable_/.test(key)) {
  console.log(OK('新版 publishable key 格式'));
} else if (key.slice(0, 3) !== 'eyJ') {
  console.log(BAD('看起来不是 Supabase 的 key（应以 eyJ… 或 sb_publishable_ 开头）'));
  keyFatal = true;
} else {
  const parts = key.split('.');
  if (parts.length !== 3) {
    console.log(BAD('JWT 应有 3 段，实际 ' + parts.length + ' 段 → 复制不完整'));
    keyFatal = true;
  } else {
    let payload = null;
    try { payload = JSON.parse(b64url(parts[1]).toString('utf8')); } catch (e) { payload = null; }
    const sigBytes = b64url(parts[2]).length;
    console.log((sigBytes === 32 ? OK : BAD)('签名长度：' + sigBytes + ' 字节（应为 32 字节 / 43 个字符，当前 ' + parts[2].length + ' 个字符）'));
    if (sigBytes !== 32) {
      keyFatal = true;
      console.log('     ↳ 这个 key 复制残缺了（多一个或少一个字符）。Supabase 会对所有请求返回 401 Invalid API key，');
      console.log('       登录接口同样调不通 —— 表现就是「后台一直登录失败」。请回 Project Settings → API Keys 重新完整复制。');
    }
    if (!payload) {
      console.log(BAD('JWT 内容解析不出来 → 重新复制'));
      keyFatal = true;
    } else {
      console.log('     角色 role = ' + (payload.role || '未知') + '，项目 ref = ' + (payload.ref || '未知') +
        '，有效期至 ' + (payload.exp ? new Date(payload.exp * 1000).toLocaleString() : '未知'));
      if (payload.role === 'service_role') {
        console.log(BAD('这是 service_role key！它能绕过权限读全表，绝不能放前端 → 换成 anon public / publishable key'));
        keyFatal = true;
      }
      const m = /^https:\/\/([a-z0-9-]+)\.supabase\.(co|in)$/i.exec(url);
      if (m && payload.ref && m[1] !== payload.ref) {
        console.log(BAD('key 和 URL 不是同一个项目：key.ref=' + payload.ref + '，url 子域=' + m[1]));
        keyFatal = true;
      } else if (m && payload.ref) {
        console.log(OK('key 和 URL 属于同一个项目（' + payload.ref + '）'));
      }
    }
  }
}

/* ---------------- 2. 联网检查 ---------------- */
async function probe(name, u, opt) {
  try {
    const res = await fetch(u, opt);
    const t = await res.text();
    let json = null;
    try { json = JSON.parse(t); } catch (e) { json = null; }
    return { status: res.status, text: t, json };
  } catch (e) {
    return { error: e.message };
  }
}

console.log('\n── 2. 联网检查（只发 GET，不会写入任何数据）──');
if (backend !== 'supabase') {
  console.log(WARN('backend 不是 supabase，跳过联网检查（当前模式：' + backend + '）'));
} else if (!url || !key) {
  console.log(WARN('url 或 anonKey 为空，跳过联网检查'));
} else {
  const root = await probe('root', url + '/rest/v1/', { headers: { apikey: key } });
  let keyRejected = false;
  if (root.error) {
    console.log(BAD('连不上 ' + url + ' → ' + root.error));
    console.log('     ↳ 检查网址拼写、网络/代理；免费项目 7 天无请求会被暂停，去 Supabase 控制台看是否需要 Restore');
    keyRejected = true;
  } else if (root.status === 200) {
    console.log(OK('anonKey 有效（REST 接口可访问）'));
  } else if (root.status === 401) {
    console.log(BAD('anonKey 被拒绝：HTTP 401 ' + (root.json && root.json.message ? root.json.message : '')));
    console.log('     ↳ 重新复制 key；或该项目已停用 legacy JWT key，请改用控制台里的 sb_publishable_… 密钥');
    keyRejected = true;
  } else {
    console.log(WARN('REST 根路径返回 HTTP ' + root.status + '：' + root.text.slice(0, 120)));
  }

  const t = await probe('table', url + '/rest/v1/' + encodeURIComponent(table) + '?select=id&limit=1', { headers: { apikey: key } });
  if (t.error) {
    console.log(BAD('查询数据表失败：' + t.error));
  } else if (keyRejected) {
    console.log(WARN('数据表状态无法判断（key 无效，所有请求都是 401）→ 先把 key 修好再体检一次'));
  } else if (t.status === 404 || (t.json && t.json.code === 'PGRST205')) {
    console.log(BAD('数据表 ' + table + ' 不存在 → 打开 Supabase → SQL Editor → 把 supabase/schema.sql 全文粘贴 → Run'));
  } else if (t.status === 401 || t.status === 403) {
    console.log(OK('数据表存在，且 RLS 生效（匿名读不到，这是正确的）'));
  } else if (t.status === 200) {
    console.log(WARN('anon key 竟然能读到表数据 → RLS 没配好，别人也能看到答卷，请重跑 supabase/schema.sql'));
  } else {
    console.log(WARN('查询数据表返回 HTTP ' + t.status + '：' + t.text.slice(0, 120)));
  }

  const a = await probe('auth', url + '/auth/v1/health', { headers: { apikey: key } });
  if (a.error) console.log(BAD('Auth 服务连不上：' + a.error));
  else if (a.status === 200) console.log(OK('Auth 服务正常（登录接口可用）'));
  else if (keyRejected) console.log(WARN('Auth 服务状态无法判断（key 无效）'));
  else console.log(BAD('Auth 服务返回 HTTP ' + a.status + '：' + a.text.slice(0, 120)));
}

console.log('\n── 结论 ──');
if (keyFatal) {
  console.log('anonKey 有问题：先按上面的红色提示改好 config.js，再运行一次本工具。');
} else if (backend === 'supabase') {
  console.log('配置层面没发现问题。如果后台还是登录失败，那就是「账号」问题：');
  console.log('  · Authentication → Users 里建了用户吗？建的时候勾了 Auto Confirm User 吗？');
  console.log('  · 密码对不对？可以在 Users 里对该用户 Reset password 重设一个。');
  console.log('  · 打开 admin.html 点「运行诊断」，把邮箱密码填进去，它会直接告诉你账号能不能登录。');
} else {
  console.log('当前是 ' + backend + ' 模式，不需要登录后台（后台会直接显示本机数据）。');
}
