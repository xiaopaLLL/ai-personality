/**
 * 浏览器测试公共工具：端口挑选 → 起服务器 → 校验内容 → 跑 headless Chrome → 解析结果 → 收干净进程。
 * 之前各测试脚本各自 spawn/mock、不回收进程，会出现端口被旧服务器占用、
 * 结果测到了「另一个 origin」的假失败，所以统一到这里。
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const ROOT = path.resolve(import.meta.dirname, '..');

export function findChrome() {
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].find((p) => fs.existsSync(p));
}

export function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

export async function findFreePort(start, end) {
  for (let i = 0; i < 300; i++) {
    const port = start + Math.floor(Math.random() * (end - start));
    if (await isPortFree(port)) return port;
  }
  throw new Error('找不到空闲端口');
}

/** 起一个独立进程的服务器（detached，便于之后整棵进程树收掉） */
export function startServer(scriptName, port, extraArgs) {
  const args = [path.join(import.meta.dirname, scriptName), String(port)].concat(extraArgs || []);
  const child = spawn(process.execPath, args, {
    cwd: ROOT, detached: true, stdio: 'ignore'
  });
  child.unref();
  return child;
}

export function stopServer(child) {
  if (!child || !child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { child.kill('SIGKILL'); }
    }
  } catch (e) { /* ignore */ }
}

/** 等服务器起来，并校验它提供的确实是我们要测的那份代码 */
export async function waitForServer(url, expect, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        if (expect && !expect(text)) {
          last = '内容不符合预期（可能被别的服务器占用了端口）';
        } else {
          return text;
        }
      } else {
        last = 'HTTP ' + res.status;
      }
    } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('服务器没就绪：' + url + '（' + last + '）');
}

/** 用 headless Chrome 打开页面，返回渲染完成后的 DOM 文本 */
export function runChromeDump(url, opts) {
  opts = opts || {};
  const chrome = findChrome();
  if (!chrome) return null;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aipt-chrome-'));
  const outFile = path.join(profile, 'dom.txt');
  const errFile = path.join(profile, 'err.txt');
  const outFd = fs.openSync(outFile, 'w');
  const errFd = fs.openSync(errFile, 'w');
  try {
    spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--mute-audio', '--hide-scrollbars',
      '--user-data-dir=' + path.join(profile, 'data'),
      '--virtual-time-budget=' + (opts.budget || 60000),
      '--dump-dom', url
    ], { stdio: ['ignore', outFd, errFd], timeout: opts.timeout || 180000 });
  } finally {
    fs.closeSync(outFd);
    fs.closeSync(errFd);
  }
  const dom = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  const errText = fs.existsSync(errFile) ? fs.readFileSync(errFile, 'utf8') : '';
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  return { dom, errText };
}

export function screenshot(url, outPath, width, height) {
  const chrome = findChrome();
  if (!chrome) return false;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aipt-shot-'));
  const fd = fs.openSync(path.join(profile, 'log.txt'), 'w');
  try {
    spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
      '--user-data-dir=' + path.join(profile, 'data'),
      '--window-size=' + width + ',' + height, '--virtual-time-budget=45000',
      '--screenshot=' + outPath, url
    ], { stdio: ['ignore', fd, fd], timeout: 120000 });
  } finally {
    fs.closeSync(fd);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
  return fs.existsSync(outPath);
}

/** 从 dump 出来的 DOM 里解析 RESULT PASS/FAIL 与 SUMMARY */
export function parseResults(dom) {
  const visible = String(dom || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const lines = [...visible.matchAll(/RESULT (PASS|FAIL) ([^\n<]*)/g)].map((m) => ({
    pass: m[1] === 'PASS',
    name: m[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim()
  }));
  const summary = (visible.match(/SUMMARY passed=(\d+) failed=(\d+)/) || [])[0] || '';
  return { lines, summary };
}

/** 打印结果并返回是否全部通过 */
export function report(title, parsed) {
  let pass = 0, fail = 0;
  for (const l of parsed.lines) {
    if (l.pass) { pass++; console.log('  ✓ ' + l.name); }
    else { fail++; console.log('  ✗ ' + l.name); }
  }
  console.log('─'.repeat(52));
  console.log(parsed.summary || '（没有拿到 SUMMARY，可能是页面没跑起来）');
  const ok = fail === 0 && /failed=0/.test(parsed.summary);
  console.log(ok ? (title + ' 全部通过：' + pass + ' 项 ✅') : (title + ' 失败：' + pass + ' 通过 / ' + fail + ' 失败'));
  return ok;
}
