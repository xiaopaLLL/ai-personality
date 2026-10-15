/**
 * 逻辑测试：问卷完整性 + 计分引擎 + 数据层（本地/自定义接口/Supabase）
 * 运行： node tests/engine.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = path.resolve(import.meta.dirname, '..');
let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => { passed++; console.log('  ✓ ' + name); },
        (e) => { failures.push([name, e]); console.log('  ✗ ' + name + '\n      ' + (e && e.message)); });
    }
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    failures.push([name, e]);
    console.log('  ✗ ' + name + '\n      ' + (e && e.message));
  }
}

/* --------------------------- 搭一个浏览器沙箱 --------------------------- */
const mem = new Map();
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Math, Date, Object, Array, String, Number, Boolean, Error,
  Intl, AbortController, URL, TextEncoder, TextDecoder, Blob,
  crypto: globalThis.crypto,
  navigator: { userAgent: 'Mozilla/5.0 (Test)', language: 'zh-CN' },
  screen: { width: 1920, height: 1080 },
  document: { referrer: 'https://example.com/source' },
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear()
  },
  APP_CONFIG: {
    backend: 'local',
    supabase: { url: '', anonKey: '', table: 'ai_personality_responses' },
    custom: { endpoint: '', contentType: 'text/plain;charset=utf-8', headers: {} },
    site: {},
    admin: {},
    collect: { userAgent: true, referrer: true, language: true, screen: true, timezone: true, duration: true, nickname: true }
  },
  fetch: () => Promise.reject(new Error('network disabled in test'))
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['assets/js/questions.js', 'assets/js/personality.js', 'assets/js/store.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const { SURVEY, Engine, Store } = sandbox;

/* ============================== 1. 问卷结构 ============================== */
console.log('\n[1] 问卷结构');

await test('问卷有 4 个维度', () => {
  assert.equal(Object.keys(SURVEY.dimensions).length, 4);
});

await test('每题都有唯一 id、文字和至少 2 个选项', () => {
  const ids = new Set();
  assert.ok(SURVEY.questions.length >= 8, '题目太少');
  for (const q of SURVEY.questions) {
    assert.ok(q.id && !ids.has(q.id), '题目 id 重复或缺失: ' + q.id);
    ids.add(q.id);
    assert.ok(q.text && q.text.length > 4, q.id + ' 题干太短');
    assert.ok(Array.isArray(q.options) && q.options.length >= 2, q.id + ' 选项不足 2 个');
    for (const o of q.options) assert.ok(o.text && o.text.length > 1, q.id + ' 有空选项');
  }
});

await test('所有选项的 scores 键名都合法、值为有限数字', () => {
  const dims = Object.keys(SURVEY.dimensions);
  for (const q of SURVEY.questions) {
    for (const o of q.options) {
      for (const [k, v] of Object.entries(o.scores || {})) {
        assert.ok(dims.includes(k), q.id + ' 出现未知维度: ' + k);
        assert.ok(Number.isFinite(v) && v !== 0, q.id + ' 维度 ' + k + ' 的分数无效: ' + v);
      }
      assert.ok(Object.keys(o.scores || {}).length > 0, q.id + ' 有选项没配任何分数');
    }
  }
});

await test('每个维度都同时存在正分和负分选项（保证两个极点都能被选中）', () => {
  const range = Engine.theoreticalRange(SURVEY);
  for (const k of Engine.dimKeys(SURVEY)) {
    assert.ok(range[k].max > 0, k + ' 缺少正分选项');
    assert.ok(range[k].min < 0, k + ' 缺少负分选项');
  }
});

/* ============================== 2. 计分引擎 ============================== */
console.log('\n[2] 计分引擎');

function answersMaximizing(k, sign) {
  const a = {};
  for (const q of SURVEY.questions) {
    let best = 0, bestV = -Infinity;
    q.options.forEach((o, i) => {
      const v = sign * Number((o.scores && o.scores[k]) || 0);
      if (v > bestV) { bestV = v; best = i; }
    });
    a[q.id] = best;
  }
  return a;
}

await test('全部选最正分的选项时，该维度左侧为 100%，极点正确', () => {
  for (const k of Engine.dimKeys(SURVEY)) {
    const r = Engine.score(SURVEY, answersMaximizing(k, 1));
    assert.equal(r.percents[k].left, 100, k + ' 应达到 100%');
    assert.equal(r.percents[k].pole, 'left');
    assert.ok(r.code.includes(SURVEY.dimensions[k].left.code), '四字代码应含左侧字母');
  }
});

await test('全部选最负分的选项时，该维度左侧为 0%', () => {
  for (const k of Engine.dimKeys(SURVEY)) {
    const r = Engine.score(SURVEY, answersMaximizing(k, -1));
    assert.equal(r.percents[k].left, 0, k + ' 应降到 0%');
    assert.equal(r.percents[k].pole, 'right');
  }
});

await test('最左/最右的两套极端作答，分别落在四个维度的两个极点上', () => {
  const allLeft = {}, allRight = {};
  for (const q of SURVEY.questions) {
    let bestL = 0, vl = -Infinity, bestR = 0, vr = Infinity;
    q.options.forEach((o, i) => {
      let sum = 0;
      for (const k of Engine.dimKeys(SURVEY)) sum += Number((o.scores && o.scores[k]) || 0);
      if (sum > vl) { vl = sum; bestL = i; }
      if (sum < vr) { vr = sum; bestR = i; }
    });
    allLeft[q.id] = bestL;
    allRight[q.id] = bestR;
  }
  const expectedLeft = Engine.dimKeys(SURVEY).map((k) => SURVEY.dimensions[k].left.code).join('');
  const expectedRight = Engine.dimKeys(SURVEY).map((k) => SURVEY.dimensions[k].right.code).join('');
  const rl = Engine.score(SURVEY, allLeft);
  const rr = Engine.score(SURVEY, allRight);
  for (const k of Engine.dimKeys(SURVEY)) {
    assert.equal(rl.percents[k].pole, 'left', k + ' 最左作答却落到了右侧');
    assert.equal(rr.percents[k].pole, 'right', k + ' 最右作答却落到了左侧');
  }
  assert.equal(rl.code, expectedLeft);
  assert.equal(rr.code, expectedRight);
});

await test('随机作答 3000 次，结果始终合法', () => {
  const letters = new Set('EWSPDLCI'.split(''));
  for (let n = 0; n < 3000; n++) {
    const a = {};
    for (const q of SURVEY.questions) a[q.id] = Math.floor(Math.random() * q.options.length);
    const r = Engine.score(SURVEY, a);
    assert.equal(r.code.length, 4, '代码长度应为 4: ' + r.code);
    assert.ok(r.code.split('').every((c) => letters.has(c)), '非法字母: ' + r.code);
    assert.ok(Engine.TYPES[r.code], '缺少人格定义: ' + r.code);
    for (const k of Engine.dimKeys(SURVEY)) {
      const p = r.percents[k];
      assert.ok(p.left >= 0 && p.left <= 100, '百分比越界');
      assert.equal(p.left + p.right, 100, '左右百分比之和应为 100');
      assert.ok(['left', 'right'].includes(p.pole));
    }
    assert.equal(r.answered, SURVEY.questions.length);
  }
});

await test('只答一半也能算分，answered 计数正确', () => {
  const a = {};
  SURVEY.questions.slice(0, Math.ceil(SURVEY.questions.length / 2)).forEach((q) => { a[q.id] = 0; });
  const r = Engine.score(SURVEY, a);
  assert.equal(r.answered, Object.keys(a).length);
  assert.ok(Engine.TYPES[r.code]);
});

/* ============================== 3. 人格库 ============================== */
console.log('\n[3] 人格库');

await test('16 种人格齐全，字段完整', () => {
  const codes = Object.keys(Engine.TYPES);
  assert.equal(codes.length, 16, '应有 16 种类型，实际 ' + codes.length);
  for (const c of codes) {
    const t = Engine.TYPES[c];
    assert.equal(c.length, 4);
    assert.ok(t.emoji && t.name && t.tagline && t.desc, c + ' 字段缺失');
    assert.ok(Array.isArray(t.strengths) && t.strengths.length >= 2, c + ' strengths 不足');
    assert.ok(Array.isArray(t.watch) && t.watch.length >= 1, c + ' watch 不足');
    assert.ok(Array.isArray(t.tips) && t.tips.length >= 2, c + ' tips 不足');
  }
});

await test('flipCode 是自反的，且互补类型都存在', () => {
  for (const c of Object.keys(Engine.TYPES)) {
    const f = Engine.flipCode(c);
    assert.notEqual(f, c);
    assert.ok(Engine.TYPES[f], '缺少互补类型 ' + f);
    assert.equal(Engine.flipCode(f), c);
  }
});

await test('shareText 含类型名和四维度，且能被复制粘贴', () => {
  const r = Engine.score(SURVEY, answersMaximizing('drive', 1));
  const txt = Engine.shareText(r, SURVEY);
  assert.ok(txt.includes(r.name));
  assert.ok(txt.includes('驱动方式'));
  assert.ok(txt.split('\n').length >= 5);
});

/* ============================== 4. 数据层 ============================== */
console.log('\n[4] 数据层');

const fullAnswers = () => {
  const a = {};
  SURVEY.questions.forEach((q, i) => { a[q.id] = i % q.options.length; });
  return a;
};

await test('buildRecord 字段齐全、无 undefined', () => {
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { nickname: '小明', durationMs: 61234, env: Store.collectEnv() });
  assert.ok(rec.id && rec.created_at);
  assert.equal(rec.result_code, result.code);
  assert.equal(rec.nickname, '小明');
  assert.equal(rec.duration_ms, 61234);
  assert.equal(rec.survey_version, SURVEY.meta.version);
  assert.equal(rec.user_agent, 'Mozilla/5.0 (Test)');
  assert.equal(rec.referrer, 'https://example.com/source');
  assert.equal(rec.screen, '1920x1080');
  assert.ok(JSON.stringify(rec).indexOf('undefined') < 0, 'JSON 里不应出现 undefined');
  for (const k of Object.keys(rec)) assert.notEqual(rec[k], null, k + ' 不应为 null');
});

