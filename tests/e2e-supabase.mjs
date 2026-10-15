/**
 * Supabase 链路端到端测试：用 tests/mock-server.mjs 模拟 Supabase Auth + PostgREST，
 * 在真实浏览器里跑通「提交答卷 → 未登录拦截 → 登录失败提示 → 登录 → 读取远端数据 → 删除 → 故障诊断」。
 * 运行： node tests/e2e-supabase.mjs
 */
import {
  findChrome, findFreePort, startServer, stopServer,
  waitForServer, runChromeDump, parseResults, report
} from './browser-run.mjs';

if (!findChrome()) {
  console.log('找不到 Chrome/Edge，跳过 Supabase 链路测试');
  process.exit(0);
}

const port = await findFreePort(9000, 9499);
const base = `http://127.0.0.1:${port}`;
const server = startServer('mock-server.mjs', port);

try {
  // 确认这确实是我们的 mock（/__rows 存在），而不是别的服务器
  await waitForServer(base + '/__rows', (t) => t.trim() === '[]');
  await waitForServer(base + '/tests/e2e-supabase.html', (t) => t.includes('quizFrame'));
  console.log('启动浏览器：headless Chrome @ ' + base + '（模拟 Supabase）');

  const res = runChromeDump(base + '/tests/e2e-supabase.html');
  if (!res || !res.dom.trim()) {
    console.error('没拿到页面 DOM，浏览器可能启动失败：\n' + String((res && res.errText) || '').slice(-1200));
    process.exitCode = 1;
  } else {
    process.exitCode = report('Supabase 链路', parseResults(res.dom)) ? 0 : 1;
  }
} catch (e) {
  console.error('Supabase 链路测试运行失败：' + e.message);
  process.exitCode = 1;
} finally {
  stopServer(server);
}
