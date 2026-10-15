/**
 * 端到端测试（真实浏览器）：headless Chrome 打开 tests/e2e.html，
 * 在真实 DOM 里点完 16 道题，校验结果页、本地落库、后台统计、筛选与删除。
 * 运行： node tests/e2e.mjs
 */
import {
  findChrome, findFreePort, startServer, stopServer,
  waitForServer, runChromeDump, parseResults, report
} from './browser-run.mjs';

if (!findChrome()) {
  console.log('找不到 Chrome/Edge，跳过浏览器 E2E（其它测试仍然有效）');
  process.exit(0);
}

const port = await findFreePort(8600, 8999);
const base = `http://127.0.0.1:${port}`;
// --force-local：测试固定跑 local 模式，避免把假数据写进真实的 Supabase 库
const server = startServer('serve.mjs', port, ['--force-local']);

try {
  // 先确认拿到的是「测试环境」，而不是别的残留服务器
  await waitForServer(base + '/index.html', (t) => t.includes('__FORCED_LOCAL__'));
  await waitForServer(base + '/tests/e2e.html', (t) => t.includes('quizFrame') && !t.includes('APP_CONFIG_OVERRIDE = { backend: "supabase"'));
  console.log('启动浏览器：headless Chrome @ ' + base);

  const res = runChromeDump(base + '/tests/e2e.html');
  if (!res || !res.dom.trim()) {
    console.error('没拿到页面 DOM，浏览器可能启动失败：\n' + String((res && res.errText) || '').slice(-1200));
    process.exitCode = 1;
  } else {
    process.exitCode = report('E2E', parseResults(res.dom)) ? 0 : 1;
  }
} catch (e) {
  console.error('E2E 运行失败：' + e.message);
  process.exitCode = 1;
} finally {
  stopServer(server);
}
