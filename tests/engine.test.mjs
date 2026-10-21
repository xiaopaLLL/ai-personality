/**
 * 逻辑测试：新版问卷结构 + 四维计分 + 8 机体距离匹配 + 数据层
 * 运行： node tests/engine.test.mjs
 *
 * 新版计分（在 resources/新题目与计分说明.md 基础上做了增强）：
 *  - 16 题、每维 4 题；每题声明一个主维度，三个选项分别是主维度正分 / 负分 / 0 分
 *  - 部分选项带一个「次要维度 ±1」，让相邻倾向也能被看见
 *  - 每加一个次要 +1 就下调该维一个 +2 → +1；每加一个次要 -1 就下调该维一个 -2 → -1
 *    → 四个维度原始分范围仍然都是 -8..8，x=s/8，左侧百分比 = round(50+50x)
 *  - 8 个原型等范数、四对相反画像、唯一自匹配
 *  - 穷举全部可达四维总分，与独立距离计算一致；全中性时 8 个候选并列
 *  - 缺题 / 非法选项不算完成；记录字段不越过 Supabase 已有表结构
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
const DIMS = ['drive', 'heart', 'order', 'role'];
const DIM_INDEX = { drive: 0, heart: 1, order: 2, role: 3 };
const plain = (v) => JSON.parse(JSON.stringify(v));

/* ------------------------------ 测试工具 ------------------------------ */

const questionsOfDim = (k) => SURVEY.questions.filter((q) => q.dim === k);

function answersOf(seq) {
  const answers = {};
  SURVEY.questions.forEach((q, i) => { answers[q.id] = seq[i]; });
  return answers;
}

/** 每个维度选最正 / 最负的选项（每题独立取该维最高分） */
function answersMaximizing(k, sign) {
  const a = {};
  for (const q of SURVEY.questions) {
    let best = 0;
    let bestV = -Infinity;
    q.options.forEach((o, i) => {
      const v = sign * Number((o.scores && o.scores[k]) || 0);
      if (v > bestV) { bestV = v; best = i; }
    });
    a[q.id] = best;
  }
  return a;
}

const neutralAnswers = () => {
  const a = {};
  for (const q of SURVEY.questions) {
    const idx = q.options.findIndex((o) => Object.values(o.scores || {}).every((v) => Number(v) === 0));
    assert.ok(idx >= 0, q.id + ' 缺少全中性选项');
    a[q.id] = idx;
  }
  return a;
};

/** 独立实现距离计算，避免“用被测代码验证被测代码” */
function independentDistance(coord, x) {
  let sum = 0;
  for (const k of DIMS) {
    const d = x[k] - coord[k];
    sum += d * d;
  }
  return sum / 4;
}

function independentCandidates(x) {
  const dists = Engine.types.map((t) => ({ id: t.id, d: independentDistance(t.coord, x) }));
  const best = Math.min(...dists.map((v) => v.d));
  const candidates = dists.filter((v) => Math.abs(v.d - best) < 1e-9).map((v) => v.id);
  const second = Math.min(...dists.filter((v) => Math.abs(v.d - best) >= 1e-9).map((v) => v.d));
  return { best, candidates, second };
}

/** 穷举所有可达四维总分（每题 3 个选项，16 题；用状压 DP 去重） */
function reachableProfiles() {
  let layer = new Map([['0,0,0,0', [0, 0, 0, 0]]]);
  for (const q of SURVEY.questions) {
    const next = new Map();
    for (const scores of layer.values()) {
      for (const opt of q.options) {
        const s = scores.slice();
        for (const [k, v] of Object.entries(opt.scores || {})) s[DIM_INDEX[k]] += Number(v) || 0;
        next.set(s.join(','), s);
      }
    }
    layer = next;
  }
  return [...layer.values()].map((s) => ({ drive: s[0], heart: s[1], order: s[2], role: s[3] }));
}

