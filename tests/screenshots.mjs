/**
 * 一键重新生成预览截图：
 *   node tests/screenshots.mjs
 * 输出到 tests/screenshots/
 * 其中「诊断面板」那张需要 mock Supabase（tests/mock-server.mjs），脚本会自己起。
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

const staticPort = await findFreePort(9500, 9700);
const mockPort = await findFreePort(9701, 9899);
const staticBase = `http://127.0.0.1:${staticPort}`;
const mockBase = `http://127.0.0.1:${mockPort}`;
const staticServer = startServer('serve.mjs', staticPort, ['--force-local']);
const mockServer = startServer('mock-server.mjs', mockPort);

const shots = [
  ['1-intro.png', staticBase + '/index.html', 1180, 1250],
  ['2-quiz.png', staticBase + '/tests/preview.html?stage=quiz', 1180, 1000],
  ['3-result.png', staticBase + '/tests/preview.html?stage=result', 1180, 2300],
  ['4-admin.png', staticBase + '/tests/preview.html?stage=admin', 1180, 2150],
  ['5-share.png', staticBase + '/index.html?result=EWSC', 1180, 1300],
  ['6-diagnose.png', mockBase + '/tests/preview-diag.html', 1180, 1250]
];

try {
  await waitForServer(staticBase + '/index.html', (t) => t.includes('__FORCED_LOCAL__'));
  await waitForServer(mockBase + '/__rows', (t) => t.trim() === '[]');
  for (const [name, url, w, h] of shots) {
    const out = path.join(OUT, name);
    const ok = screenshot(url, out, w, h);
    console.log('  ' + name + ' → ' + (ok ? Math.round(fs.statSync(out).size / 1024) + ' KB' : '失败'));
  }
  console.log('截图完成：tests/screenshots/');
} finally {
  stopServer(staticServer);
  stopServer(mockServer);
}
