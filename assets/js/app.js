/* =============================================================================
 *  前台交互逻辑（首屏 → 答题 → 结果 → 上报）
 * ========================================================================== */

(function () {
  'use strict';

  var S = window.SURVEY;
  var E = window.Engine;
  var St = window.Store;
  var CFG = window.APP_CONFIG || {};
  var PROGRESS_KEY = 'aipt:progress:v1';

  var state = { step: 0, answers: {}, startedAt: 0, nickname: '', consent: false, result: null };

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ------------------------------- Toast ------------------------------- */

  var toastTimer = null;
  function toast(msg, kind, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show ' + (kind || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast ' + (kind || ''); }, ms || 3200);
  }

  /* ------------------------------ 进度暂存 ------------------------------ */

  function saveProgress() {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify({
        answers: state.answers, step: state.step,
        nickname: state.nickname, consent: state.consent,
        surveyVersion: S.meta.version, at: Date.now()
      }));
    } catch (e) { /* ignore */ }
  }
  function loadProgress() {
    try {
      var raw = localStorage.getItem(PROGRESS_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      if (!p || p.surveyVersion !== S.meta.version) return null;
      if (!p.answers || !Object.keys(p.answers).length) return null;
      return p;
    } catch (e) { return null; }
  }
  function clearProgress() {
    try { localStorage.removeItem(PROGRESS_KEY); } catch (e) { /* ignore */ }
  }

  /* -------------------------------- 首屏 -------------------------------- */

  function backendLabel() {
    var b = CFG.backend || 'local';
    if (b === 'supabase') return { text: '数据已接入云端', cls: 'chip grad' };
    if (b === 'custom') return { text: '数据已接入自定义接口', cls: 'chip grad' };
    return { text: '本地预览模式', cls: 'chip' };
  }

  function initIntro() {
    var meta = S.meta;
    document.title = meta.title + ' · ' + meta.subtitle;
    $('brandName').textContent = (CFG.site && CFG.site.name) || meta.title;
    $('introTitle').textContent = meta.title;
    $('introSub').textContent = meta.subtitle;
    $('metaCount').textContent = S.questions.length + ' 道题';
    $('metaTime').textContent = meta.estimated || '';
    $('introText').textContent = meta.intro || '';
    $('footerNote').textContent = meta.footerNote || '';

    var bl = backendLabel();
    $('backendChip').textContent = bl.text;
    $('backendChip').className = bl.cls;

    if (meta.askNickname) {
      $('nickname').placeholder = meta.nicknamePlaceholder || '昵称（可留空）';
    } else {
      $('nicknameField').classList.add('hidden');
    }
    if (meta.requireConsent) {
      $('consentText').textContent = meta.privacyNote || '同意匿名记录作答数据。';
    } else {
      $('consentField').classList.add('hidden');
      state.consent = true;
    }

    // 16 型速览
    var codes = Object.keys(E.TYPES);
    var grid = $('typeGrid');
    if (grid) {
      grid.innerHTML = codes.map(function (c) {
        var t = E.TYPES[c];
        return '<div class="type-mini"><span class="em">' + t.emoji + '</span><span class="nm">' + esc(t.name) +
          '</span><span class="cd">' + c + '</span></div>';
      }).join('');
    }

    // 续答入口
    var p = loadProgress();
    if (p) {
      var n = Object.keys(p.answers).length;
      var resume = $('resumeBox');
      resume.classList.remove('hidden');
      $('resumeText').textContent = '检测到上次未完成的测试（已答 ' + n + '/' + S.questions.length + ' 题）';
      $('resumeBtn').onclick = function () {
        state.answers = p.answers;
        state.step = Math.min(p.step || 0, S.questions.length - 1);
        state.nickname = p.nickname || '';
        state.consent = !!p.consent;
        if (state.nickname) $('nickname').value = state.nickname;
        if (state.consent) $('consent').checked = true;
        startQuiz();
      };
      $('resumeDiscard').onclick = function () {
        clearProgress(); resume.classList.add('hidden'); toast('已清除上次进度');
      };
    }
  }

  /* -------------------------------- 答题 -------------------------------- */

  function showScreen(name) {
    ['intro', 'quiz', 'result', 'shared'].forEach(function (k) {
      var el = $('screen-' + k);
      if (el) el.classList.toggle('hidden', k !== name);
    });
  }

  function startQuiz() {
    if (!state.startedAt) state.startedAt = Date.now();
    showScreen('quiz');
    renderQuestion(state.step);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderQuestion(i) {
    var q = S.questions[i];
    if (!q) return finish();
    var total = S.questions.length;
    $('qCounter').textContent = '第 ' + (i + 1) + ' / ' + total + ' 题';
    var pct = Math.round(((i + 1) / total) * 100);
    $('qPct').textContent = pct + '%';
    $('progressFill').style.width = pct + '%';
    $('qIndex').textContent = 'QUESTION ' + (i + 1 < 10 ? '0' : '') + (i + 1);
    $('qText').textContent = q.text;

    var box = $('options');
    box.innerHTML = '';
    q.options.forEach(function (opt, idx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'option' + (state.answers[q.id] === idx ? ' selected' : '');
      b.setAttribute('data-idx', String(idx));
      b.innerHTML = '<span class="key">' + (idx + 1) + '</span><span class="txt">' + esc(opt.text) + '</span>';
      b.addEventListener('click', function () { choose(idx, true); });
      box.appendChild(b);
    });

    $('backBtn').style.visibility = i === 0 ? 'hidden' : 'visible';
    var card = $('qCard');
    card.classList.remove('fade-in');
    void card.offsetWidth;
    card.classList.add('fade-in');
  }

  var locked = false;
  function choose(idx, autoNext) {
    if (locked) return;
    var q = S.questions[state.step];
    if (!q) return;
    state.answers[q.id] = idx;
    var btns = $('options').querySelectorAll('.option');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('selected', i === idx);
    saveProgress();
    if (idx === q.options.length - 1 && !autoNext) return;
    if (autoNext) {
      locked = true;
      setTimeout(function () {
        locked = false;
        next();
      }, 190);
    }
  }

  function next() {
    if (state.step < S.questions.length - 1) {
      state.step++;
      renderQuestion(state.step);
    } else {
      finish();
    }
  }

  function prev() {
    if (state.step > 0) {
      state.step--;
      renderQuestion(state.step);
    }
  }

  /* -------------------------------- 结果 -------------------------------- */

  function matchPanel(result) {
    var self = E.TYPES[result.code];
    var flip = E.TYPES[E.flipCode(result.code)];
    if (!self) return '';
    return '<div class="match">' +
      (flip ? '<div class="panel"><div class="who">🧲 互补搭子 · ' + esc(flip.name) + '</div>' +
        '<div class="why">你们的四个维度正好互补，凑在一起既有想象力也有执行力，但需要说好谁做决定。</div></div>' : '') +
      '<div class="panel"><div class="who">🪞 同频同类 · ' + esc(self.name) + '</div>' +
      '<div class="why">和你一样是 ' + esc(result.code) + '。你们沟通成本极低，但也要小心一起掉进同一个坑。</div></div>' +
      '</div>';
  }

  function listPanel(title, items) {
    if (!items || !items.length) return '';
    return '<div class="panel"><h3>' + title + '</h3><ul>' +
      items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
  }

  function renderResult(result) {
    var t = E.TYPES[result.code];
    if (!t) return;
    var dims = Object.keys(S.dimensions).map(function (k) {
      var p = result.percents[k];
      var d = S.dimensions[k];
      return '<div class="dim">' +
        '<div class="dim-label">' + esc(d.label) + '</div>' +
        '<div class="dim-top"><span class="left">' + esc(p.leftName) + ' ' + p.left + '%</span>' +
        '<span class="right">' + p.right + '% ' + esc(p.rightName) + '</span></div>' +
        '<div class="dim-bar"><i data-pct="' + p.left + '"></i></div>' +
        '</div>';
    }).join('');

    $('screen-result').innerHTML =
      '<div class="card result-card">' +
        '<div class="type-emoji">' + t.emoji + '</div>' +
        '<div class="type-code">' + esc(result.code) + '</div>' +
        '<h1 class="type-name">' + esc(t.name) + '</h1>' +
        '<p class="type-tag">' + esc(t.tagline) + '</p>' +
        '<p class="type-desc">' + esc(t.desc) + '</p>' +
        '<div class="dims">' + dims + '</div>' +
        listPanel('💪 你的优势', t.strengths) +
        listPanel('⚠️ 容易踩的坑', t.watch) +
        listPanel('🚀 给你的 3 条建议', t.tips) +
        matchPanel(result) +
        '<div class="btn-row center" style="margin-top:18px">' +
          '<button class="btn btn-primary" id="shareCopy">复制结果文案</button>' +
          '<button class="btn" id="shareLink">复制分享链接</button>' +
          '<button class="btn" id="shareSys">系统分享</button>' +
          '<button class="btn btn-ghost" id="retake">再测一次</button>' +
        '</div>' +
        '<p class="faint" id="uploadHint" style="margin-top:16px"></p>' +
      '</div>';

    $('uploadHint').textContent = '作答已结束，感谢你的参与 🙌';

    requestAnimationFrame(function () {
      var bars = $('screen-result').querySelectorAll('.dim-bar > i');
      for (var i = 0; i < bars.length; i++) {
        (function (b, n) {
          setTimeout(function () { b.style.width = b.getAttribute('data-pct') + '%'; }, 120 + n * 90);
        })(bars[i], i);
      }
    });

    var shareUrl = shareUrlFor(result.code);

    $('shareCopy').onclick = function () {
      copyText(E.shareText(result, S) + '\n' + shareUrl, '结果文案已复制');
    };
    $('shareLink').onclick = function () { copyText(shareUrl, '分享链接已复制'); };
    var sys = $('shareSys');
    if (navigator.share) {
      sys.onclick = function () {
        navigator.share({ title: '我的 AI 人格：' + t.name, text: E.shareText(result, S), url: shareUrl })
          .catch(function () { /* 用户取消 */ });
      };
    } else {
      sys.classList.add('hidden');
    }
    $('retake').onclick = function () {
      state = { step: 0, answers: {}, startedAt: 0, nickname: '', consent: state.consent, result: null };
      clearProgress();
      showScreen('intro');
      initIntro();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };
  }

  function shareUrlFor(code) {
    var base = (CFG.site && CFG.site.publicUrl) ? CFG.site.publicUrl : (location.origin + location.pathname);
    return base.replace(/[?#].*$/, '') + '?result=' + encodeURIComponent(code);
  }

  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(okMsg || '已复制', 'ok'); }
      catch (e) { toast('复制失败，请手动选择文本', 'err'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg || '已复制', 'ok'); }, fallback);
    } else fallback();
  }

  /* ------------------------------ 完成 & 上报 ------------------------------ */

  function finish() {
    var result = E.score(S, state.answers);
    state.result = result;
    showScreen('result');
    renderResult(result);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    clearProgress();

    var record = St.buildRecord(S, result, state.answers, {
      nickname: state.nickname,
      durationMs: state.startedAt ? (Date.now() - state.startedAt) : null,
      env: St.collectEnv()
    });
    St.submit(record).then(function (res) {
      var el = $('uploadHint');
      var isLocal = (CFG.backend || 'local') === 'local';
      if (res.ok) {
        if (el) el.textContent = isLocal
          ? '✅ 已保存在本机（当前是本地预览模式，接入后台后数据会自动汇总）。'
          : '✅ 作答数据已记录，谢谢你的贡献。';
        return;
      }
      if (res.queued) {
        if (el) el.textContent = '⚠️ 网络不太稳定，数据已暂存在本机，下次打开会自动补传。';
        toast('数据已暂存，下次自动补传', 'warn');
        return;
      }
      if (el) el.textContent = 'ℹ️ 当前未接入后台，数据只保存在本机浏览器里。';
    });
  }

  /* ------------------------------ 分享落地页 ------------------------------ */

  function showShared(code) {
    var t = E.TYPES[code];
    if (!t) { toast('分享链接里的类型代码无效'); return; }
    showScreen('shared');
    var el = $('screen-shared');
    el.innerHTML =
      '<div class="card result-card">' +
        '<p class="faint" style="margin-bottom:14px">你打开了朋友分享的 AI 人格结果</p>' +
        '<div class="type-emoji">' + t.emoji + '</div>' +
        '<div class="type-code">' + esc(code) + '</div>' +
        '<h1 class="type-name">' + esc(t.name) + '</h1>' +
        '<p class="type-tag">' + esc(t.tagline) + '</p>' +
        '<p class="type-desc">' + esc(t.desc) + '</p>' +
        listPanel('💪 这个类型的优势', t.strengths) +
        listPanel('⚠️ 容易踩的坑', t.watch) +
        '<div class="btn-row center" style="margin-top:18px">' +
          '<button class="btn btn-primary" id="sharedStart">我也要测 →</button>' +
        '</div>' +
      '</div>';
    $('sharedStart').onclick = function () {
      showScreen('intro');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      startQuiz();
    };
  }

  /* ------------------------------ 键盘快捷键 ------------------------------ */

  document.addEventListener('keydown', function (e) {
    if ($('screen-quiz').classList.contains('hidden')) return;
    var q = S.questions[state.step];
    if (!q) return;
    if (e.key >= '1' && e.key <= '9') {
      var idx = Number(e.key) - 1;
      if (idx < q.options.length) { e.preventDefault(); choose(idx, true); }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault(); prev();
    } else if (e.key === 'ArrowRight' && state.answers[q.id] !== undefined) {
      e.preventDefault(); next();
    }
  });

  /* -------------------------------- 启动 -------------------------------- */

  function boot() {
    initIntro();
    var m = /[?&]result=([A-Za-z]{4})/.exec(location.search);
    if (m) showShared(m[1].toUpperCase());

    $('startBtn').onclick = function () {
      if (S.meta.requireConsent && !$('consent').checked) {
        toast('请先勾选同意后再开始', 'warn');
        return;
      }
      state.consent = $('consent').checked;
      state.nickname = ($('nickname').value || '').trim().slice(0, 20);
      startQuiz();
    };
    $('backBtn').onclick = prev;
    $('nextBtn') && ($('nextBtn').onclick = next);

    // 补传上次没发出去的数据
    if (St.pendingCount() > 0) {
      St.flushPending().then(function (r) {
        if (r.sent > 0) toast('已补传 ' + r.sent + ' 条暂存数据', 'ok');
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
