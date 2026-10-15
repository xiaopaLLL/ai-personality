/**
 * 极简静态服务器（本地预览 + 自动化测试用）：
 *     node tests/serve.mjs 8137               # 原样提供文件（你自己预览用这个）
 *     node tests/serve.mjs 8137 --force-local # 测试用：强制 local 模式，绝不碰真实数据库
 *
 * --force-local 会往 HTML 里注入 APP_CONFIG_OVERRIDE，把 backend 锁成 local，
 * 这样即使 config.js 已经被改成 supabase，自动化测试也不会把假数据写进你的线上库。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.argv[2] || 8137);
const FORCE_LOCAL = process.argv.includes('--force-local');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.gs': 'text/plain; charset=utf-8'
};

const OVERRIDE = '<script>window.APP_CONFIG_OVERRIDE = { backend: "local", supabase: { url: "", anonKey: "" } };' +
  'window.__FORCED_LOCAL__ = true;</script>';

function withOverride(html) {
  if (html.indexOf('<script src="config.js"></script>') >= 0) {
    return html.replace('<script src="config.js"></script>', OVERRIDE + '\n<script src="config.js"></script>');
  }
  return html;
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 not found: ' + urlPath);
    return;
  }
  const ext = path.extname(file);
  let content = fs.readFileSync(file);
  if (FORCE_LOCAL && ext === '.html') content = Buffer.from(withOverride(content.toString('utf8')), 'utf8');
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(content);
}).listen(PORT, '127.0.0.1', () => {
  console.log('静态服务器已启动： http://127.0.0.1:' + PORT + '/' + (FORCE_LOCAL ? '（强制 local 模式）' : ''));
});