/** 每个机体一个「完整 16 题作答 → 唯一命中」的见证答案（由穷举后离线挑出） */
const WITNESSES = {
  M01: [2, 0, 1, 1, 1, 1, 2, 0, 1, 0, 1, 2, 2, 1, 2, 0],
  M02: [2, 0, 1, 0, 1, 0, 0, 0, 0, 1, 2, 1, 0, 1, 0, 2],
  M03: [1, 0, 0, 1, 2, 2, 1, 1, 2, 2, 1, 2, 1, 1, 0, 2],
  M04: [2, 0, 1, 1, 2, 0, 1, 2, 0, 1, 1, 1, 1, 0, 2, 1],
  M05: [0, 1, 2, 0, 0, 1, 2, 0, 1, 0, 0, 2, 1, 1, 0, 1],
  M06: [0, 1, 1, 0, 0, 1, 2, 2, 0, 1, 2, 1, 2, 0, 2, 1],
  M07: [0, 2, 0, 2, 2, 1, 1, 0, 2, 0, 1, 2, 2, 0, 2, 1],
  M08: [0, 1, 2, 0, 2, 0, 1, 2, 0, 1, 2, 1, 0, 1, 0, 1]
};

/* ============================== 1. 问卷结构 ============================== */
console.log('\n[1] 问卷结构');

await test('共有 16 道题，id 从 q01 到 q16 唯一，每题都声明主维度', () => {
  assert.equal(SURVEY.questions.length, 16);
  const ids = SURVEY.questions.map((q) => q.id);
  assert.deepEqual(plain(ids), Array.from({ length: 16 }, (_, i) => 'q' + String(i + 1).padStart(2, '0')));
  for (const q of SURVEY.questions) {
    assert.ok(DIMS.includes(q.dim), q.id + ' 主维度不合法: ' + q.dim);
    assert.ok(q.text && q.text.length > 8, q.id + ' 题干太短');
    assert.equal(q.options.length, 3, q.id + ' 应有 3 个选项');
  }
});

await test('四个维度齐全，且每个维度恰好 4 道主测题', () => {
  assert.deepEqual(plain(Object.keys(SURVEY.dimensions)), DIMS);
  for (const k of DIMS) assert.equal(questionsOfDim(k).length, 4, k);
});

await test('每题三个选项：主维度一正、一负、一中性，另允许一个次要维度 ±1', () => {
  let secondaryCount = 0;
  for (const q of SURVEY.questions) {
    const primary = q.options.map((o) => Number((o.scores || {})[q.dim]));
    assert.equal(primary.filter((v) => v > 0).length, 1, q.id + ' 应恰好一个主维度正分选项');
    assert.equal(primary.filter((v) => v < 0).length, 1, q.id + ' 应恰好一个主维度负分选项');
    assert.equal(primary.filter((v) => v === 0).length, 1, q.id + ' 应恰好一个主维度中性选项');
    for (const v of primary) assert.ok([-2, -1, 0, 1, 2].includes(v), q.id + ' 主维度分值不合法: ' + v);

    for (const o of q.options) {
      const scores = o.scores || {};
      assert.ok(q.dim in scores, q.id + ' 选项缺少主维度分数');
      const extra = Object.keys(scores).filter((k) => k !== q.dim);
      assert.ok(extra.length <= 1, q.id + ' 一个选项最多带一个次要维度');
      for (const k of extra) {
        assert.ok(DIMS.includes(k), q.id + ' 次要维度不合法: ' + k);
        assert.equal(Number(scores[k]), scores[k] > 0 ? 1 : -1, q.id + ' 次要分只能是 ±1');
        secondaryCount++;
      }
    }
  }
  assert.ok(secondaryCount >= 12, '次要分太少（应至少 12 个），计分过于单调');
});

await test('主维度正负中性选项位置已打散（每个位置都出现过三种分值）', () => {
  for (const k of DIMS) {
    const positions = { pos: new Set(), neg: new Set(), zero: new Set() };
    for (const q of questionsOfDim(k)) {
      q.options.forEach((o, i) => {
        const v = Number((o.scores || {})[k]);
        if (v > 0) positions.pos.add(i);
        else if (v < 0) positions.neg.add(i);
        else positions.zero.add(i);
      });
    }
    for (const key of ['pos', 'neg', 'zero']) {
      assert.equal(positions[key].size, 3, k + ' 的 ' + key + ' 选项没有分布在三个位置');
    }
  }
});

