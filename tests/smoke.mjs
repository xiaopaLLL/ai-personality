/**
 * 冒烟测试：起一个临时静态服务器，检查所有页面和资源都能正常打开，
 * 并且没有依赖任何外部 CDN（保证 GitHub Pages 上不会因为墙/CORS 挂掉）。
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
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.gs': 'text/plain; charset=utf-8'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
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

const PAGES = ['/', '/admin.html', '/config.js', '/assets/css/style.css', '/assets/css/admin.css',
  '/assets/js/questions.js', '/assets/js/personality.js', '/assets/js/store.js',
  '/assets/js/app.js', '/assets/js/admin.js', '/README.md', '/supabase/schema.sql',
  '/robots.txt', '/.nojekyll'];

console.log('\n[1] 资源可访问性');
const bodies = {};
for (const p of PAGES) {
  await test('GET ' + p, async () => {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p + ' 返回 ' + res.status);
    bodies[p] = await res.text();
    if (p !== '/.nojekyll') assert.ok(bodies[p].length > 50, p + ' 内容异常');
  });
}

console.log('\n[2] HTML 引用的本地资源都存在');
for (const page of ['/', '/admin.html']) {
  await test(page + ' 引用的 css/js 都能取到', async () => {
    const html = bodies[page];
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1])
      .filter((u) => !/^(https?:)?\/\//.test(u) && !u.startsWith('data:') && !u.startsWith('#'));
    assert.ok(refs.length >= 5, '引用太少，可能漏了脚本');
    for (const r of refs) {
      if (r.endsWith('.md')) continue;
      const res = await fetch(base + '/' + r.replace(/^\.?\//, ''));
      assert.equal(res.status, 200, page + ' 引用了打不开的资源 ' + r);
    }
  });
}

console.log('\n[3] 无外部依赖 / 基本内容检查');
await test('页面不引用任何外部 CDN 或第三方脚本', async () => {
  for (const page of ['/', '/admin.html']) {
    const html = bodies[page];
    const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(external, [], page + ' 存在外链依赖: ' + external.join(', '));
  }
});

await test('首页包含关键容器 id，脚本能挂载', () => {
  for (const id of ['screen-intro', 'screen-quiz', 'screen-result', 'screen-shared', 'options', 'typeGrid', 'toast', 'startBtn', 'consent']) {
    assert.ok(bodies['/'].includes('id="' + id + '"'), '缺少 #' + id);
  }
});

await test('后台包含关键容器 id', () => {
  for (const id of ['viewLogin', 'viewDash', 'kpis', 'typeChart', 'dimChart', 'trendChart', 'questionStats', 'tableBody', 'filterRange', 'exportCsv']) {
    assert.ok(bodies['/admin.html'].includes('id="' + id + '"'), '缺少 #' + id);
  }
});

await test('README 里的部署步骤齐全（GitHub Pages / Supabase / 域名）', () => {
  const md = bodies['/README.md'];
  for (const kw of ['GitHub Pages', 'Supabase', 'schema.sql', 'anonKey', 'CNAME', 'Cloudflare']) {
    assert.ok(md.includes(kw), 'README 缺少关键词 ' + kw);
  }
});

await test('没有拼错的绝对路径（js 里不出现 /assets/ 根路径引用）', () => {
  for (const f of ['/assets/js/app.js', '/assets/js/admin.js']) {
    assert.ok(!bodies[f].includes('src="/'), f + ' 使用了根路径，仓库子目录部署会 404');
  }
});

server.close();
console.log('\n' + '─'.repeat(52));
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项，通过 ' + passed + ' 项');
  process.exit(1);
}
console.log('冒烟测试全部通过：' + passed + ' 项 ✅');
