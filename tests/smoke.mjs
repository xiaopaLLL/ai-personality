/**
 * 冒烟测试：起临时静态服务器，检查页面、脚本、样式、图片、文档都能正常打开，
 * 并且没有外部 CDN、没有后台入口、没有旧版 16 型/编号残留。
 * 运行： node tests/smoke.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let passed = 0;
const failures = [];

async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failures.push([name, e]); console.log('  ✗ ' + name + '\n      ' + e.message); }
}

const PAGES = [
  '/', '/config.js', '/assets/css/style.css',
  '/assets/js/questions.js', '/assets/js/personality.js', '/assets/js/store.js', '/assets/js/app.js',
  '/admin.html', '/assets/css/admin.css', '/assets/js/admin.js',
  '/assets/img/overview.webp', '/assets/img/thumbs/m01.webp',
  '/robots.txt', '/.nojekyll', '/.gitignore',
  '/README.md', '/docs/重新部署步骤.md', '/docs/问卷设计与结果简介.md',
  '/supabase/schema.sql'
];

console.log('\n[1] 资源可访问性');
const bodies = {};
for (const p of PAGES) {
  await test('GET ' + p, async () => {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p + ' 返回 ' + res.status);
    if (p !== '/.nojekyll') {
      const buf = Buffer.from(await res.arrayBuffer());
      bodies[p] = p.endsWith('.webp') ? buf : buf.toString('utf8');
      assert.ok(buf.length > 40, p + ' 内容异常');
    }
  });
}

console.log('\n[2] 8 张机体大图与缩略图都在');
for (let i = 1; i <= 8; i++) {
  const id = 'm0' + i;
  await test(id + ' 大图 + 缩略图可访问', async () => {
    for (const p of ['/assets/img/' + id + '.webp', '/assets/img/thumbs/' + id + '.webp']) {
      const res = await fetch(base + p);
      assert.equal(res.status, 200, p);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.ok(buf.length > 8000 && buf.length < 400 * 1024, p + ' 体积异常 ' + buf.length);
      bodies[p] = buf;
    }
  });
}

console.log('\n[3] HTML 引用的本地资源都存在');
await test('首页引用的 css/js 都能取到', async () => {
  const html = bodies['/'];
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:)?\/\//.test(u) && !u.startsWith('data:') && !u.startsWith('#'));
  assert.ok(refs.length >= 5, '引用太少，可能漏了脚本');
  for (const r of refs) {
    const clean = r.replace(/\?.*$/, '').replace(/^\.?\//, '');
    if (!clean || clean === '') continue;
    const res = await fetch(base + '/' + clean);
    assert.equal(res.status, 200, '首页引用了打不开的资源 ' + r);
  }
});

await test('后台页面引用的 css/js 都能取到（页面保留，但前台无入口）', async () => {
  const html = String(bodies['/admin.html'] || '');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:)?\/\//.test(u) && !u.startsWith('data:') && !u.startsWith('#'));
  assert.ok(refs.length >= 6, '后台引用太少，可能漏了脚本');
  for (const r of refs) {
    const clean = r.replace(/\?.*$/, '').replace(/^\.?\//, '');
    if (!clean || clean === '') continue;
    const res = await fetch(base + '/' + clean);
    assert.equal(res.status, 200, '后台引用了打不开的资源 ' + r);
  }
});

console.log('\n[4] 无外部依赖 / 关键容器 / 无后台入口');
await test('页面不引用任何外部 CDN、外链字体或第三方脚本', () => {
  for (const p of ['/', '/admin.html', '/assets/js/app.js', '/assets/js/admin.js', '/assets/css/style.css', '/assets/css/admin.css']) {
    const text = String(bodies[p] || '');
    const external = [...text.matchAll(/https?:\/\/[^\s"')]+/g)]
      .map((m) => m[0])
      .filter((u) => !u.startsWith('https://xiaopalll.github.io/') &&
        !u.includes('supabase.co') &&
        !u.startsWith('http://www.w3.org/'));
    assert.deepEqual(external, [], p + ' 存在外链依赖: ' + external.slice(0, 3).join(', '));
  }
});

await test('首页包含新版关键容器 id', () => {
  for (const id of ['screen-intro', 'screen-quiz', 'screen-result', 'screen-shared', 'introTitle',
    'startBtn', 'consent', 'nickname', 'options', 'qText', 'qCounter', 'backBtn', 'typeGallery',
    'resultRoot', 'sharedRoot', 'toast']) {
    assert.ok(bodies['/'].includes('id="' + id + '"'), '缺少 #' + id);
  }
});

await test('前台没有数据后台入口 / 云端状态文案', () => {
  // store.js 是前后台共用的数据层，包含 admin API 与相关注释；这里只检查真正面向访客的文件
  const haystack = ['/', '/config.js', '/assets/js/app.js', '/assets/css/style.css']
    .map((p) => String(bodies[p] || '')).join('\n');
  for (const bad of ['admin.html', '数据后台', '数据已接入云端', '本地预览模式', 'backendChip', 'adminToken']) {
    assert.ok(!haystack.includes(bad), '前台出现不应存在的后台痕迹: ' + bad);
  }
  assert.ok(!/link[^>]+admin/i.test(bodies['/']), '首页存在 admin 链接');
});

await test('首页与交互脚本不展示机体编号 / 四字母人格代号', () => {
  const home = String(bodies['/'] || '');
  assert.ok(!/M0[1-8]/.test(home), '首页出现机体编号');
  assert.ok(!/\b(EWSP|DLIC|EWSX)\b/.test(home), '首页出现四字母代号');
  assert.ok(!/16\s*型|AI 人格/.test(home), '首页出现旧版说法');

  const js = String(bodies['/assets/js/app.js'] || '');
  assert.ok(!/M0[1-8]/.test(js), 'app.js 出现机体编号');
  assert.ok(!/\b(EWSP|DLIC|EWSX)\b/.test(js), 'app.js 出现四字母代号');
  assert.ok(!/AI 人格/.test(js), 'app.js 出现旧版说法');
  // app.js 里唯一允许出现「16 型」的地方是旧分享链接的提示文案（需求要求明确告知旧版已下线）
  const jsWithoutLegacyNotice = js.replace(/旧版 16 型结果已经下线/g, '');
  assert.ok(!/16\s*型/.test(jsWithoutLegacyNotice), 'app.js 除旧链接提示外出现旧版说法');
});

await test('首页只放 8 个机体名称，不直接加载那 8 张图', () => {
  const home = String(bodies['/'] || '');
  assert.ok(!/<img\b/i.test(home), '首页 HTML 里仍然直接有 <img>');
  assert.ok(home.includes('id="typeGallery"'), '首页缺少文字版图鉴容器 #typeGallery');
  const js = String(bodies['/assets/js/app.js'] || '');
  assert.ok(js.includes('type-item'), '文字图鉴没有渲染机体名称');
  assert.ok(!/renderGallery[\s\S]{0,400}<img/.test(js), 'renderGallery 仍在注入图片');
  const engine = String(bodies['/assets/js/personality.js'] || '');
  assert.equal((engine.match(/id: 'M0[1-8]'/g) || []).length, 8, '机体定义不是 8 个');
});

console.log('\n[5] 样式 / 配置 / 素材约定');
await test('CSS 花括号配平，且包含移动端与减动效适配', () => {
  const css = String(bodies['/assets/css/style.css'] || '');
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  assert.equal(open, close, 'CSS 花括号不配平');
  assert.ok(/@media[^{]*max-width/.test(css), '缺少移动端媒体查询');
  assert.ok(/prefers-reduced-motion/.test(css), '缺少减少动效适配');
  assert.ok(/--lime|#d9f24a/i.test(css), '缺少荧光绿主色');
  assert.ok(!/#7c5cff|#22d3ee/i.test(css), '仍残留旧版紫色/青色');
});

await test('config.js 指向 Supabase 且不含后台登录配置', () => {
  const cfg = String(bodies['/config.js'] || '');
  assert.ok(/backend:\s*'supabase'/.test(cfg), 'backend 不是 supabase');
  assert.ok(/https:\/\/[a-z0-9]+\.supabase\.co/.test(cfg), '缺少 Supabase URL');
  for (const bad of ['admin', 'service_role', 'adminUrl']) assert.ok(!cfg.includes(bad), 'config 出现 ' + bad);
});

await test('.gitignore 至少忽略 resources/ 与测试截图', () => {
  const gi = String(bodies['/.gitignore'] || '');
  assert.ok(/^\s*resources\/\s*$/m.test(gi), '.gitignore 缺少 resources/');
  assert.ok(gi.includes('tests/screenshots/'), '.gitignore 缺少测试截图');
});

await test('robots.txt 屏蔽后台与 tests/，但不影响地址栏手动访问', () => {
  const robots = String(bodies['/robots.txt'] || '');
  assert.ok(robots.includes('Disallow: /admin.html'), 'robots 应屏蔽搜索引擎收录后台');
  assert.ok(robots.includes('Disallow: /tests/'), 'robots 未屏蔽 tests/');
  const admin = String(bodies['/admin.html'] || '');
  assert.ok(/<meta\s+name="robots"\s+content="noindex/i.test(admin), '后台页面应加 noindex');
});

await test('后台页面包含登录/看板关键容器，且不引用 resources/ 图片', () => {
  const admin = String(bodies['/admin.html'] || '');
  for (const id of ['viewLogin', 'viewDash', 'loginForm', 'loginEmail', 'loginPwd', 'loginBtn',
    'loginMsg', 'logoutBtn', 'refreshBtn', 'exportCsv', 'exportJson', 'kpis', 'typeChart',
    'dimChart', 'trendChart', 'questionStats', 'tableBody', 'filterVersion', 'filterRange',
    'filterType', 'notice', 'detailModal', 'detailTitle', 'detailMeta', 'detailFlags',
    'detailDims', 'detailAnswers', 'detailClose', 'detailCopy']) {
    assert.ok(admin.includes('id="' + id + '"'), '后台缺少 #' + id);
  }
  const all = [admin, String(bodies['/assets/js/admin.js'] || ''), String(bodies['/assets/css/admin.css'] || '')].join('\n');
  assert.ok(!all.includes('resources/'), '后台引用了 resources/');
});

console.log('\n[6] 文档齐全');
await test('README 含本地预览、测试与重新部署步骤', () => {
  const md = String(bodies['/README.md'] || '');
  for (const kw of ['GitHub Pages', 'Supabase', '重新部署', 'node tests/engine.test.mjs', 'resources/']) {
    assert.ok(md.includes(kw), 'README 缺少关键词 ' + kw);
  }
});

await test('重新部署步骤文档覆盖提交、Pages、Supabase 验收', () => {
  const md = String(bodies['/docs/重新部署步骤.md'] || '');
  for (const kw of ['git add', 'git commit', 'git push', 'GitHub Pages', 'Supabase', '验收', '回滚']) {
    assert.ok(md.includes(kw), '部署文档缺少关键词 ' + kw);
  }
});

await test('设计说明文档覆盖 8 种机体与四维计分', () => {
  const md = String(bodies['/docs/问卷设计与结果简介.md'] || '');
  for (const kw of ['16', '驱动方式', '交互偏好', '做事方式', '协作姿态', '机魂总调度', '并列']) {
    assert.ok(md.includes(kw), '设计文档缺少关键词 ' + kw);
  }
});

server.close();
console.log('\n' + '─'.repeat(52));
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项，通过 ' + passed + ' 项');
  process.exit(1);
}
console.log('冒烟测试全部通过：' + passed + ' 项 ✅');