await test('每个维度的理论极值仍为 -8 ~ +8（次要分已做补偿）', () => {
  const range = Engine.theoreticalRange(SURVEY);
  for (const k of DIMS) {
    assert.equal(range[k].min, -8, k + ' 最小值');
    assert.equal(range[k].max, 8, k + ' 最大值');
  }
});

/* ============================== 2. 归一化与展示 ============================== */
console.log('\n[2] 归一化与百分比展示');

await test('算例：唯一命中答案 (7,6,3,2) → 左侧 94/88/69/63%，右侧 6/12/31/37%', () => {
  const r = Engine.score(SURVEY, answersOf(WITNESSES.M01));
  assert.equal(r.complete, true);
  assert.equal(r.answered, 16);
  assert.deepEqual(DIMS.map((k) => r.raw[k]), [7, 6, 3, 2]);
  assert.deepEqual(DIMS.map((k) => r.normalized[k]), [0.875, 0.75, 0.375, 0.25]);
  assert.deepEqual(DIMS.map((k) => r.percents[k].left), [94, 88, 69, 63]);
  assert.deepEqual(DIMS.map((k) => r.percents[k].right), [6, 12, 31, 37]);
  assert.deepEqual(DIMS.map((k) => r.percents[k].pole), ['left', 'left', 'left', 'left']);
  assert.equal(r.profileCode, 'EWSP');
});

await test('全中性作答：四维均为 50:50，pole=neutral，profileCode 每维都是 X', () => {
  const r = Engine.score(SURVEY, neutralAnswers());
  for (const k of DIMS) {
    assert.equal(r.raw[k], 0);
    assert.equal(r.percents[k].left, 50, k);
    assert.equal(r.percents[k].right, 50, k);
    assert.equal(r.percents[k].pole, 'neutral', k);
  }
  assert.equal(r.profileCode, 'XXXX');
});

await test('每个维度都能取到 +8 / -8，对应左侧 100% / 0%', () => {
  for (const k of DIMS) {
    const max = Engine.score(SURVEY, answersMaximizing(k, 1));
    const min = Engine.score(SURVEY, answersMaximizing(k, -1));
    assert.equal(max.raw[k], 8, k + ' 取不到 +8');
    assert.equal(max.percents[k].left, 100, k + ' 应达到 100%');
    assert.equal(min.raw[k], -8, k + ' 取不到 -8');
    assert.equal(min.percents[k].left, 0, k + ' 应降到 0%');
  }
});

/* ============================== 3. 八机体与匹配 ============================== */
console.log('\n[3] 八机体原型与距离匹配');