await test('local 模式：提交写入本机，去重导入生效', async () => {
  sandbox.APP_CONFIG.backend = 'local';
  sandbox.Store.clearLocal();
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { nickname: '', durationMs: 1000, env: Store.collectEnv() });
  const res = await Store.submit(rec);
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'local');
  assert.equal(Store.listLocal().length, 1);
  assert.equal(Store.importRows([rec]), 0, '重复 id 不应重复导入');
  assert.equal(Store.importRows([Object.assign({}, rec, { id: 'other-id' })]), 1);
  assert.equal(Store.listLocal().length, 2);
});

await test('toCSV：带 BOM、表头列数与数据列数一致、特殊字符被转义', () => {
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { nickname: 'a,b"c', durationMs: 9000, env: Store.collectEnv() });
  const csv = Store.toCSV([rec], SURVEY);
  assert.ok(csv.startsWith('\ufeff'), 'CSV 应以 BOM 开头（Excel 中文不乱码）');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines.length, 2);
  const countCols = (line) => (line.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) || []).length + 1;
  assert.equal(countCols(lines[0]), countCols(lines[1]), '表头与数据列数不一致');
  assert.ok(csv.includes('"a,b""c"'), '含逗号引号的字段应被正确转义');
  assert.ok(csv.includes(result.name), 'CSV 应包含结果类型名');
  assert.ok(lines[1].includes(result.code));
});

