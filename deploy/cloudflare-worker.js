/**
 * =============================================================================
 *  备选后端 B：Cloudflare Worker + KV（配合 Cloudflare Pages 部署前端）
 * =============================================================================
 *  适合：仓库想设为私有、或想用自己的域名 + 免费 CDN 的场景。
 *  Cloudflare 免费额度：每天 10 万次请求、KV 每天 1000 次写，个人测试完全够用。
 *
 *  部署步骤：
 *   1. 注册 https://dash.cloudflare.com （免费）。
 *   2. 左侧 Workers & Pages → KV → Create namespace，名字填 AI_PERSONALITY。
 *   3. Workers & Pages → Create → Worker，名字填 ai-personality-api，创建后点 Edit code，
 *      把本文件全部内容粘贴进去，Deploy。
 *   4. 进 Worker → Settings → Variables and Secrets：
 *        添加 Secret：ADMIN_TOKEN = 一个长随机字符串（后台读取用）
 *      Settings → Bindings → 添加 KV Namespace Binding：
 *        Variable name: AI_PERSONALITY   →  选择第 2 步建的 namespace
 *      （改完记得 Deploy 一次）
 *   5. 记下 Worker 地址，例如 https://ai-personality-api.你的账号.workers.dev
 *      填到 config.js：
 *        backend: 'custom',
 *        custom.endpoint: 'https://ai-personality-api.xxx.workers.dev',
 *        custom.adminUrl: 'https://ai-personality-api.xxx.workers.dev/admin',
 *        custom.adminToken: '与 ADMIN_TOKEN 相同'
 *   6. 前端部署见 README「方案 C：Cloudflare Pages」。
 *
 *  接口约定（自己写后端时也可以照这个实现）：
 *    POST /            body = JSON 作答记录，Content-Type 可以是 text/plain
 *    GET  /admin?token=ADMIN_TOKEN   返回 { rows: [记录...] }
 * =============================================================================
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json;charset=utf-8' }, CORS)
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ---------- 收数据 ----------
    if (request.method === 'POST' && (url.pathname === '/' || url.pathname === '/collect')) {
      let rec;
      try {
        const text = await request.text();
        rec = JSON.parse(text);
      } catch (e) {
        return json({ ok: false, error: 'bad json' }, 400);
      }
      if (!rec || !rec.id || !rec.result_code) {
        return json({ ok: false, error: 'missing fields' }, 400);
      }
      // 防刷：同 id 直接忽略
      const key = `r:${rec.created_at || new Date().toISOString()}:${rec.id}`;
      await env.AI_PERSONALITY.put(key, JSON.stringify(rec));
      return json({ ok: true, id: rec.id });
    }

    // ---------- 后台只读 ----------
    if (request.method === 'GET' && url.pathname === '/admin') {
      const token = url.searchParams.get('token') || '';
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      const rows = [];
      let cursor;
      do {
        const list = await env.AI_PERSONALITY.list({ cursor, limit: 1000 });
        for (const k of list.keys) {
          const v = await env.AI_PERSONALITY.get(k.name);
          if (v) { try { rows.push(JSON.parse(v)); } catch (e) { /* skip */ } }
        }
        cursor = list.list_complete ? null : list.cursor;
      } while (cursor && rows.length < 5000);

      rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return json({ ok: true, rows });
    }

    return json({ ok: false, error: 'not found' }, 404);
  }
};