await test('恰好 8 个机体，字段完整且图片文件存在', () => {
  assert.equal(Engine.types.length, 8);
  assert.deepEqual(plain(Engine.types.map((t) => t.id)), ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08']);
  for (const t of Engine.types) {
    assert.ok(t.name && t.tagline && t.desc, t.id);
    assert.equal(t.strengths.length, 3, t.id + ' strengths');
    assert.equal(t.watch.length, 2, t.id + ' watch');
    assert.equal(t.tips.length, 3, t.id + ' tips');
    assert.ok(t.oppositeNote, t.id + ' oppositeNote');
    assert.ok(t.slug && Engine.typeBySlug(t.slug) === t, t.id + ' slug');
    assert.ok(t.image.startsWith('assets/img/') && fs.existsSync(path.join(ROOT, t.image)), t.image + ' 不存在');
    assert.ok(t.thumb.startsWith('assets/img/thumbs/') && fs.existsSync(path.join(ROOT, t.thumb)), t.thumb + ' 不存在');
  }
});

await test('八原型等范数、每维正负强度集合一致，并有四对相反画像', () => {
  const norms = new Set();
  for (const t of Engine.types) {
    const abs = DIMS.map((k) => Math.abs(t.coord[k])).sort();
    assert.deepEqual(abs, [0.25, 0.5, 0.75, 1], t.id + ' 坐标强度集合');
    norms.add(DIMS.reduce((s, k) => s + t.coord[k] * t.coord[k], 0).toFixed(6));
    const opp = Engine.typeById(t.oppositeId);
    assert.ok(opp, t.id + ' 缺少相反画像');
    for (const k of DIMS) assert.equal(opp.coord[k], -t.coord[k], t.id + '→' + t.oppositeId + ' ' + k + ' 不是相反数');
    assert.equal(opp.oppositeId, t.id, '相反关系应自反');
  }
  assert.equal(norms.size, 1, '八个原型应等范数');
  const pairs = new Set(Engine.types.map((t) => [t.id, t.oppositeId].sort().join('-')));
  assert.equal(pairs.size, 4, '应有四对相反画像');
});

await test('每种机体都有一份唯一命中的完整作答（8 份见证答案）', () => {
  for (const t of Engine.types) {
    const seq = WITNESSES[t.id];
    assert.ok(Array.isArray(seq) && seq.length === 16, t.id + ' 缺少见证答案');
    const r = Engine.score(SURVEY, answersOf(seq));
    assert.equal(r.complete, true);
    assert.equal(r.candidates.length, 1, t.id + ' 见证答案出现并列: ' + r.candidates.map((x) => x.id));
    assert.equal(r.display.id, t.id, t.id + ' 见证答案命中了 ' + r.display.id);
  }
});

await test('全部可达四维总分与独立距离计算一致', () => {
  const profiles = reachableProfiles();
  assert.ok(profiles.length >= 40000, '可达总分太少，可能题目分值设计有问题: ' + profiles.length);
  const seenTypes = {};
  let ties = 0;
  let nears = 0;
  for (const raw of profiles) {
    const x = {};
    for (const k of DIMS) x[k] = raw[k] / 8;
    const expected = independentCandidates(x);
    const got = Engine.matchRaw(raw, SURVEY);
    assert.deepEqual(plain(got.candidates.map((t) => t.id)), plain(expected.candidates),
      '原始分 ' + JSON.stringify(raw) + ' 候选不一致');
    assert.ok(Math.abs(got.bestDistance - expected.best) < 1e-12, '距离不一致');
    const gap = got.secondDistance === null ? Infinity : got.secondDistance - got.bestDistance;
    assert.equal(got.near.length > 0, got.candidates.length === 1 && gap <= 1 / 16 + 1e-12,
      '并列/近似提示规则不一致: ' + JSON.stringify(raw));
    if (got.tie) ties++;
    if (got.near.length) nears++;
    seenTypes[got.display.id] = (seenTypes[got.display.id] || 0) + 1;
  }
  assert.equal(Object.keys(seenTypes).length, 8, '存在无法命中的机体');
  for (const id of Object.keys(seenTypes)) assert.ok(seenTypes[id] > 1000, id + ' 命中范围过窄: ' + seenTypes[id]);
  assert.ok(ties > 0 && ties < profiles.length, '并列情况应真实存在但非全部');
  assert.ok(nears > 0, '1/16 近似提示应真实存在');
});

await test('全中性：8 个候选并列，标记 allNeutral', () => {
  const r = Engine.score(SURVEY, neutralAnswers());
  assert.equal(r.tie, true);
  assert.equal(r.allNeutral, true);
  assert.equal(r.candidates.length, 8);
  assert.deepEqual(plain(r.candidates.map((t) => t.id)), plain(Engine.types.map((t) => t.id)));
});

await test('缺题 / 非法选项：complete=false，不算完成答卷', () => {
  const answers = answersOf(WITNESSES.M01);
  delete answers.q16;
  assert.equal(Engine.score(SURVEY, answers).complete, false);
  assert.equal(Engine.score(SURVEY, answers).answered, 15);

  const illegal = answersOf(WITNESSES.M01);
  illegal.q01 = 99;
  assert.equal(Engine.score(SURVEY, illegal).complete, false);
  assert.equal(Engine.score(SURVEY, illegal).answered, 15);

  const partial = Engine.score(SURVEY, { q01: 0, q02: 1 });
  assert.equal(partial.complete, false);
  assert.equal(partial.answered, 2);
});

await test('shareText 只有机体名与四维百分比，不含字母人格代号', () => {
  const r = Engine.score(SURVEY, answersOf(WITNESSES.M01));
  const text = Engine.shareText(r, SURVEY);
  assert.ok(text.includes(r.display.name));
  assert.ok(text.includes('驱动方式'));
  assert.ok(!/M0[1-8]/.test(text), '分享文案不应出现机体编号');
  assert.ok(!/\b(EWSP|DLIC|EWSX)\b/.test(text), '分享文案不应出现四字母代号');
});

/* ============================== 4. 数据层 ============================== */
console.log('\n[4] 数据层');

const SCHEMA_COLUMNS = new Set([
  'id', 'created_at', 'survey_id', 'survey_version', 'result_code', 'result_name',
  'scores', 'percents', 'answers', 'answer_detail', 'answered', 'total', 'duration_ms',
  'nickname', 'user_agent', 'referrer', 'lang', 'screen', 'timezone'
]);

const fullAnswers = () => answersOf(WITNESSES.M01);

await test('buildRecord 只写 schema 已有列，匹配元数据放进 percents.match', () => {
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, {
    nickname: '小明', durationMs: 61234, env: Store.collectEnv()
  });
  for (const k of Object.keys(rec)) assert.ok(SCHEMA_COLUMNS.has(k), '出现表结构外的列: ' + k);
  assert.ok(rec.id && rec.created_at);
  assert.equal(rec.result_code, 'M01');
  assert.equal(rec.result_name, '机魂总调度');
  assert.equal(rec.survey_version, SURVEY.meta.version);
  assert.equal(rec.nickname, '小明');
  assert.equal(rec.duration_ms, 61234);
  assert.equal(rec.user_agent, 'Mozilla/5.0 (Test)');
  assert.equal(rec.referrer, 'https://example.com/source');
  assert.equal(rec.screen, '1920x1080');
  assert.deepEqual(plain(rec.scores), { drive: 7, heart: 6, order: 3, role: 2 });
  assert.equal(rec.percents.match.profileCode, 'EWSP');
  assert.equal(rec.percents.match.display, 'M01');
  assert.deepEqual(plain(rec.percents.match.candidates), ['M01']);
  assert.equal(rec.answer_detail.length, 16);
  assert.ok(JSON.stringify(rec).indexOf('undefined') < 0, 'JSON 里不应出现 undefined');
  for (const k of Object.keys(rec)) assert.notEqual(rec[k], null, k + ' 不应为 null');
});

