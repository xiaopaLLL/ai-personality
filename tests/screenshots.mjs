/**
 * 一键重新生成预览截图（新版 8 机体 UI）：
 *   node tests/screenshots.mjs
 * 输出到 tests/screenshots/（已在 .gitignore 里，不会提交）
 * 移动端用 iframe 390px 宽模拟，避免 headless Chrome 最小窗口宽度限制。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, findChrome, findFreePort, startServer, stopServer,
  waitForServer, screenshot
} from './browser-run.mjs';

if (!findChrome()) {
  console.error('找不到 Chrome/Edge，无法截图');
  process.exit(1);
}

const OUT = path.join(ROOT, 'tests', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const port = await findFreePort(9500, 9700);
const base = `http://127.0.0.1:${port}`;
const server = startServer('serve.mjs', port, ['--force-local']);

const shots = [
  // 桌面：首屏 / 答题 / 结果 / 并列结果 / 分享落地页
  ['1-intro.png', '/tests/preview.html?stage=intro', 1400, 1300],
  ['2-quiz.png', '/tests/preview.html?stage=quiz', 1360, 1100],
  ['3-result.png', '/tests/preview.html?stage=result', 1360, 2350],
  ['4-result-neutral.png', '/tests/preview.html?stage=result-neutral', 1360, 2800],
  ['5-share.png', '/tests/preview.html?stage=share', 1360, 1350],
  // 移动端：390px 宽
  ['6-intro-mobile.png', '/tests/preview.html?stage=intro&w=mobile', 600, 1850],
  ['7-result-mobile.png', '/tests/preview.html?stage=result&w=mobile', 600, 4000]
];

try {
  await waitForServer(base + '/index.html', (t) => t.includes('__FORCED_LOCAL__'));
  for (const [name, url, w, h] of shots) {
    const out = path.join(OUT, name);
    const ok = screenshot(base + url, out, w, h);
    console.log('  ' + name + ' → ' + (ok ? Math.round(fs.statSync(out).size / 1024) + ' KB' : '失败'));
  }
  console.log('截图完成：tests/screenshots/');
} finally {
  stopServer(server);
}
