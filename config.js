/* =============================================================================
 *  ★★★ 部署时你只需要改这一个文件 ★★★
 * =============================================================================
 *  backend 三种模式：
 *
 *  1) 'local'    不用任何后端。数据只存在访客自己的浏览器里。
 *                适合先本地预览、或先上线看看效果（后台看不到别人的数据）。
 *
 *  2) 'supabase' 推荐。免费、免服务器，后台 admin.html 可以直接看统计。
 *                去 https://supabase.com 建一个项目，跑一遍 supabase/schema.sql，
 *                然后把 Project URL 和 anon public key 填到下面。
 *
 *  3) 'custom'   把数据 POST 到你自己的接口（Google Apps Script、Cloudflare Worker、
 *                自己的服务器都行）。接口要求和示例见 README.md 与 deploy/ 目录。
 * ========================================================================== */

window.APP_CONFIG = {
  /* ---------- 1. 选后端 ---------- */
  backend: 'supabase', // 'local' | 'supabase' | 'custom'

  /* ---------- 2. Supabase 配置（backend = 'supabase' 时填） ---------- */
  supabase: {
    // 形如 https://abcdefghijklmn.supabase.co
    url: 'https://pcwlaykrepvdvzgrtktp.supabase.co/',
    // Project Settings → API → Project API keys → anon / public
    // 这个 key 设计上就是公开的，可以放在前端；安全性由 schema.sql 里的 RLS 策略保证
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjd2xheWtyZXB2ZHZ6Z3J0a3RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMjcxMTUsImV4cCI6MjEwNzYwMzExNX0.wucJJSB_rgSJV2IeG5qYZSz9r1I5fose1hQEeTExdS4',
    table: 'ai_personality_responses'
  },

  /* ---------- 3. 自定义接口配置（backend = 'custom' 时填） ---------- */
  custom: {
    // 收数据的地址（示例：Google Apps Script 部署后的 /exec 网址）
    endpoint: '',
    // 用 POST + text/plain 发送 JSON，可以避开浏览器预检请求（CORS preflight），
    // 这也是 Google Apps Script 能直接接收的方式。
    contentType: 'text/plain;charset=utf-8',
    // 额外请求头，一般留空
    headers: {},
    // 【可选】后台 admin.html 读取数据用的接口（自建服务时才有用）
    adminUrl: '',
    adminToken: ''
  },

  /* ---------- 4. 站点信息 ---------- */
  site: {
    name: 'AI 人格测试',
    // 部署到 GitHub Pages 后填你的正式网址，分享文案里会用到（留空则自动取当前网址）
    publicUrl: ''
  },

  /* ---------- 5. 后台 admin.html ---------- */
  admin: {
    title: 'AI 人格测试 · 数据后台',
    // 后台默认只显示「登录后能看到的数据」。Supabase 模式下用你创建的邮箱账号登录。
    pageSize: 50
  },

  /* ---------- 6. 采集字段开关（关掉就完全不采集该项） ---------- */
  collect: {
    userAgent: true,
    referrer: true,
    language: true,
    screen: true,
    timezone: true,
    duration: true,
    nickname: true
  }
};

/* ---------- 7. 高级用法：用 window.APP_CONFIG_OVERRIDE 覆盖上面的配置 ----------
 * 一般用不到。适合「同一份代码分别部署到测试环境和生产环境」或自动化测试：
 *   <script>window.APP_CONFIG_OVERRIDE = { backend:'supabase', supabase:{ url:'...', anonKey:'...' } };</script>
 *   <script src="config.js"></script>
 */
(function () {
  var ov = window.APP_CONFIG_OVERRIDE;
  if (!ov) return;
  var base = window.APP_CONFIG;
  Object.keys(ov).forEach(function (k) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) &&
        ov[k] && typeof ov[k] === 'object' && !Array.isArray(ov[k])) {
      base[k] = Object.assign({}, base[k], ov[k]);
    } else {
      base[k] = ov[k];
    }
  });
})();
