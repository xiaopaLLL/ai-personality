/**
 * 数据后台 E2E（真实浏览器）：
 *  1) local 模式：预置本地记录 → 看板/KPI/图表/筛选/删除/转义
 *  2) supabase 模式（不真的登录）：只检查登录页正确出现
 * 运行： node tests/admin-e2e.mjs
 */
import {
  findChrome, findFreePort, startServer, stopServer,
  waitForServer, runChromeDump, parseResults, report
} from './browser-run.mjs';

if (!findChrome()) {
  console.log('找不到 Chrome/Edge，跳过后台 E2E（其它测试仍然有效）');
  process.exit(0);
}

const localPort = await findFreePort(8600, 8799);
const realPort = await findFreePort(8800, 8999);
const localBase = `http://127.0.0.1:${localPort}`;
const realBase = `http://127.0.0.1:${realPort}`;
const localServer = startServer('serve.mjs', localPort, ['--force-local']);
const realServer = startServer('serve.mjs', realPort);

let ok = true;
try {
  await waitForServer(localBase + '/admin.html', (t) => t.includes('__FORCED_LOCAL__'));
  await waitForServer(realBase + '/admin.html', (t) => t.includes('config.js'));

  console.log('启动浏览器：headless Chrome @ ' + localBase + '（local 模式后台）');
  const localRun = runChromeDump(localBase + '/tests/admin-e2e.html');
  const localOk = localRun && localRun.dom.trim() && report('后台 local 模式 E2E', parseResults(localRun.dom));
  if (!localOk) {
    console.error(String((localRun && localRun.errText) || '').slice(-1200));
    ok = false;
  }

  console.log('\n启动浏览器：headless Chrome @ ' + realBase + '（Supabase 配置 → 登录页）');
  const loginRun = runChromeDump(realBase + '/tests/admin-login-check.html');
  const loginOk = loginRun && loginRun.dom.trim() && report('后台登录页 E2E', parseResults(loginRun.dom));
  if (!loginOk) {
    console.error(String((loginRun && loginRun.errText) || '').slice(-1200));
    ok = false;
  }
} catch (e) {
  console.error('后台 E2E 运行失败：' + e.message);
  ok = false;
} finally {
  stopServer(localServer);
  stopServer(realServer);
}

process.exitCode = ok ? 0 : 1;