await test('并列答卷在记录里保留全部候选，display 只决定先展示谁', () => {
  const answers = neutralAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { env: Store.collectEnv() });
  assert.equal(rec.percents.match.tie, true);
  assert.equal(rec.percents.match.allNeutral, true);
  assert.equal(rec.percents.match.candidates.length, 8);
  assert.equal(rec.percents.match.display, 'M01');
  assert.equal(rec.result_code, 'M01');
});

await test('local 模式：提交写入本机', async () => {
  sandbox.APP_CONFIG.backend = 'local';
  Store.clearLocal();
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { env: Store.collectEnv() });
  const res = await Store.submit(rec);
  assert.equal(res.ok, true);
  assert.equal(res.mode, 'local');
  assert.equal(Store.listLocal().length, 1);
});

await test('supabase 未配置时降级本地保存，不抛错', async () => {
  Store.clearLocal();
  sandbox.APP_CONFIG.backend = 'supabase';
  sandbox.APP_CONFIG.supabase = { url: '', anonKey: '', table: 'ai_personality_responses' };
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { env: Store.collectEnv() });
  const res = await Store.submit(rec);
  assert.equal(res.ok, false);
  assert.equal(res.localBackup, true);
  assert.equal(Store.listLocal().length, 1);
});

await test('supabase：POST /rest/v1/<table>，带 apikey，Prefer: return=minimal', async () => {
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
  const sent = JSON.parse(calls[0].opt.body);
  assert.equal(sent.id, rec.id);
  assert.equal(sent.result_code, 'M01');
  assert.equal(sent.percents.match.display, 'M01');
  for (const k of Object.keys(sent)) assert.ok(SCHEMA_COLUMNS.has(k), '请求体出现表结构外的列: ' + k);
});