await test('custom 模式：POST 用 text/plain 发送 JSON', async () => {
  const calls = [];
  sandbox.fetch = (url, opt) => {
    calls.push({ url, opt });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('ok'), json: () => Promise.resolve({ ok: true }) });
  };
  sandbox.APP_CONFIG.backend = 'custom';
  sandbox.APP_CONFIG.custom.endpoint = 'https://example.com/collect';
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { env: Store.collectEnv() });
  const res = await Store.submit(rec);
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.com/collect');
  assert.equal(calls[0].opt.method, 'POST');
  assert.ok(/text\/plain/.test(calls[0].opt.headers['Content-Type']), '应使用 text/plain 以避免预检');
  const sent = JSON.parse(calls[0].opt.body);
  assert.equal(sent.id, rec.id);
  assert.equal(sent.result_code, rec.result_code);
});

await test('custom 模式：网络失败 → 进入待重发队列 → 恢复后自动补传', async () => {
  sandbox.Store.clearLocal();
  sandbox.fetch = () => Promise.reject(new Error('offline'));
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { env: Store.collectEnv() });
  const res = await Store.submit(rec);
  assert.equal(res.ok, false);
  assert.equal(res.queued, true);
  assert.equal(Store.pendingCount(), 1);
  assert.equal(Store.listLocal().length, 1, '失败时也应在本机留一份备份');

  sandbox.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{}') });
  const flush = await Store.flushPending();
  assert.equal(flush.sent, 1);
  assert.equal(Store.pendingCount(), 0);
});

await test('supabase 模式：未配置时降级为本地保存并给出提示', async () => {
  sandbox.Store.clearLocal();
  sandbox.APP_CONFIG.backend = 'supabase';
  sandbox.APP_CONFIG.supabase = { url: '', anonKey: '', table: 'ai_personality_responses' };
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { env: Store.collectEnv() });
  const res = await Store.submit(rec);
  assert.equal(res.ok, false);
  assert.equal(res.localBackup, true);
  assert.ok(/配置/.test(res.error));
  assert.equal(Store.listLocal().length, 1);
});

await test('supabase 模式：请求打到 /rest/v1/<table>，带 apikey 与 Prefer: return=minimal', async () => {
  const calls = [];
  sandbox.fetch = (url, opt) => {
    calls.push({ url, opt });
    return Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve('') });
  };
  sandbox.APP_CONFIG.backend = 'supabase';
  sandbox.APP_CONFIG.supabase = { url: 'https://abc.supabase.co/', anonKey: 'ANON_KEY_TEST', table: 'ai_personality_responses' };
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { env: Store.collectEnv() });
  const res = await Store.submit(rec);
  assert.equal(res.ok, true);
  assert.equal(calls[0].url, 'https://abc.supabase.co/rest/v1/ai_personality_responses');
  assert.equal(calls[0].opt.headers.apikey, 'ANON_KEY_TEST');
  assert.equal(calls[0].opt.headers.Prefer, 'return=minimal');
  assert.equal(JSON.parse(calls[0].opt.body).id, rec.id);
});

await test('后台取数在未登录时报 UNAUTH（不会误显示空数据）', async () => {
  sandbox.Store.supabase.signOut();
  let threw = null;
  try { await Store.admin.fetchRows({}); } catch (e) { threw = e; }
  assert.ok(threw && threw.message === 'UNAUTH', '应抛出 UNAUTH');
});

/* ============================== 汇总 ============================== */
console.log('\n' + '─'.repeat(52));
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项，通过 ' + passed + ' 项');
  for (const [n, e] of failures) console.log('  ✗ ' + n + ' → ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  process.exit(1);
} else {
  console.log('全部通过：' + passed + ' 项测试 ✅');
}
