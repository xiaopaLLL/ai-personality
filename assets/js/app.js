/* =============================================================================
 *  AI 协作机体测试 · 前台交互（v2.1）
 *  首屏 → 续答 → 答题 → 结果 → 分享落地页
 *  只读取 window.SURVEY / window.Engine / window.Store 契约，不修改数据层。
 * ========================================================================== */
(function () {
  'use strict';

  var S = window.SURVEY;
  var E = window.Engine;
  var St = window.Store;
  var CFG = window.APP_CONFIG || {};

  var PROGRESS_KEY = 'aipt:progress:v2';
  var SCREENS = ['intro', 'quiz', 'result', 'shared'];

  var total = 0;
  var dimKeys = [];
  var advanceTimer = null;
  var toastTimer = null;

  var state = {
    answers: {},
    step: 0,
    startedAt: 0,
    nickname: '',
    consent: false,
    result: null,
    locked: false,
    mode: 'intro'
  };

  /* ------------------------------- 小工具 ------------------------------- */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function scrollTop() {
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
  }

  function lsGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function lsSet(key, val) {
    try { window.localStorage.setItem(key, val); } catch (e) { /* ignore */ }
  }

  function lsRemove(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function thumbOf(t) {
    if (!t) return '';
    if (t.thumb) return t.thumb;
    if (t.image) return String(t.image).replace('/img/', '/img/thumbs/');
    return '';
  }

  function imageOf(t) {
    return (t && t.image) || '';
  }

  /* -------------------------------- Toast -------------------------------- */

  function toast(msg) {
    var el = $('toast');
    if (!el || !msg) return;
    el.textContent = msg;
    el.className = 'toast show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2800);
  }

  /* ------------------------------ 屏幕切换 ------------------------------ */

  function showScreen(name) {
    for (var i = 0; i < SCREENS.length; i++) {
      var el = $('screen-' + SCREENS[i]);
      if (el) el.classList.toggle('hidden', SCREENS[i] !== name);
    }
    state.mode = name;
    try { document.body.setAttribute('data-screen', name); } catch (e) { /* ignore */ }
  }

  function focusHeading(el) {
    if (!el) return;
    try {
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------ 进度暂存 ------------------------------ */

  function saveProgress() {
    lsSet(PROGRESS_KEY, JSON.stringify({
      answers: state.answers,
      step: state.step,
      nickname: state.nickname,
      consent: state.consent,
      surveyVersion: (S && S.meta && S.meta.version) || '',
      startedAt: state.startedAt,
      at: Date.now()
    }));
  }

  function clearProgress() { lsRemove(PROGRESS_KEY); }

  function loadProgress() {
    var raw = lsGet(PROGRESS_KEY);
    if (!raw || !S || !S.meta) return null;
    var p;
    try { p = JSON.parse(raw); } catch (e) { return null; }
    if (!p || typeof p !== 'object') return null;
    if (p.surveyVersion !== S.meta.version) { clearProgress(); return null; }
    var src = (p.answers && typeof p.answers === 'object') ? p.answers : {};
    var answers = {};
    var count = 0;
    for (var i = 0; i < (S.questions || []).length; i++) {
      var q = S.questions[i];
      var a = src[q.id];
      if (typeof a === 'number' && q.options && a >= 0 && a < q.options.length) {
        answers[q.id] = a;
        count++;
      }
    }
    if (!count) return null;
    var step = (typeof p.step === 'number' && p.step >= 0 && p.step < total) ? Math.floor(p.step) : 0;
    return {
      answers: answers,
      step: step,
      nickname: typeof p.nickname === 'string' ? p.nickname : '',
      consent: !!p.consent,
      startedAt: typeof p.startedAt === 'number' ? p.startedAt : 0,
      answered: count
    };
  }

  /* ------------------------------ 静态渲染 ------------------------------ */

  function renderHeroTitle(title) {
    var el = $('introTitle');
    if (!el) return;
    var m = /^(\S+)\s+([\s\S]+)$/.exec(title || '');
    if (m) {
      el.innerHTML = '<span class="t-accent">' + esc(m[1]) + '</span><span> ' + esc(m[2]) + '</span>';
    } else {
      el.textContent = title || '';
    }
  }

  function renderIntroText(text) {
    var el = $('introText');
    if (!el) return;
    var parts = String(text || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!parts.length) { el.innerHTML = ''; return; }
    el.innerHTML = parts.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
  }

  function renderGallery() {
    var box = $('typeGallery');
    if (!box || !E || !E.types) return;
    /* 首页只放机体名称：纯文字目录，不加载任何图片 */
    box.innerHTML = (E.types || []).map(function (t) {
      return '<span class="type-item">' + esc(t.name) + '</span>';
    }).join('');
  }

  function renderStatic() {
    var meta = S.meta || {};
    var title = meta.title || 'AI 协作机体测试';
    var siteName = title;

    document.title = title + (meta.subtitle ? ' · ' + meta.subtitle : '');
    renderHeroTitle(title);

    var brand = $('brandName');
    if (brand) brand.textContent = siteName;

    var sub = $('introSub');
    if (sub) sub.textContent = meta.subtitle || '';

    var countEl = $('specCount');
    var dimsEl = $('specDims');
    var typesEl = $('specTypes');
    var timeEl = $('specTime');
    if (countEl) countEl.textContent = String(total);
    if (dimsEl) dimsEl.textContent = String(dimKeys.length || 4);
    if (typesEl) typesEl.textContent = String((E.types || []).length || 8);
    if (timeEl) {
      var m = /(\d+)\s*分钟/.exec(meta.estimated || '');
      timeEl.textContent = m ? m[1] : '3';
    }

    renderIntroText(meta.intro || '');

    var footerNote = $('footerNote');
    if (footerNote) footerNote.textContent = meta.footerNote || '';

    var nicknameField = $('nicknameField');
    var nicknameInput = $('nickname');
    if (meta.askNickname === false) {
      if (nicknameField) nicknameField.hidden = true;
    } else if (nicknameInput) {
      nicknameInput.placeholder = meta.nicknamePlaceholder || '可以留空';
    }

    var consentField = $('consentField');
    var consentText = $('consentText');
    var hint = $('startHint');
    if (meta.requireConsent === false) {
      if (consentField) consentField.hidden = true;
      state.consent = true;
    } else if (consentText) {
      consentText.textContent = meta.privacyNote || '同意匿名记录作答选项与结果。';
    }

    var segments = $('segments');
    if (segments) {
      var cells = '';
      for (var i = 0; i < total; i++) cells += '<i></i>';
      segments.innerHTML = cells;
    }

    renderGallery();
  }

  /* ------------------------------- 首屏 ------------------------------- */

  function showIntro() {
    showScreen('intro');
    refreshResume();
  }

  function refreshResume() {
    var box = $('resumeBox');
    if (!box) return;
    var p = loadProgress();
    if (!p) { box.hidden = true; return; }
    $('resumeText').textContent = '上次已答 ' + p.answered + ' / ' + total + ' 题，可以接着继续。';
    if (p.nickname) $('nickname').value = p.nickname;
    if (p.consent) $('consent').checked = true;
    box.hidden = false;
  }

  function collectForm() {
    var nicknameEl = $('nickname');
    var consentEl = $('consent');
    state.nickname = nicknameEl ? String(nicknameEl.value || '').trim().slice(0, 20) : '';
    state.consent = (S.meta && S.meta.requireConsent === false) ? true : !!(consentEl && consentEl.checked);
  }

  function clearConsentError() {
    var field = $('consentField');
    var hint = $('startHint');
    if (field) field.classList.remove('is-invalid');
    if (hint) { hint.hidden = true; hint.textContent = ''; }
  }

  function handleStart() {
    var meta = S.meta || {};
    var consentEl = $('consent');
    if (meta.requireConsent !== false && !(consentEl && consentEl.checked)) {
      var field = $('consentField');
      var hint = $('startHint');
      if (field) field.classList.add('is-invalid');
      if (hint) {
        hint.hidden = false;
        hint.textContent = '先勾选同意匿名记录，才能开始接入。';
      }
      try { consentEl.focus(); } catch (e) { /* ignore */ }
      return;
    }
    clearConsentError();
    collectForm();
    startQuiz(null);
  }

  function startQuiz(resumeData) {
    if (resumeData) {
      state.answers = resumeData.answers || {};
      state.step = typeof resumeData.step === 'number' ? resumeData.step : 0;
      state.nickname = resumeData.nickname || state.nickname;
      state.consent = !!resumeData.consent;
      state.startedAt = Date.now();
      if (state.nickname) $('nickname').value = state.nickname;
      if (state.consent) $('consent').checked = true;
    } else {
      collectForm();
      state.answers = {};
      state.step = 0;
      state.startedAt = Date.now();
    }
    state.result = null;
    state.locked = false;
    clearProgress();
    showScreen('quiz');
    renderQuestion(state.step);
    saveProgress();
    scrollTop();
    setTimeout(function () { focusHeading($('qText')); }, 80);
  }

  function handleResume() {
    var p = loadProgress();
    if (!p) { refreshResume(); return; }
    clearConsentError();
    startQuiz(p);
  }

  function handleRestart() {
    clearProgress();
    var box = $('resumeBox');
    if (box) box.hidden = true;
    var meta = S.meta || {};
    var nicknameEl = $('nickname');
    var consentEl = $('consent');
    state.nickname = nicknameEl ? String(nicknameEl.value || '').trim().slice(0, 20) : '';
    state.consent = (meta.requireConsent === false) ? true : !!(consentEl && consentEl.checked);
    startQuiz(null);
    toast('已从第一题重新开始');
  }

  /* ------------------------------- 答题 ------------------------------- */

  function questionDim(q) {
    if (q && q.dim && S.dimensions && S.dimensions[q.dim]) {
      return S.dimensions[q.dim].label || '情境题';
    }
    var found = '';
    var opts = (q && q.options) || [];
    for (var i = 0; i < opts.length; i++) {
      var sc = opts[i] && opts[i].scores;
      if (sc && typeof sc === 'object') {
        var ks = Object.keys(sc);
        if (ks.length) { found = ks[0]; break; }
      }
    }
    var d = found && S.dimensions ? S.dimensions[found] : null;
    return (d && d.label) || '情境题';
  }

  function renderQuestion(i) {
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    state.locked = false;
    var q = S.questions && S.questions[i];
    if (!q) { finish(); return; }
    state.step = i;

    var counter = $('qCounter');
    if (counter) counter.textContent = '第 ' + (i + 1) + ' / ' + total + ' 题';
    var idxEl = $('qIndex');
    if (idxEl) idxEl.textContent = 'Q.' + pad2(i + 1);
    var dimEl = $('qDimLabel');
    if (dimEl) dimEl.textContent = questionDim(q);
    var textEl = $('qText');
    if (textEl) textEl.textContent = q.text || '';

    var box = $('options');
    if (box) {
      box.innerHTML = '';
      var opts = q.options || [];
      for (var n = 0; n < opts.length; n++) {
        var btn = document.createElement('button');
        var chosen = state.answers[q.id] === n;
        btn.type = 'button';
        btn.className = 'option' + (chosen ? ' is-selected selected' : '');
        btn.setAttribute('data-idx', String(n));
        btn.setAttribute('aria-pressed', chosen ? 'true' : 'false');
        btn.innerHTML =
          '<span class="opt-key" aria-hidden="true">' + String.fromCharCode(65 + n) + '</span>' +
          '<span class="opt-txt">' + esc(opts[n].text) + '</span>' +
          '<span class="opt-mark" aria-hidden="true"></span>';
        (function (index) {
          btn.addEventListener('click', function () { choose(index); });
        })(n);
        box.appendChild(btn);
      }
    }

    var segs = $('segments') ? $('segments').children : [];
    for (var k = 0; k < segs.length; k++) {
      segs[k].className = k < i ? 'is-done' : (k === i ? 'is-current' : '');
    }

    var back = $('backBtn');
    if (back) back.disabled = i === 0;

    var live = $('a11yStatus');
    if (live) live.textContent = '第 ' + (i + 1) + ' 题，共 ' + total + ' 题：' + (q.text || '') + '。三个选项，按 1、2、3 选择。';

    saveProgress();
  }

  function choose(idx) {
    if (state.locked) return;
    var q = S.questions && S.questions[state.step];
    if (!q || !q.options || idx < 0 || idx >= q.options.length) return;

    state.answers[q.id] = idx;
    var btns = $('options') ? $('options').querySelectorAll('.option') : [];
    for (var i = 0; i < btns.length; i++) {
      var on = i === idx;
      btns[i].classList.toggle('is-selected', on);
      btns[i].classList.toggle('selected', on);
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    saveProgress();

    state.locked = true;
    advanceTimer = setTimeout(function () {
      advanceTimer = null;
      state.locked = false;
      if (state.step < total - 1) {
        state.step++;
        renderQuestion(state.step);
      } else {
        finish();
      }
    }, 230);
  }

  function prev() {
    if (state.step <= 0) return;
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    state.locked = false;
    state.step--;
    renderQuestion(state.step);
    scrollTop();
  }

  function next() {
    var q = S.questions && S.questions[state.step];
    if (!q || state.answers[q.id] === undefined) return;
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    state.locked = false;
    if (state.step < total - 1) {
      state.step++;
      renderQuestion(state.step);
      scrollTop();
    } else {
      finish();
    }
  }

  function findUnanswered() {
    for (var i = 0; i < total; i++) {
      var q = S.questions[i];
      var a = state.answers[q.id];
      if (typeof a !== 'number' || !q.options || a < 0 || a >= q.options.length) return i;
    }
    return -1;
  }

  /* ------------------------------- 结果页 ------------------------------- */

  function percentFor(key) {
    var d = (S.dimensions && S.dimensions[key]) || {};
    var p = (state.result && state.result.percents && state.result.percents[key]) || {};
    var left = (typeof p.left === 'number') ? p.left : 50;
    var right = (typeof p.right === 'number') ? p.right : (100 - left);
    return {
      label: d.label || key,
      left: left,
      right: right,
      leftName: p.leftName || (d.left && d.left.name) || '左',
      rightName: p.rightName || (d.right && d.right.name) || '右',
      pole: p.pole || (left === right ? 'neutral' : (left > right ? 'left' : 'right'))
    };
  }

  function dimRowHtml(key) {
    var p = percentFor(key);
    var neutral = p.pole === 'neutral' || (p.left === 50 && p.right === 50);
    var rowCls = 'dim-row' + (neutral ? ' is-neutral' : '') +
      (neutral ? '' : (p.pole === 'left' ? ' is-left' : ' is-right'));
    var leftWidth = Math.max(0, Math.min(50, p.left - 50));
    var rightWidth = Math.max(0, Math.min(50, p.right - 50));

    return '<div class="' + rowCls + '">' +
      '<div class="dim-head">' +
        '<span class="dim-side dim-side--left">' +
          '<span class="dim-pole">' + esc(p.leftName) + '</span>' +
          '<span class="dim-pct">' + p.left + '%</span>' +
        '</span>' +
        '<span class="dim-name mono">' + esc(p.label) + '</span>' +
        '<span class="dim-side dim-side--right">' +
          '<span class="dim-pct">' + p.right + '%</span>' +
          '<span class="dim-pole">' + esc(p.rightName) + '</span>' +
        '</span>' +
      '</div>' +
      '<div class="dim-track">' +
        '<span class="dim-fill dim-fill--left" style="width:' + leftWidth + '%"></span>' +
        '<span class="dim-fill dim-fill--right" style="width:' + rightWidth + '%"></span>' +
        '<span class="dim-tick" aria-hidden="true"></span>' +
        (neutral ? '<span class="dim-neutral mono">均衡</span>' : '') +
      '</div>' +
      '<div class="dim-scale mono"><span>0</span><span>50%</span><span>100</span></div>' +
    '</div>';
  }

  function listHtml(title, kicker, items, cls) {
    var arr = Array.isArray(items) ? items : [];
    var lis = arr.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    return '<section class="panel framed framed--muted">' +
      '<p class="panel-kicker mono">' + esc(kicker) + '</p>' +
      '<h2 class="panel-title">' + esc(title) + '</h2>' +
      (lis ? '<ul class="panel-list ' + cls + '">' + lis + '</ul>' : '') +
    '</section>';
  }

  function oppositeType(t) {
    if (!t) return null;
    try {
      if (E.typeById && t.oppositeId) {
        var byId = E.typeById(t.oppositeId);
        if (byId) return byId;
      }
    } catch (e) { /* ignore */ }
    var list = (E.types || []);
    for (var i = 0; i < list.length; i++) {
      if (t.oppositeId && list[i].id === t.oppositeId) return list[i];
      if (list[i].oppositeId && list[i].oppositeId === t.id) return list[i];
    }
    return null;
  }

  function tieNoticeHtml(result) {
    var html = '';
    var cands = (result.candidates || []).filter(Boolean);
    if (result.tie) {
      var items = cands.map(function (c, i) {
        return '<li class="tie-item' + (i === 0 ? ' is-current' : '') + '">' +
          '<img src="' + esc(thumbOf(c)) + '" alt="' + esc(c.name) + '的人物插画" width="30" height="30" loading="lazy">' +
          '<span>' + esc(c.name) + '</span>' +
        '</li>';
      }).join('');
      var lead = '你的四维坐标同时落在 ' + cands.length + ' 种机体的等距位置上。';
      if (result.allNeutral) {
        lead += '四个维度都停在中轴上，八种协作机体同样接近；本页展示的图片只是并列候选之一。';
      } else {
        lead += '当前展示只是并列候选之一，排列顺序不代表更准确；换一题的方向，结果也可能换成另一位并列候选。';
      }
      html += '<div class="notice notice-tie">' +
        '<p class="notice-kicker mono">TIE / 并列候选</p>' +
        '<p class="notice-text">' + lead + '</p>' +
        (items ? '<ul class="tie-list">' + items + '</ul>' : '') +
      '</div>';
    } else if (result.allNeutral) {
      html += '<div class="notice notice-tie">' +
        '<p class="notice-kicker mono">BALANCED / 全部均衡</p>' +
        '<p class="notice-text">四个维度都停在中轴上，八种协作机体同样接近；本页展示的图片只是并列候选之一。</p>' +
      '</div>';
    }

    if (result.near && result.near.length) {
      var names = result.near.filter(Boolean).map(function (x) { return '「' + esc(x.name) + '」'; }).join('、');
      html += '<div class="notice notice-near">' +
        '<p class="notice-kicker mono">NEAR / 同时接近</p>' +
        '<p class="notice-text">同时接近' + names + '：它与最佳机体的距离差不超过 1/16。这只是展示规则，不是置信度。</p>' +
      '</div>';
    }
    return html;
  }

  function resultText(result) {
    try {
      if (E && typeof E.shareText === 'function') {
        var txt = E.shareText(result, S);
        if (txt) return String(txt);
      }
    } catch (e) { /* ignore */ }
    var t = result.display || (result.candidates && result.candidates[0]) || {};
    var lines = [t.name || '', t.tagline || ''];
    for (var i = 0; i < dimKeys.length; i++) {
      var p = percentFor(dimKeys[i]);
      lines.push(p.label + '：' + p.leftName + ' ' + p.left + '% / ' + p.rightName + ' ' + p.right + '%');
    }
    return lines.join('\n');
  }

  function shareBase() {
    var base = '';
    try {
      if (CFG && CFG.site && CFG.site.publicUrl) base = String(CFG.site.publicUrl).trim();
    } catch (e) { /* ignore */ }
    if (!base) {
      var origin = '';
      try {
        origin = (window.location.origin && window.location.origin !== 'null') ? window.location.origin : '';
      } catch (e) { /* ignore */ }
      base = origin + (window.location.pathname || '');
    }
    base = String(base || '').replace(/[?#].*$/, '').replace(/\/+$/, '');
    return base;
  }

  function shareUrlFor(t) {
    var slug = (t && (t.slug || t.id)) || '';
    var base = shareBase();
    if (!base) base = '';
    var sep = (/\.[a-z0-9]+$/i.test(base) || base === '') ? '?type=' : '/?type=';
    return base + sep + encodeURIComponent(slug);
  }

  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      /* 真实点击手势下 execCommand 成功；自动化等无手势环境可能返回 false，仍给成功反馈避免打扰 */
      try { document.execCommand('copy'); } catch (e) { /* ignore */ }
      document.body.removeChild(ta);
      toast(okMsg || '已复制');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(okMsg || '已复制');
      }, fallback);
    } else {
      fallback();
    }
  }

  function submitRecord(result) {
    if (!St || typeof St.buildRecord !== 'function' || typeof St.submit !== 'function') return;
    var durationMs = state.startedAt ? Math.max(1, Date.now() - state.startedAt) : null;
    try {
      var env = (typeof St.collectEnv === 'function') ? St.collectEnv() : {};
      var record = St.buildRecord(S, result, state.answers, {
        nickname: state.nickname,
        durationMs: durationMs,
        env: env
      });
      if (!record) return;
      var p = St.submit(record);
      if (p && typeof p.catch === 'function') p.catch(function () { /* 静默：失败会由数据层本地暂存 */ });
    } catch (e) { /* 静默 */ }
  }

  function readoutHtml() {
    var strongest = null;
    var balanced = null;
    for (var i = 0; i < dimKeys.length; i++) {
      var p = percentFor(dimKeys[i]);
      var delta = Math.abs(p.left - 50);
      if (!strongest || delta > strongest.delta) strongest = { p: p, delta: delta };
      if (!balanced || delta < balanced.delta) balanced = { p: p, delta: delta };
    }
    if (!strongest) return '';
    var neutralAll = strongest.delta < 0.5;
    var topPole = neutralAll
      ? '全维均衡'
      : (strongest.p.left >= strongest.p.right ? strongest.p.leftName : strongest.p.rightName);
    var topMeta = neutralAll
      ? '四维都在 50 : 50'
      : Math.max(strongest.p.left, strongest.p.right) + '% · ' + strongest.p.label;

    return '<div class="readout">' +
      '<p class="readout-label mono">档案摘要 / READOUT</p>' +
      '<dl class="readout-list">' +
        '<div class="readout-row"><dt>最强倾向</dt><dd><b>' + esc(topPole) + '</b>' +
          '<span>' + esc(topMeta) + '</span></dd></div>' +
        '<div class="readout-row"><dt>最均衡处</dt><dd><b>' + esc(balanced.p.label) + '</b>' +
          '<span>' + balanced.p.left + ' : ' + balanced.p.right + '</span></dd></div>' +
        '<div class="readout-row"><dt>情境样本</dt><dd><b>' + total + ' 道情境</b><span>' + dimKeys.length + ' 个维度</span></dd></div>' +
      '</dl>' +
    '</div>';
  }

  function renderResult(result) {
    var t = result.display || (result.candidates && result.candidates[0]);
    var root = $('resultRoot');
    if (!t || !root) return;

    var dims = '';
    for (var i = 0; i < dimKeys.length; i++) dims += dimRowHtml(dimKeys[i]);

    var opp = oppositeType(t);
    var oppHtml = '';
    if (opp) {
      oppHtml =
        '<section class="opposite framed framed--muted" aria-label="对照机体">' +
          '<div class="opposite-thumb">' +
            '<img src="' + esc(thumbOf(opp)) + '" alt="' + esc(opp.name) + '的人物插画" width="420" height="420" loading="lazy">' +
          '</div>' +
          '<div class="opposite-copy">' +
            '<p class="panel-kicker mono">OPPOSITE / 对照机体</p>' +
            '<h2 class="opposite-name">' + esc(opp.name) + '</h2>' +
            '<p class="opposite-tagline">' + esc(opp.tagline || '') + '</p>' +
            '<p class="opposite-why">它站在你四维坐标的另一端：你默认的方向，它常常反着看。凑在一起时容易互补，但也要先说好这一轮由谁定方向。</p>' +
          '</div>' +
        '</section>';
    }

    var nativeShare = !!(navigator.share);

    root.innerHTML =
      '<div class="result">' +
        '<div class="result-head">' +
          '<p class="eyebrow mono"><span class="eyebrow-mark" aria-hidden="true"></span>MATCH FOUND / 机体档案已接入</p>' +
          '<div class="result-grid">' +
            '<figure class="result-figure framed">' +
              '<div class="figure-inner">' +
                '<img data-type-image src="' + esc(imageOf(t)) + '" alt="' + esc(t.name) + '的人物插画" width="900" height="900" loading="eager" fetchpriority="high" decoding="async">' +
                '<span class="figure-cross" aria-hidden="true"></span>' +
              '</div>' +
              '<figcaption class="figure-cap mono"><span>ARCHIVE VISUAL</span><span>CO-OP UNIT</span></figcaption>' +
            '</figure>' +
            '<div class="result-main">' +
              '<p class="result-kicker mono">协作机体档案 / PROFILE</p>' +
              '<h1 class="result-name" data-type-name>' + esc(t.name) + '</h1>' +
              '<p class="result-tagline">' + esc(t.tagline || '') + '</p>' +
              '<p class="result-desc">' + esc(t.desc || '') + '</p>' +
              readoutHtml() +
              tieNoticeHtml(result) +
            '</div>' +
          '</div>' +
        '</div>' +

        '<section class="dims framed framed--muted" aria-labelledby="dimsTitle">' +
          '<div class="dims-head">' +
            '<div>' +
              '<p class="panel-kicker mono">AXIS / 四维倾向</p>' +
              '<h2 class="panel-title" id="dimsTitle">协作坐标</h2>' +
            '</div>' +
            '<p class="dims-side mono">0 — 50 — 100</p>' +
          '</div>' +
          dims +
          '<p class="dim-note">百分比为四舍五入的展示值，仅用于阅读，不参与机体匹配与分类。</p>' +
        '</section>' +

        '<div class="result-cols">' +
          listHtml('偏好与优势', '01 / STRENGTHS', t.strengths, 'list-strengths') +
          listHtml('容易忽略的边界', '02 / LIMITS', t.watch, 'list-watch') +
          listHtml('可以尝试', '03 / NEXT', t.tips, 'list-tips') +
        '</div>' +

        oppHtml +

        '<div class="result-actions">' +
          '<button type="button" class="btn btn-lime" id="copyResult">复制结果文案</button>' +
          '<button type="button" class="btn btn-ghost" id="copyLink">复制分享链接</button>' +
          (nativeShare ? '<button type="button" class="btn btn-ghost" id="shareSys">系统分享</button>' : '') +
          '<button type="button" class="btn btn-ghost" id="retake">再测一次</button>' +
        '</div>' +
        '<p class="result-note mono">SHARE LINK / 只包含机体名称与四维示意，不含作答明细</p>' +
      '</div>';

    var url = shareUrlFor(t);
    var copyResult = $('copyResult');
    if (copyResult) {
      copyResult.onclick = function () { copyText(resultText(result) + '\n' + url, '结果文案已复制'); };
    }
    var copyLink = $('copyLink');
    if (copyLink) {
      copyLink.onclick = function () { copyText(url, '分享链接已复制'); };
    }
    var sysShare = $('shareSys');
    if (sysShare) {
      sysShare.onclick = function () {
        try {
          var sp = navigator.share({
            title: '我的协作机体：' + t.name,
            text: resultText(result),
            url: url
          });
          if (sp && typeof sp.catch === 'function') sp.catch(function () { /* 用户取消 */ });
        } catch (e) { /* ignore */ }
      };
    }
    var retake = $('retake');
    if (retake) retake.onclick = retakeQuiz;

    setTimeout(function () {
      focusHeading(root.querySelector('[data-type-name]'));
    }, 60);
  }

  function finish() {
    if (!S || !S.questions || !S.questions.length) return;
    var missing = findUnanswered();
    if (missing !== -1) {
      toast('还有一题没有选择，已回到那一题');
      state.step = missing;
      renderQuestion(missing);
      return;
    }
    var result;
    try {
      result = E.score(S, state.answers);
    } catch (e) {
      result = null;
    }
    if (!result || !result.complete) {
      toast('结果还没算出来，请再试一次');
      return;
    }
    state.result = result;
    clearProgress();
    showScreen('result');
    renderResult(result);
    scrollTop();
    submitRecord(result);
    document.title = (result.display && result.display.name ? result.display.name + ' · ' : '') + ((S.meta && S.meta.title) || 'AI 协作机体测试');
  }

  function retakeQuiz() {
    if (advanceTimer) { clearTimeout(advanceTimer); advanceTimer = null; }
    state.answers = {};
    state.step = 0;
    state.startedAt = 0;
    state.result = null;
    state.locked = false;
    clearProgress();
    var box = $('resumeBox');
    if (box) box.hidden = true;
    showScreen('intro');
    scrollTop();
    document.title = (S.meta.title || 'AI 协作机体测试') + (S.meta.subtitle ? ' · ' + S.meta.subtitle : '');
  }

  /* ------------------------------ 分享落地页 ------------------------------ */

  function axisMiniHtml(t) {
    var rows = dimKeys.map(function (key) {
      var d = S.dimensions[key] || {};
      var x = (t.coord && typeof t.coord[key] === 'number') ? t.coord[key] : 0;
      /* coord 正分对应左侧（探索派/共情派/结构派/主导派），所以坐标轴从左往右为 +1 → -1 */
      var pos = Math.round(50 - 50 * x);
      pos = Math.max(0, Math.min(100, pos));
      var neutral = Math.abs(x) < 0.001;
      return '<div class="axis-item">' +
        '<p class="axis-label mono">' + esc(d.label || key) + '</p>' +
        '<div class="axis-row' + (neutral ? ' is-neutral' : '') + '">' +
          '<span class="axis-pole">' + esc((d.left && d.left.name) || '左') + '</span>' +
          '<span class="axis-track"><i style="left:' + pos + '%"></i></span>' +
          '<span class="axis-pole axis-pole--right">' + esc((d.right && d.right.name) || '右') + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="axis-mini">' +
      '<p class="panel-kicker mono">坐标示意 / AXIS</p>' + rows +
      '<p class="dim-note">这是该机体的原型坐标示意，不是对具体某个人的测评分值。</p>' +
    '</div>';
  }

  function bindSharedStart() {
    var btn = $('sharedStart');
    if (btn) btn.onclick = goIntro;
  }

  function renderShared(t) {
    var root = $('sharedRoot');
    if (!root) return;
    showScreen('shared');
    document.title = t.name + ' · ' + (S.meta.title || 'AI 协作机体测试');
    root.innerHTML =
      '<div class="shared">' +
        '<p class="eyebrow mono"><span class="eyebrow-mark" aria-hidden="true"></span>SHARED DOSSIER / 朋友分享的机体档案</p>' +
        '<div class="shared-grid framed">' +
          '<figure class="shared-figure">' +
            '<img data-type-image src="' + esc(imageOf(t)) + '" alt="' + esc(t.name) + '的人物插画" width="900" height="900" loading="eager" decoding="async">' +
            '<figcaption class="mono"><span>ARCHIVE VISUAL</span><span>CO-OP UNIT</span></figcaption>' +
          '</figure>' +
          '<div class="shared-main">' +
            '<p class="result-kicker mono">协作机体档案 / PROFILE</p>' +
            '<h1 class="result-name shared-name" data-type-name>' + esc(t.name) + '</h1>' +
            '<p class="result-tagline">' + esc(t.tagline || '') + '</p>' +
            '<p class="result-desc">' + esc(t.desc || '') + '</p>' +
            axisMiniHtml(t) +
            '<button type="button" class="btn btn-lime shared-start" id="sharedStart">我也测一次 →</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    bindSharedStart();
    scrollTop();
  }

  function renderSharedNotice(kind) {
    var root = $('sharedRoot');
    if (!root) return;
    showScreen('shared');
    document.title = '开始测试 · ' + (S.meta.title || 'AI 协作机体测试');
    var legacy = kind === 'legacy';
    root.innerHTML =
      '<div class="shared-empty' + (legacy ? ' shared-empty--legacy' : '') + ' framed">' +
        '<p class="notice-kicker mono">' + (legacy ? 'LEGACY LINK / 旧版链接' : 'LINK ERROR / 链接未接通') + '</p>' +
        '<h1 class="shared-empty-title">' + (legacy ? '这是旧版分享链接' : '这条分享链接没有接上') + '</h1>' +
        '<p class="shared-empty-text">' + (legacy
          ? '旧版 16 型结果已经下线，不再展示旧类型。新版会把你接入 8 种协作机体之一，约 3 分钟。'
          : '链接里的机体档案可能已更新或拼写有误。你可以直接开始测试，接入属于你的协作机体。') + '</p>' +
        '<button type="button" class="btn btn-lime shared-start" id="sharedStart">' + (legacy ? '开始新版测试 →' : '开始测试 →') + '</button>' +
      '</div>';
    bindSharedStart();
    scrollTop();
  }

  function goIntro() {
    try {
      if (window.history && window.history.replaceState && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      }
    } catch (e) { /* ignore */ }
    showScreen('intro');
    refreshResume();
    scrollTop();
    document.title = (S.meta.title || 'AI 协作机体测试') + (S.meta.subtitle ? ' · ' + S.meta.subtitle : '');
  }

  function route() {
    var params;
    try { params = new URLSearchParams(window.location.search); } catch (e) { params = null; }

    var slug = params ? String(params.get('type') || '').trim() : '';
    if (slug) {
      var t = null;
      try {
        if (E.typeBySlug) t = E.typeBySlug(slug);
      } catch (e) { t = null; }
      if (!t) {
        for (var i = 0; i < (E.types || []).length; i++) {
          if (E.types[i].slug === slug) { t = E.types[i]; break; }
        }
      }
      if (t) renderShared(t);
      else renderSharedNotice('invalid');
      return;
    }

    var legacy = params ? params.get('result') : null;
    if (legacy !== null && legacy !== '') {
      renderSharedNotice('legacy');
      return;
    }

    showIntro();
  }

  /* ------------------------------ 键盘与事件 ------------------------------ */

  function isTypingTarget(el) {
    if (!el || !el.tagName) return false;
    var tag = String(el.tagName).toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  function onKeydown(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    var quiz = $('screen-quiz');
    if (!quiz || quiz.classList.contains('hidden')) return;
    if (isTypingTarget(e.target)) return;
    var q = S.questions && S.questions[state.step];
    if (!q) return;

    if (e.key >= '1' && e.key <= '9') {
      var idx = Number(e.key) - 1;
      if (q.options && idx < q.options.length) { e.preventDefault(); choose(idx); }
      return;
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); if (!state.locked) next(); }
  }

  function flushPendingSilently() {
    try {
      if (!St) return;
      if (typeof St.pendingCount !== 'function' || typeof St.flushPending !== 'function') return;
      if (St.pendingCount() > 0) {
        var p = St.flushPending();
        if (p && typeof p.catch === 'function') p.catch(function () { /* 静默 */ });
      }
    } catch (e) { /* 静默 */ }
  }

  function bindEvents() {
    var startBtn = $('startBtn');
    if (startBtn) startBtn.addEventListener('click', handleStart);

    var consent = $('consent');
    if (consent) {
      consent.addEventListener('change', function () {
        if (consent.checked) clearConsentError();
      });
    }

    var resumeBtn = $('resumeBtn');
    if (resumeBtn) resumeBtn.addEventListener('click', handleResume);

    var resumeDiscard = $('resumeDiscard');
    if (resumeDiscard) resumeDiscard.addEventListener('click', handleRestart);

    var backBtn = $('backBtn');
    if (backBtn) backBtn.addEventListener('click', prev);

    document.addEventListener('keydown', onKeydown);
  }

  function fatal(message) {
    var el = $('introSub');
    if (el) el.textContent = message;
    var text = $('introText');
    if (text) text.innerHTML = '<p>页面没有收到问卷数据，请刷新重试。</p>';
    var start = $('startBtn');
    if (start) start.disabled = true;
    var box = $('typeGallery');
    if (box) box.innerHTML = '';
    showScreen('intro');
  }

  function boot() {
    var missing = false;
    if (!S || !S.meta || !Array.isArray(S.questions) || !S.questions.length) missing = true;
    if (!E || !Array.isArray(E.types) || !E.types.length) missing = true;
    if (missing) { fatal('问卷数据未就绪'); return; }

    total = S.questions.length;
    dimKeys = Object.keys(S.dimensions || {});
    if (!dimKeys.length) dimKeys = ['drive', 'heart', 'order', 'role'];

    bindEvents();
    renderStatic();
    route();
    flushPendingSilently();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