await test('custom 模式：POST 用 text/plain 发 JSON', async () => {
  const calls = [];
  sandbox.fetch = (url, opt) => {
    calls.push({ url, opt });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('ok') });
  };
  sandbox.APP_CONFIG.backend = 'custom';
  sandbox.APP_CONFIG.custom.endpoint = 'https://example.com/collect';
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { env: Store.collectEnv() });
  const res = await Store.submit(rec);
  assert.equal(res.ok, true);
  assert.equal(calls[0].url, 'https://example.com/collect');
  assert.equal(calls[0].opt.method, 'POST');
  assert.ok(/text\/plain/.test(calls[0].opt.headers['Content-Type']));
});

await test('网络失败：进入待重发队列，恢复后自动补传', async () => {
  Store.clearLocal();
  sandbox.fetch = () => Promise.reject(new Error('offline'));
  sandbox.APP_CONFIG.backend = 'supabase';
  sandbox.APP_CONFIG.supabase = { url: 'https://abc.supabase.co', anonKey: 'K', table: 'ai_personality_responses' };
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { env: Store.collectEnv() });
  const res = await Store.submit(rec);
  assert.equal(res.ok, false);
  assert.equal(res.queued, true);
  assert.equal(Store.pendingCount(), 1);
  assert.equal(Store.listLocal().length, 1);

  sandbox.fetch = () => Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve('') });
  const flush = await Store.flushPending();
  assert.equal(flush.sent, 1);
  assert.equal(Store.pendingCount(), 0);
});

/* ============================== 5. 数据后台 API ============================== */
console.log('\n[5] 数据后台 API');

await test('local 模式：后台无需登录，能排序/筛选/删除本地记录', async () => {
  Store.clearLocal();
  sandbox.APP_CONFIG.backend = 'local';
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const early = Store.buildRecord(SURVEY, result, answers, { env: Store.collectEnv() });
  early.created_at = '2026-10-19T08:00:00.000Z';
  const late = Store.buildRecord(SURVEY, result, answers, { env: Store.collectEnv() });
  late.created_at = '2026-10-20T08:00:00.000Z';
  Store.saveLocal(early);
  Store.saveLocal(late);

  assert.equal(Store.admin.isRemote(), false);
  assert.equal(Store.admin.dataSource(), 'local');
  const rows = await Store.admin.fetchRows({});
  assert.equal(rows.length, 2, '应能读到两条本地记录');
  assert.equal(rows[0].id, late.id, '应按 created_at 倒序');

  const filtered = await Store.admin.fetchRows({ version: 'v2.0', from: '2026-10-20T00:00:00.000Z' });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, late.id);

  const other = await Store.admin.fetchRows({ version: 'v1.0' });
  assert.equal(other.length, 0);

  await Store.admin.remove(early.id);
  assert.equal(Store.listLocal().length, 1, '删除本地记录应生效');
  Store.clearLocal();
});

