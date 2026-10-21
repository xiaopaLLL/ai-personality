/* =============================================================================
 *  站点配置：部署时通常只需要改这一个文件
 * =============================================================================
 *  backend 三种模式：
 *    'supabase'  作答记录静默写入 Supabase（当前线上使用的方式）
 *    'custom'    把数据 POST 到你自己的接口（Google Apps Script / Worker 等）
 *    'local'     不联网，只存访客自己的浏览器，适合纯预览
 *
 *  前端不会展示任何后端状态，也没有数据查看入口。
 *  查看数据请直接登录 Supabase 控制台 → Table Editor / SQL Editor。
 * ========================================================================== */

window.APP_CONFIG = {
  /* ---------- 1. 收数据方式 ---------- */
  backend: 'supabase', // 'supabase' | 'custom' | 'local'

  /* ---------- 2. Supabase（backend = 'supabase' 时生效） ---------- */
  supabase: {
    url: 'https://pcwlaykrepvdvzgrtktp.supabase.co',
    // anon / public key 设计上就是公开的；写入权限由 schema.sql 的 RLS 策略控制：
    // 匿名访客只能 insert，不能 select / delete。
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjd2xheWtyZXB2ZHZ6Z3J0a3RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMjcxMTUsImV4cCI6MjEwNzYwMzExNX0.wucJJSB_rgSJV2IeG5qYZSz9r1I5fose1hQEeTExdS4',
    table: 'ai_personality_responses'
  },

  /* ---------- 3. 自定义接口（backend = 'custom' 时生效） ---------- */
  custom: {
    endpoint: '',
    contentType: 'text/plain;charset=utf-8',
    headers: {}
  },

  /* ---------- 4. 站点信息 ---------- */
  site: {
    name: 'AI 协作机体测试',
    // 正式网址：分享链接会用它作为前缀。换域名/仓库名时记得同步改这里。
    publicUrl: 'https://xiaopalll.github.io/ai-personality/'
  },

  /* ---------- 5. 采集字段开关（关掉就完全不采集） ---------- */
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

/* ---------- 6. 测试/多环境覆盖（一般用不到） ----------
 * 自动化测试会注入 window.APP_CONFIG_OVERRIDE 强制 local 模式，避免写脏线上数据。
 *   <script>window.APP_CONFIG_OVERRIDE = { backend: 'local' };</script>
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
