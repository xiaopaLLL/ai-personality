/**
 * 模拟 Supabase 的测试服务器：把静态站点和 PostgREST/Auth 接口放在同一个端口上，
 * 用来在没有真实 Supabase 项目的情况下，跑通「提交答卷 → 登录后台 → 读数据 → 删除」全链路。
 * 只用于自动化测试，不影响线上代码。
 *
 *   node tests/mock-server.mjs 8155
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.argv[2] || 8155);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TABLE = 'ai_personality_responses';
const ADMIN_EMAIL = 'admin@test.com';
const ADMIN_PWD = 'secret123';
const ACCESS_TOKEN = 'ACCESS_TOKEN_TEST';

/* 造一个「结构正确」的假 anon key：43 字符签名 = 正好 32 字节，
   这样前台/后台里那些「key 是否被复制残缺」的离线检查都能走到正常分支。 */
function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }
const ANON_KEY = b64url({ alg: 'HS256', typ: 'JWT' }) + '.' +
  b64url({ iss: 'supabase', ref: 'mockproject', role: 'anon', iat: 1700000000, exp: 2100000000 }) + '.' +
  'A'.repeat(43); // base64url 43 字符 → 32 字节
// 故意做坏的两种 key，用来测诊断能不能查出来
const GARBLED_KEY = ANON_KEY.slice(0, -1) + 'BB';           // 44 字符 → 33 字节（多复制了一个字符）
const SERVICE_ROLE_KEY = b64url({ alg: 'HS256', typ: 'JWT' }) + '.' +
  b64url({ iss: 'supabase', ref: 'mockproject', role: 'service_role', iat: 1700000000, exp: 2100000000 }) + '.' +
  'A'.repeat(43);

const rows = [];
const requests = [];
let mode = 'ok'; // 'ok' | 'no_table' | 'anon_readable'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.sql': 'text/plain; charset=utf-8'
};

function send(res, status, body, type) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': type || 'application/json;charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    // 模拟真实 Supabase：anon 只能插入，authenticated 才能读
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; });
    req.on('end', () => resolve(d));
  });
}

/** 给 HTML 注入 APP_CONFIG_OVERRIDE，让页面以为自己在连真实 Supabase */
function inject(html) {
  const override = `<script>window.APP_CONFIG_OVERRIDE = ${JSON.stringify({
    backend: 'supabase',
    supabase: { url: ORIGIN, anonKey: ANON_KEY, table: TABLE },
    site: { name: 'AI 人格测试（测试环境）', publicUrl: ORIGIN + '/' }
  })};</script>`;
  return html.replace('<script src="config.js"></script>', override + '\n<script src="config.js"></script>');
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const p = url.pathname;
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : '';
  requests.push({ method: req.method, path: p, search: url.search, auth: req.headers.authorization || '', apikey: req.headers.apikey || '', prefer: req.headers.prefer || '', contentType: req.headers['content-type'] || '', body });

  if (req.method === 'OPTIONS') return send(res, 204, '');

  /* ---------------- 测试辅助接口 ---------------- */
  if (p === '/__requests') return send(res, 200, requests);
  if (p === '/__reset') { requests.length = 0; rows.length = 0; mode = 'ok'; return send(res, 200, { ok: true }); }
  if (p === '/__rows') return send(res, 200, rows);
  if (p === '/__config') {
    return send(res, 200, {
      anonKey: ANON_KEY, garbledKey: GARBLED_KEY, serviceRoleKey: SERVICE_ROLE_KEY,
      table: TABLE, adminEmail: ADMIN_EMAIL, adminPwd: ADMIN_PWD
    });
  }
  if (p === '/__mode') {
    if (url.searchParams.get('set')) mode = url.searchParams.get('set');
    return send(res, 200, { mode });
  }

  /* ---------------- Auth（模拟 Supabase Auth） ---------------- */
  if (p === '/auth/v1/token') {
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch (e) { /* ignore */ }
    if (url.searchParams.get('grant_type') === 'refresh_token') {
      if (parsed.refresh_token !== 'REFRESH_TOKEN_TEST') return send(res, 400, { error_description: 'Invalid Refresh Token' });
      return send(res, 200, { access_token: ACCESS_TOKEN, refresh_token: 'REFRESH_TOKEN_TEST', expires_in: 3600, user: { email: ADMIN_EMAIL } });
    }
    // 模拟「邮箱未确认」的账号：这是最常见的一类登录失败
    if (parsed.email === 'unconfirmed@test.com') {
      return send(res, 400, { code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' });
    }
    if (parsed.email !== ADMIN_EMAIL || parsed.password !== ADMIN_PWD) {
      return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    }
    return send(res, 200, { access_token: ACCESS_TOKEN, refresh_token: 'REFRESH_TOKEN_TEST', expires_in: 3600, user: { email: ADMIN_EMAIL } });
  }

  /* ---------------- PostgREST（模拟数据表 + RLS） ---------------- */
  // REST 根路径：真实 Supabase 用返回 OpenAPI 文档的方式验证 key 是否有效
  if (p === '/rest/v1/' || p === '/rest/v1') {
    if (req.headers.apikey !== ANON_KEY) return send(res, 401, { message: 'Invalid API key' });
    return send(res, 200, { swagger: '2.0', info: { title: 'Mock Supabase PostgREST', version: '1.0' } });
  }

  if (p === '/rest/v1/' + TABLE) {
    if (!req.headers.apikey) return send(res, 401, { message: 'No API key found in request' });
    if (req.headers.apikey !== ANON_KEY) return send(res, 401, { message: 'Invalid API key' });
    const isAuthed = req.headers.authorization === 'Bearer ' + ACCESS_TOKEN;

    // 模拟「表还没建」（schema.sql 没跑）
    if (mode === 'no_table') {
      return send(res, 404, { code: 'PGRST205', message: `Could not find the table 'public.${TABLE}' in the schema cache` });
    }

    if (req.method === 'POST') {
      let rec = {};
      try { rec = JSON.parse(body); } catch (e) { return send(res, 400, { message: 'invalid json' }); }
      if (!rec.id) return send(res, 400, { message: 'id is required' });
      rows.unshift(rec);
      return send(res, 201, '');
    }

    if (req.method === 'GET') {
      // 模拟「RLS 没配好」：匿名也能读全表
      if (mode === 'anon_readable') return send(res, 200, rows);
      if (!isAuthed) return send(res, 401, { message: 'permission denied for table (anon 只能插入)' });
      const limit = Number(url.searchParams.get('limit') || 1000);
      return send(res, 200, rows.slice(0, limit));
    }

    if (req.method === 'DELETE') {
      if (!isAuthed) return send(res, 401, { message: 'permission denied' });
      const m = /id=eq\.([^&]+)/.exec(url.search);
      if (m) {
        const id = decodeURIComponent(m[1]);
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].id === id) rows.splice(i, 1);
      }
      return send(res, 204, '');
    }
  }

  /* ---------------- 静态文件 ---------------- */
  const file = path.join(ROOT, p === '/' ? 'index.html' : decodeURIComponent(p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'not found', 'text/plain;charset=utf-8');
  }
  const ext = path.extname(file);
  let content = fs.readFileSync(file);
  if (ext === '.html') content = Buffer.from(inject(content.toString('utf8')), 'utf8');
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(content);
}).listen(PORT, '127.0.0.1', () => console.log('mock supabase on ' + ORIGIN));