await test('supabase 后台：未登录报 UNAUTH；登录后带用户 token 读数据、删除', async () => {
  Store.admin.signOut();
  sandbox.APP_CONFIG.backend = 'supabase';
  sandbox.APP_CONFIG.supabase = { url: 'https://abc.supabase.co', anonKey: 'ANON', table: 'ai_personality_responses' };
  const calls = [];
  sandbox.fetch = (url, opt) => {
    calls.push({ url, opt });
    if (url.indexOf('/auth/v1/token?grant_type=password') >= 0) {
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({
          access_token: 'USER_TOKEN', refresh_token: 'REFRESH', expires_in: 3600,
          user: { email: 'admin@example.com' }
        }))
      });
    }
    if (url.indexOf('/auth/v1/token?grant_type=refresh_token') >= 0) {
      return Promise.resolve({
        ok: true, status: 200,
        text: () => Promise.resolve(JSON.stringify({ access_token: 'NEW_TOKEN', refresh_token: 'R2', expires_in: 3600 }))
      });
    }
    if (opt && opt.method === 'DELETE') {
      return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
    }
    return Promise.resolve({
      ok: true, status: 200,
      text: () => Promise.resolve(JSON.stringify([{ id: 'row-1', created_at: '2026-10-20T08:00:00.000Z', survey_version: 'v2.0', result_code: 'M01' }]))
    });
  };

  let unauth = null;
  try { await Store.admin.fetchRows({}); } catch (e) { unauth = e; }
  assert.ok(unauth && unauth.code === 'UNAUTH', '未登录应报 UNAUTH');

  const s = await Store.admin.signIn('admin@example.com', 'pwd');
  assert.equal(s.email, 'admin@example.com');
  assert.equal(Store.admin.session().access_token, 'USER_TOKEN');

  const rows = await Store.admin.fetchRows({ version: 'v2.0', limit: 10 });
  assert.equal(rows.length, 1);
  const getCall = calls.filter((c) => c.url.indexOf('/rest/v1/') >= 0 && !(c.opt && c.opt.method === 'DELETE')).pop();
  assert.ok(getCall.url.indexOf('survey_version=eq.v2.0') >= 0, '应带版本筛选');
  assert.equal(getCall.opt.headers.Authorization, 'Bearer USER_TOKEN');

  await Store.admin.remove('row-1');
  const delCall = calls.filter((c) => c.opt && c.opt.method === 'DELETE').pop();
  assert.ok(delCall.url.indexOf('id=eq.row-1') >= 0, '删除应带 id 条件');
  assert.equal(delCall.opt.headers.Authorization, 'Bearer USER_TOKEN');

  Store.admin.signOut();
  assert.equal(Store.admin.session(), null);
});

await test('后台读取 401 时会清除会话并提示重新登录', async () => {
  Store.admin.signOut();
  sandbox.APP_CONFIG.backend = 'supabase';
  sandbox.APP_CONFIG.supabase = { url: 'https://abc.supabase.co', anonKey: 'ANON', table: 'ai_personality_responses' };
  sandbox.fetch = (url) => {
    if (url.indexOf('/auth/v1/token?grant_type=password') >= 0) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ access_token: 'T', refresh_token: 'R', expires_in: 3600 })) });
    }
    return Promise.resolve({
      ok: false, status: 401,
      text: () => Promise.resolve(JSON.stringify({ message: 'JWT expired' }))
    });
  };
  await Store.admin.signIn('a@b.c', 'x');
  let err = null;
  try { await Store.admin.fetchRows({}); } catch (e) { err = e; }
  assert.ok(err && err.code === 'UNAUTH', '401 应转成 UNAUTH');
  assert.equal(Store.admin.session(), null, '401 后应清除本地会话');
});

await test('toCSV：带 BOM、表头与数据列一致、包含匹配元数据与 16 题作答', () => {
  const answers = fullAnswers();
  const result = Engine.score(SURVEY, answers);
  const rec = Store.buildRecord(SURVEY, result, answers, { nickname: 'a,b"c', durationMs: 9000, env: Store.collectEnv() });
  const csv = Store.toCSV([rec], SURVEY);
  assert.ok(csv.startsWith('\ufeff'), 'CSV 应以 BOM 开头');
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines.length, 2);
  const countCols = (line) => (line.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) || []).length + 1;
  assert.equal(countCols(lines[0]), countCols(lines[1]), '表头与数据列数不一致');
  assert.ok(csv.indexOf('"a,b""c"') >= 0, '特殊字符应被转义');
  assert.ok(csv.indexOf(result.display.name) >= 0, 'CSV 应包含机体中文名');
  assert.ok(csv.indexOf('EWSP') >= 0, 'CSV 应包含 profileCode');
  assert.ok(csv.indexOf('q01') >= 0, 'CSV 应包含题目列');
  assert.ok(lines[0].indexOf('并列候选') >= 0 && lines[0].indexOf('最佳距离') >= 0, 'CSV 表头应含匹配字段');
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
