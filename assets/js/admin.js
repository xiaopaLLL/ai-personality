/* =============================================================================
 *  数据后台逻辑：登录 → 拉取 → 统计 → 明细 → 导出
 * ========================================================================== */

(function () {
  'use strict';

  var S = window.SURVEY;
  var E = window.Engine;
  var St = window.Store;
  var CFG = window.APP_CONFIG || {};
  var BACKEND = CFG.backend || 'local';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  var pct = function (n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; };

  var state = {
    rows: [],
    localRows: [],
    mergeLocal: false,
    range: 'all',
    from: '',
    to: '',
    code: '',
    kw: '',
    page: 1,
    pageSize: (CFG.admin && CFG.admin.pageSize) || 50,
    expanded: {},
    loading: false
  };

  function toast(msg, kind, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show ' + (kind || '');
    clearTimeout(toast.__t);
    toast.__t = setTimeout(function () { el.className = 'toast ' + (kind || ''); }, ms || 3000);
  }

  function notice(html, kind) {
    var el = $('notice');
    if (!html) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.className = 'notice ' + (kind || '');
    el.innerHTML = html;
  }

  /** 加载成功后只清掉「读取失败」这类错误提示，别把本地模式/自定义接口的常驻提示也清掉 */
  function clearErrorNotice() {
    var el = $('notice');
    if (el && !el.classList.contains('hidden') && el.className.indexOf('err') >= 0) notice('', '');
  }

  /* ------------------------------- 登录 ------------------------------- */

  function renderLogin(errMsg, rawMsg) {
    $('viewLogin').classList.remove('hidden');
    $('viewDash').classList.add('hidden');
    if (errMsg) {
      $('loginMsg').innerHTML = '<div class="notice err"><b>登录失败</b><br>' + errMsg +
        (rawMsg ? '<div class="raw-err">Supabase 原始返回：' + esc(rawMsg) + '</div>' : '') +
        '</div>';
    } else {
      $('loginMsg').innerHTML = '';
    }
  }

  function renderDash() {
    $('viewLogin').classList.add('hidden');
    $('viewDash').classList.remove('hidden');
  }

  /* --------------------------- 错误翻译（说人话） --------------------------- */

  function rawOf(err) { return (err && err.message) || String(err || ''); }

  /** 登录失败时说清楚到底哪里错了 */
  function explainAuthError(err) {
    var msg = rawOf(err);
    var status = err && err.status;
    if (/请先在 config/.test(msg)) return msg;
    if (/Invalid login credentials|invalid_credentials/i.test(msg)) {
      return '邮箱或密码不对。也可能是：① 这个账号不是在 Authentication → Users 里建的；' +
        '② 建用户时没勾 Auto Confirm User（邮箱没确认，登录会被拒）；③ 密码记错了——' +
        '可以在 Supabase 里给该用户 Reset password 重设一个。';
    }
    if (/Email not confirmed|email_not_confirmed/i.test(msg)) {
      return '账号存在，但邮箱还没确认。去 Supabase → Authentication → Users，找到这个用户，' +
        '点右侧「…」→ Confirm email；或者删掉重建，创建时勾选 Auto Confirm User。';
    }
    if (/User not found|user_not_found/i.test(msg)) {
      return '这个邮箱在 Supabase 里不存在。去 Authentication → Users → Add user 新建一个（记得勾 Auto Confirm User）。';
    }
    if (/Invalid API key|No API key|invalid_api_key/i.test(msg)) {
      return '这个 anonKey 被 Supabase 拒绝了（Invalid API key），所以连登录接口都调不通。' +
        '最常见原因是复制时多/少了一个字符（比如 key 结尾的签名长度不对），其次是 key 和 URL 不是同一个项目，' +
        '或者把 service_role 密钥当成了 anon key。点下面「运行诊断」，第一屏就能看出是哪种。';
    }
    if (/rate limit|Too many requests|over_email_send_rate_limit|too_many_requests/i.test(msg)) {
      return '短时间内失败太多次，被 Supabase 限流了。等 5~10 分钟再试。';
    }
    if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(msg)) {
      return '请求根本发不出去。检查：① config.js 的 supabase.url 是否写错；② 页面是不是用 file:// 直接打开的（要用 http 地址）；' +
        '③ 网络/代理是否拦了 *.supabase.co。点下面「运行诊断」看具体卡在哪一步。';
    }
    if (/Auth session missing|session_not_found/i.test(msg)) return '登录状态丢了，重新登录一次即可。';
    if (status === 401 || status === 403) {
      return '认证被拒绝（HTTP ' + status + '）。多半是 url 和 anonKey 不是同一个项目，' +
        '或者把 service_role / JWT Secret 当成 anon key 填进去了。建议点「运行诊断」逐项检查。';
    }
    return msg || '未知错误';
  }

  /** 拉数据失败时说清楚到底哪里错了 */
  function explainDataError(err) {
    var msg = rawOf(err);
    var status = err && err.status;
    var code = err && err.data && (err.data.code || err.data.error_code);
    if (code === 'PGRST205' || /Could not find the table|does not exist|relation .* does not exist/i.test(msg)) {
      return '❌ 数据表不存在：<code>' + esc((CFG.supabase || {}).table || '') + '</code>。' +
        '解决：打开 Supabase → SQL Editor → 把 <code>supabase/schema.sql</code> 全文粘贴 → Run。';
    }
    if (status === 401 || /permission denied|Invalid API key/i.test(msg)) {
      return '❌ 没有读取权限（HTTP ' + status + '）。两种情况：① 你还没登录成功；' +
        '② <code>schema.sql</code> 里的 RLS 读取策略没跑上（auth_can_read）。请重跑一遍 schema.sql，然后退出重新登录。';
    }
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      return '❌ 连不上 Supabase：检查 <code>config.js</code> 的 <code>supabase.url</code>、页面是否用 http 打开、网络是否通。';
    }
    return '❌ 读取数据失败：' + esc(msg) + '（可点右上角「运行诊断」看详细原因）';
  }

  /* ------------------------------ 数据加载 ------------------------------ */

  function load() {
    if (state.loading) return;
    state.loading = true;
    $('refreshBtn').disabled = true;
    var p = St.admin.fetchRows({ limit: 5000 });
    p.then(function (rows) {
      state.rows = (rows || []).map(normalize);
      state.localRows = St.listLocal();
      state.loading = false;
      $('refreshBtn').disabled = false;
      renderDash();
      renderAll();
      clearErrorNotice();
    }, function (err) {
      state.loading = false;
      $('refreshBtn').disabled = false;
      var msg = rawOf(err);
      // 只有「登录状态本身有问题」才退回登录页；表不存在、权限不足等要留在看板里说清楚
      var sessionGone = msg === 'UNAUTH' || /JWT expired|Invalid Refresh Token|token is expired|invalid claim|登录已过期/i.test(msg);
      if (BACKEND === 'supabase' && sessionGone) {
        St.supabase.signOut();
        renderLogin('登录状态已过期，请重新登录。');
        return;
      }
      if (BACKEND === 'supabase') {
        renderDash();
        state.rows = [];
        renderAll();
        notice(explainDataError(err) + '　→ <a href="#" id="noticeDiag">运行诊断</a>', 'err');
        var nd = $('noticeDiag');
        if (nd) nd.onclick = function (e) { e.preventDefault(); runDiagnostics(); };
      } else {
        notice('读取数据失败：' + esc(msg), 'err');
      }
    });
  }

  function normalize(r) {
    var o = Object.assign({}, r);
    o.percents = o.percents || {};
    o.scores = o.scores || {};
    o.answer_detail = o.answer_detail || [];
    if (!o.answer_detail.length && o.answers) {
      Object.keys(o.answers).forEach(function (qid) {
        var q = S.questions.filter(function (x) { return x.id === qid; })[0];
        if (q && q.options[o.answers[qid]]) {
          o.answer_detail.push({ id: qid, index: o.answers[qid], text: q.options[o.answers[qid]].text });
        }
      });
    }
    return o;
  }

  /* -------------------------------- 诊断 -------------------------------- */
  /* 登录不上去的时候，把每一步都测一遍，告诉你到底卡在哪。 */

  function shortJson(text) {
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > 180 ? s.slice(0, 180) + '…' : s;
  }

  /** 把 base64url 字符串解成本地信息（不用联网就能查 key 的毛病） */
  function b64urlBytes(s) {
    try {
      var b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
      return b.length;
    } catch (e) { return -1; }
  }
  function b64urlText(s) {
    try {
      return decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/'))));
    } catch (e) { return ''; }
  }

  /**
   * 本地校验 anonKey 是否「长得对」。这一步不需要联网，
   * 能立刻发现最常见的坑：复制时多/少字符、拿错项目的 key、把 service_role 放到前端、key 过期。
   */
  function inspectKey(key, projectUrl) {
    var out = [];
    if (!key) return [{ ok: false, title: 'anonKey 是空的', detail: '去 Project Settings → API Keys 复制 Project API key。' }];
    if (/^sb_(publishable|secret)_/.test(key)) {
      out.push({ ok: !/^sb_secret_/.test(key), title: '确认这是新版 API key 格式（sb_publishable_…）',
        detail: /^sb_secret_/.test(key) ? '你填的是 sb_secret_ 开头的密钥，它权限等同于 service_role，绝对不能放在前端！请改用 sb_publishable_ 或 anon 公钥。' : '' });
      return out;
    }
    if (key.slice(0, 3) !== 'eyJ') {
      out.push({ ok: false, title: 'anonKey 看起来不是 Supabase 的 key（应以 eyJ… 或 sb_publishable_ 开头）',
        detail: '你可能复制到了别的字段（比如 URL、JWT Secret 或数据库密码）。去 Project Settings → API Keys 重新复制。' });
      return out;
    }
    var parts = key.split('.');
    if (parts.length !== 3) {
      out.push({ ok: false, title: 'anonKey 结构不对（JWT 应有 3 段，实际 ' + parts.length + ' 段）', detail: '重新完整复制一次。' });
      return out;
    }
    var payload = null;
    try { payload = JSON.parse(b64urlText(parts[1])) || null; } catch (e) { payload = null; }
    var sigLen = b64urlBytes(parts[2]);
    out.push({
      ok: sigLen === 32,
      title: 'anonKey 签名长度：' + sigLen + ' 字节（应为 32 字节 / 43 个字符，当前 ' + parts[2].length + ' 个字符）',
      detail: sigLen === 32 ? 'Key 结构完整。'
        : '❌ 这个 key 复制残缺了（多一个或少一个字符）。这正是「登录一直失败」最常见的原因：' +
          'Supabase 会直接返回 401 Invalid API key。请回 Project Settings → API Keys 重新完整复制一次。'
    });
    if (!payload) {
      out.push({ ok: false, title: 'anonKey 的内容解析不出来', detail: '重新完整复制。' });
      return out;
    }
    out.push({ ok: payload.role !== 'service_role', title: 'key 的角色（role）= ' + (payload.role || '未知'),
      detail: payload.role === 'service_role'
        ? '这是 service_role key！它能绕过所有权限读到全部数据，绝对不能放在前端或仓库里。请换成 anon public / publishable key。'
        : '' });
    if (payload.exp) {
      var expMs = payload.exp * 1000;
      out.push({ ok: expMs > Date.now(), title: 'key 有效期至 ' + new Date(expMs).toLocaleString(),
        detail: expMs > Date.now() ? '' : '这个 key 已过期，重新复制一个新的。' });
    }
    var m = /^https:\/\/([a-z0-9-]+)\.supabase\.(co|in)$/i.exec(String(projectUrl || '').replace(/\/+$/, ''));
    if (m && payload.ref) {
      out.push({ ok: m[1] === payload.ref, title: 'key 所属项目 ref = ' + payload.ref + '，URL 项目 = ' + m[1],
        detail: m[1] === payload.ref ? '两者匹配。' : '❌ key 和 URL 不是同一个项目！把 URL 和 anonKey 都从同一个项目里重新复制一遍。' });
    }
    return out;
  }

  function renderDiag(lines, boxId) {
    var el = $(boxId);
    if (!el) return;
    el.classList.remove('hidden');
    var bad = lines.filter(function (l) { return l.ok === false; }).length;
    el.innerHTML =
      '<div class="diag-head">诊断结果：' + (bad ? '<b class="bad">发现 ' + bad + ' 个问题（红色项就是原因）</b>' : '<b class="ok">没有发现明显问题</b>') +
      '　<button class="link-btn" id="diagCopy">复制诊断结果</button></div>' +
      lines.map(function (l) {
        var cls = l.ok === true ? 'ok' : (l.ok === false ? 'bad' : 'warn');
        var ico = l.ok === true ? '✅' : (l.ok === false ? '❌' : '⚠️');
        return '<div class="diag-line ' + cls + '"><span class="ico">' + ico + '</span><span class="txt"><b>' +
          l.title + '</b>' + (l.detail ? '<br><span class="dt">' + l.detail + '</span>' : '') + '</span></div>';
      }).join('');
    var copy = $('diagCopy');
    if (copy) {
      copy.onclick = function () {
        var text = lines.map(function (l) {
          var ico = l.ok === true ? '[OK]' : (l.ok === false ? '[问题]' : '[提示]');
          return ico + ' ' + l.title.replace(/<[^>]+>/g, '') + (l.detail ? ' — ' + l.detail.replace(/<[^>]+>/g, '') : '');
        }).join('\n');
        var ta = document.createElement('textarea');
        ta.value = 'AI 人格测试后台诊断\n' + text + '\nUA: ' + navigator.userAgent;
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); toast('诊断结果已复制，可直接发给开发者', 'ok'); } catch (e) { toast('复制失败', 'err'); }
        document.body.removeChild(ta);
      };
    }
  }

  var diagBusy = false;
  function runDiagnostics() {
    if (diagBusy) return;
    diagBusy = true;
    var c = CFG.supabase || {};
    var url = String(c.url || '').trim().replace(/\/+$/, '');
    var key = String(c.anonKey || '').trim();
    var table = c.table || 'ai_personality_responses';
    var lines = [];
    var inLogin = !$('viewLogin').classList.contains('hidden');
    var boxId = inLogin ? 'diagBoxLogin' : 'diagBoxDash';
    var otherBox = inLogin ? 'diagBoxDash' : 'diagBoxLogin';
    if ($(otherBox)) $(otherBox).classList.add('hidden');
    if ($(boxId)) { $(boxId).classList.remove('hidden'); $(boxId).innerHTML = '<div class="diag-head">正在诊断…</div>'; }

    function push(ok, title, detail) { lines.push({ ok: ok, title: title, detail: detail || '' }); }
    function jsonFetch(u, opt) {
      return fetch(u, opt).then(function (res) {
        return res.text().then(function (t) { return { status: res.status, text: t }; });
      });
    }

    // --- 静态检查 ---
    push(BACKEND === 'supabase', '后端模式 backend = ' + BACKEND,
      BACKEND === 'supabase' ? '' : 'config.js 里 backend 不是 supabase（可能是没保存，或改了没重新上传到 GitHub Pages）。');
    var urlOk = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url);
    var urlShape = /^https?:\/\/[^\s]+$/i.test(url);
    push(urlOk ? true : (urlShape ? null : false), 'Project URL：' + (url || '（空）'),
      urlOk ? '' : (urlShape
        ? '不是标准的 https://项目id.supabase.co 形式。如果你用的是自建网关/本地测试可以忽略；否则请从 Project Settings → API → Project URL 重新复制（结尾不要带斜杠）。'
        : '必须是 https:// 开头的完整地址，例如 https://abcdefgh.supabase.co'));

    // anonKey 的离线体检（不联网就能查出「少复制一个字符」「拿错项目」「误用 service_role」）
    inspectKey(key, url).forEach(function (l) { push(l.ok, l.title, l.detail); });
    push(key.length > 100 && key.slice(0, 3) === 'eyJ', 'anonKey：' + (key ? '已填写，长度 ' + key.length : '（空）'),
      (key.length > 100 && key.slice(0, 3) === 'eyJ') ? '' : 'anon public key 是一段很长的 eyJ… 字符串；不要把 service_role 或 JWT Secret 填进来。');
    push(location.protocol !== 'file:', location.protocol === 'file:' ? '页面是用 file:// 打开的' : '页面地址：' + location.origin,
      location.protocol === 'file:' ? 'file:// 下浏览器会拦截接口请求，请用本地服务器（npm run serve）或部署后的 https 网址打开。' : '');
    var sess = St.supabase.session();
    push(true, '后台登录状态：' + (sess && sess.email ? '已登录 ' + sess.email : '未登录'), '');

    function done() {
      diagBusy = false;
      renderDiag(lines, boxId);
      var bad = lines.filter(function (l) { return l.ok === false; }).length;
      toast(bad ? '诊断完成：发现 ' + bad + ' 个问题（见下方红色项）' : '诊断完成：没发现明显问题', bad ? 'warn' : 'ok', 5000);
    }

    if (!url || !key) { done(); return; }

    jsonFetch(url + '/rest/v1/', { headers: { apikey: key } })
      .then(function (r) {
        if (r.status === 200) { push(true, 'anonKey 有效（REST 接口可以访问）', ''); return true; }
        if (r.status === 401) {
          push(false, 'anonKey 被拒绝（HTTP 401：' + shortJson(r.text) + '）',
            'Supabase 对 401 的说明是 "Invalid API key"。请回 Project Settings → API Keys 重新完整复制一次（注意别多复制或少复制字符）；' +
            '如果项目已停用 legacy JWT key，请改用 sb_publishable_… 开头的新版密钥。');
        } else {
          push(false, 'REST 接口返回 HTTP ' + r.status, shortJson(r.text));
        }
        return false;
      }, function (e) {
        push(false, '连不上 ' + url, '网络错误：' + rawOf(e) + '。可能是 URL 写错、网络/代理拦截了 *.supabase.co，或 Supabase 免费项目被暂停（去控制台看是否需要 Restore）。');
        return 'stop';
      })
      .then(function (keyOk) {
        if (keyOk === 'stop') return null;
        return jsonFetch(url + '/rest/v1/' + encodeURIComponent(table) + '?select=id&limit=1', { headers: { apikey: key } })
          .then(function (r) {
            var code = '';
            try { code = (JSON.parse(r.text || '{}') || {}).code || ''; } catch (e) { code = ''; }
            if (!keyOk) {
              push(false, '数据表状态无法判断（anonKey 无效时所有请求都是 401）', '先把 anonKey 修好，再点一次「运行诊断」。');
            } else if (code === 'PGRST205' || r.status === 404) {
              push(false, '数据表 ' + table + ' 不存在', '打开 Supabase → SQL Editor → 把项目里的 supabase/schema.sql 全文粘贴 → Run。');
            } else if (r.status === 401 || r.status === 403) {
              push(true, '数据表存在，并且 RLS 生效（匿名读不到，这是正确的）', '');
            } else if (r.status === 200) {
              push(false, '⚠️ anon key 竟然能直接读表（RLS 没生效，别人也能看到答卷）', '重跑 supabase/schema.sql 里的 RLS 与策略部分（anon 只给 insert 权限）。');
            } else {
              push(false, '读取数据表返回 HTTP ' + r.status, shortJson(r.text));
            }
            return null;
          }, function (e) { push(false, '读取数据表失败', rawOf(e)); });
      }, function () { return null; })
      .then(function () {
        // 登录框里填了账号密码，就真跑一次登录，把 Supabase 的原始错误摊开
        var em = ($('loginEmail') && $('loginEmail').value || '').trim();
        var pw = ($('loginPwd') && $('loginPwd').value) || '';
        if (!em || !pw) {
          push(null, '没有填邮箱密码，跳过「账号密码」校验', '在表单里填上邮箱和密码，再点一次「运行诊断」，就能确认账号本身能不能登录。');
          return null;
        }
        return jsonFetch(url + '/auth/v1/token?grant_type=password', {
          method: 'POST',
          headers: { apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: em, password: pw })
        }).then(function (r) {
          if (r.status === 200) { push(true, '账号密码可以登录（' + em + '）', '如果这里通过但登录还是失败，请把后台页面强制刷新一次（Ctrl+F5）。'); return; }
          var data = {};
          try { data = JSON.parse(r.text || '{}') || {}; } catch (e) { data = {}; }
          push(false, '登录被拒（HTTP ' + r.status + '）：' + shortJson(r.text),
            explainAuthError({ message: data.error_description || data.message || data.error || r.text, status: r.status }));
        });
      }, function () { return null; })
      .then(done, done);
  }

  /* ------------------------------- 筛选 ------------------------------- */
  function dayKey(d) {
    var x = new Date(d);
    if (isNaN(x.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate());
  }

  function rowsForView() {
    if (!state.mergeLocal || BACKEND === 'local') return state.rows;
    var seen = {};
    var out = state.rows.slice();
    out.forEach(function (r) { seen[r.id] = true; });
    state.localRows.forEach(function (r) { if (!seen[r.id]) { seen[r.id] = true; out.push(normalize(r)); } });
    out.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    return out;
  }

  function filtered() {
    var now = new Date();
    var start = null;
    if (state.range === 'today') start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (state.range === '7d') start = new Date(now.getTime() - 6 * 864e5);
    else if (state.range === '30d') start = new Date(now.getTime() - 29 * 864e5);
    else if (state.range === 'custom' && state.from) start = new Date(state.from + 'T00:00:00');
    var end = (state.range === 'custom' && state.to) ? new Date(state.to + 'T23:59:59') : null;

    var kw = state.kw.trim().toLowerCase();
    return rowsForView().filter(function (r) {
      var d = new Date(r.created_at);
      if (start && !(d >= start)) return false;
      if (end && !(d <= end)) return false;
      if (state.code && r.result_code !== state.code) return false;
      if (kw) {
        var hay = [r.nickname, r.result_name, r.result_code, r.user_agent, r.referrer, r.lang, r.screen]
          .join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }

  /* ------------------------------- 渲染 ------------------------------- */

  function renderAll() {
    var rows = filtered();
    renderKpis(rows);
    renderTypes(rows);
    renderDims(rows);
    renderTrend(rows);
    renderQuestions(rows);
    renderTable(rows);
    renderCodeOptions();
  }

  function renderKpis(rows) {
    var today = dayKey(new Date());
    var todayCount = rows.filter(function (r) { return dayKey(r.created_at) === today; }).length;
    var withDur = rows.filter(function (r) { return r.duration_ms > 0; });
    var avg = withDur.length ? Math.round(withDur.reduce(function (a, r) { return a + r.duration_ms; }, 0) / withDur.length / 1000) : 0;
    var codes = {};
    rows.forEach(function (r) { codes[r.result_code] = (codes[r.result_code] || 0) + 1; });
    var top = Object.keys(codes).sort(function (a, b) { return codes[b] - codes[a]; })[0];
    var topType = top && E.TYPES[top] ? E.TYPES[top].name : '—';
    var nick = rows.filter(function (r) { return r.nickname; }).length;

    var kpis = [
      { v: rows.length, l: '筛选后作答数（总库 ' + rowsForView().length + ' 条）' },
      { v: todayCount, l: '今天新增' },
      { v: avg, l: '平均用时（秒）', small: 's' },
      { v: top ? topType : '—', l: '最热人格类型' + (top ? '（' + top + '）' : ''), raw: true },
      { v: nick, l: '填写了昵称的人数' }
    ];
    $('kpis').innerHTML = kpis.map(function (k) {
      return '<div class="kpi"><div class="v">' + (k.raw ? esc(k.v) : k.v) +
        (k.small ? '<small>' + k.small + '</small>' : '') + '</div><div class="l">' + esc(k.l) + '</div></div>';
    }).join('');
  }

  function renderTypes(rows) {
    var counts = {};
    rows.forEach(function (r) { counts[r.result_code] = (counts[r.result_code] || 0) + 1; });
    var list = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    if (!list.length) { $('typeChart').innerHTML = '<p class="faint">暂无数据</p>'; return; }
    var max = counts[list[0]];
    $('typeChart').innerHTML = list.map(function (c, i) {
      var t = E.TYPES[c] || { name: '未知', emoji: '❓' };
      return '<div class="bar-row"><div class="bar-top">' +
        '<span class="nm">' + t.emoji + ' ' + esc(t.name) + ' <span class="faint">' + esc(c) + '</span></span>' +
        '<span class="vl">' + counts[c] + ' 人 · ' + pct(counts[c], rows.length) + '%</span></div>' +
        '<div class="bar-track"><div class="bar-fill' + (i % 2 ? ' alt' : '') + '" style="width:' +
        Math.max(2, Math.round((counts[c] / max) * 100)) + '%"></div></div></div>';
    }).join('');
  }

  function renderDims(rows) {
    var keys = Object.keys(S.dimensions);
    var html = keys.map(function (k) {
      var d = S.dimensions[k];
      var left = 0, right = 0, sum = 0, n = 0;
      rows.forEach(function (r) {
        var p = (r.percents || {})[k];
        if (!p || p.left === undefined) return;
        n++;
        sum += p.left;
        if (p.pole === 'left') left++; else right++;
      });
      var lPct = pct(left, left + right);
      var avgLeft = n ? Math.round(sum / n) : 50;
      return '<div class="bar-row">' +
        '<div class="bar-top"><span class="nm">' + esc(d.label) + '</span>' +
        '<span class="vl">' + esc(d.left.name) + ' ' + lPct + '% · ' + esc(d.right.name) + ' ' + (100 - lPct) + '%（平均倾向 ' + avgLeft + ' 分）</span></div>' +
        '<div class="split-bar"><div class="l" style="width:' + lPct + '%"></div><div class="r" style="width:' + (100 - lPct) + '%"></div></div>' +
        '</div>';
    }).join('');
    $('dimChart').innerHTML = rows.length ? html : '<p class="faint">暂无数据</p>';
  }

  function renderTrend(rows) {
    var days = [];
    var today = new Date();
    for (var i = 13; i >= 0; i--) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      days.push({ key: dayKey(d), label: (d.getMonth() + 1) + '/' + d.getDate(), n: 0 });
    }
    var idx = {};
    days.forEach(function (d) { idx[d.key] = d; });
    rows.forEach(function (r) {
      var k = dayKey(r.created_at);
      if (idx[k]) idx[k].n++;
    });
    var max = Math.max.apply(null, days.map(function (d) { return d.n; }).concat([1]));
    $('trendChart').innerHTML = days.map(function (d) {
      var h = Math.round((d.n / max) * 78);
      return '<div class="col" title="' + d.key + '：' + d.n + ' 人">' +
        '<i style="height:' + Math.max(2, h) + 'px"></i><span>' + d.label + '</span></div>';
    }).join('');
  }

  function renderQuestions(rows) {
    var html = S.questions.map(function (q) {
      var counts = q.options.map(function () { return 0; });
      var total = 0;
      rows.forEach(function (r) {
        var picked = null;
        (r.answer_detail || []).forEach(function (d) { if (d.id === q.id) picked = Number(d.index); });
        if (picked === null && r.answers && r.answers[q.id] !== undefined) picked = Number(r.answers[q.id]);
        if (picked === null || isNaN(picked) || picked < 0 || picked >= counts.length) return;
        counts[picked]++; total++;
      });
      if (!total) return '';
      var max = Math.max.apply(null, counts);
      var bars = q.options.map(function (o, i) {
        return '<div class="bar-row"><div class="bar-top"><span class="nm">' + esc(o.text) + '</span>' +
          '<span class="vl">' + counts[i] + ' 人 · ' + pct(counts[i], total) + '%</span></div>' +
          '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(2, Math.round((counts[i] / max) * 100)) + '%"></div></div></div>';
      }).join('');
      return '<div class="q-block"><div class="qt"><b>' + esc(q.id.toUpperCase()) + '</b>' + esc(q.text) +
        ' <span class="faint">（有效作答 ' + total + '）</span></div>' + bars + '</div>';
    }).join('');
    $('questionStats').innerHTML = html || '<p class="faint">暂无数据</p>';
  }

  function renderCodeOptions() {
    var sel = $('filterCode');
    var counts = {};
    rowsForView().forEach(function (r) { counts[r.result_code] = (counts[r.result_code] || 0) + 1; });
    var cur = state.code;
    var opts = ['<option value="">全部类型</option>'];
    Object.keys(counts).sort().forEach(function (c) {
      var t = E.TYPES[c];
      opts.push('<option value="' + esc(c) + '"' + (cur === c ? ' selected' : '') + '>' +
        esc(c + ' ' + (t ? t.name : '')) + '（' + counts[c] + '）</option>');
    });
    sel.innerHTML = opts.join('');
  }

  function renderTable(rows) {
    var start = (state.page - 1) * state.pageSize;
    var pageRows = rows.slice(start, start + state.pageSize);
    var pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    if (state.page > pages) { state.page = pages; start = (state.page - 1) * state.pageSize; pageRows = rows.slice(start, start + state.pageSize); }

    $('tableInfo').textContent = rows.length
      ? '共 ' + rows.length + ' 条 · 第 ' + state.page + '/' + pages + ' 页'
      : '没有符合条件的数据';

    if (!rows.length) {
      $('tableBody').innerHTML = '';
      $('pager').innerHTML = '';
      return;
    }

    $('tableBody').innerHTML = pageRows.map(function (r) {
      var t = E.TYPES[r.result_code] || { name: r.result_name || '未知', emoji: '❓' };
      var dims = Object.keys(S.dimensions).map(function (k) {
        var p = (r.percents || {})[k];
        if (!p) return '';
        var poleName = p.pole === 'left' ? p.leftName : p.rightName;
        var poleVal = p.pole === 'left' ? p.left : p.right;
        return '<span class="pill" style="margin:2px 4px 2px 0">' + esc(S.dimensions[k].label) + '：' + esc(poleName) + ' ' + poleVal + '%</span>';
      }).join('');
      var detailRows = (r.answer_detail || []).map(function (d) {
        var q = S.questions.filter(function (x) { return x.id === d.id; })[0];
        return '<dt>' + esc(d.id.toUpperCase()) + ' ' + esc(q ? q.text : '') + '</dt><dd>' + esc(d.text) + '</dd>';
      }).join('');
      var meta = [
        ['昵称', r.nickname || '（未填）'],
        ['用时', r.duration_ms ? (r.duration_ms / 1000).toFixed(1) + ' 秒' : '—'],
        ['完成题数', (r.answered || '?') + '/' + (r.total || S.questions.length)],
        ['问卷版本', r.survey_version || '—'],
        ['设备', r.user_agent || '—'],
        ['来源页', r.referrer || '直接打开'],
        ['语言 / 屏幕', (r.lang || '—') + ' / ' + (r.screen || '—')],
        ['时区', r.timezone || '—'],
        ['记录 ID', r.id]
      ].map(function (kv) { return '<dt>' + esc(kv[0]) + '</dt><dd>' + esc(kv[1]) + '</dd>'; }).join('');

      var open = !!state.expanded[r.id];
      return '<tr data-id="' + esc(r.id) + '">' +
        '<td class="mono">' + esc(St.localTime(r.created_at)) + '</td>' +
        '<td><span class="pill">' + esc(r.result_code) + '</span><br>' + t.emoji + ' ' + esc(t.name) + '</td>' +
        '<td>' + esc(r.nickname || '—') + '</td>' +
        '<td class="mono">' + (r.duration_ms ? Math.round(r.duration_ms / 1000) + 's' : '—') + '</td>' +
        '<td>' + dims + '</td>' +
        '<td class="mono"><button class="link-btn" data-act="toggle">' + (open ? '收起' : '详情') + '</button>' +
        '<button class="link-btn danger" data-act="del">删除</button></td>' +
        '</tr>' +
        (open ? '<tr><td colspan="6" class="detail-cell"><dl>' + meta + detailRows + '</dl></td></tr>' : '');
    }).join('');

    $('pager').innerHTML =
      '<button class="btn btn-ghost" id="prevPage"' + (state.page <= 1 ? ' disabled' : '') + '>← 上一页</button>' +
      '<button class="btn btn-ghost" id="nextPage"' + (state.page >= pages ? ' disabled' : '') + '>下一页 →</button>';

    $('prevPage').onclick = function () { if (state.page > 1) { state.page--; renderTable(filtered()); } };
    $('nextPage').onclick = function () { if (state.page < pages) { state.page++; renderTable(filtered()); } };
    $('tableBody').onclick = function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var tr = e.target.closest('tr');
      var id = tr.getAttribute('data-id');
      var act = btn.getAttribute('data-act');
      if (act === 'toggle') {
        state.expanded[id] = !state.expanded[id];
        renderTable(filtered());
      } else if (act === 'del') {
        if (!confirm('确定删除这条记录？删除后无法恢复。')) return;
        St.admin.remove(id).then(function () {
          toast('已删除', 'ok');
          state.rows = state.rows.filter(function (r) { return r.id !== id; });
          St.deleteLocal(id);
          renderAll();
        }, function (err) { toast('删除失败：' + ((err && err.message) || ''), 'err'); });
      }
    };
  }

  /* ------------------------------- 导出 ------------------------------- */

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  /* -------------------------------- 启动 -------------------------------- */

  function wireFilters() {
    $('filterRange').onchange = function () {
      state.range = this.value;
      $('customRange').classList.toggle('hidden', state.range !== 'custom');
      state.page = 1; renderAll();
    };
    $('filterFrom').onchange = function () { state.from = this.value; state.page = 1; renderAll(); };
    $('filterTo').onchange = function () { state.to = this.value; state.page = 1; renderAll(); };
    $('filterCode').onchange = function () { state.code = this.value; state.page = 1; renderAll(); };
    var kwTimer = null;
    $('filterKw').oninput = function () {
      var v = this.value;
      clearTimeout(kwTimer);
      kwTimer = setTimeout(function () { state.kw = v; state.page = 1; renderAll(); }, 220);
    };
    $('mergeLocal').onchange = function () { state.mergeLocal = this.checked; state.page = 1; renderAll(); };
    $('refreshBtn').onclick = function () { load(); };

    $('exportCsv').onclick = function () {
      var rows = filtered();
      if (!rows.length) return toast('当前没有可导出的数据', 'warn');
      download('ai-personality-' + stamp() + '.csv', St.toCSV(rows, S), 'text/csv;charset=utf-8');
      toast('已导出 ' + rows.length + ' 条 CSV', 'ok');
    };
    $('exportJson').onclick = function () {
      var rows = filtered();
      if (!rows.length) return toast('当前没有可导出的数据', 'warn');
      download('ai-personality-' + stamp() + '.json', JSON.stringify(rows, null, 2), 'application/json');
      toast('已导出 ' + rows.length + ' 条 JSON', 'ok');
    };
    $('importJson').onclick = function () { $('importFile').click(); };
    $('importFile').onchange = function () {
      var f = this.files && this.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result));
          var rows = Array.isArray(data) ? data : (data.rows || data.data || []);
          var n = St.importRows(rows);
          toast('已导入 ' + n + ' 条到本地视图', 'ok');
          state.mergeLocal = true;
          $('mergeLocal').checked = true;
          state.localRows = St.listLocal();
          renderAll();
        } catch (e) { toast('文件解析失败：' + e.message, 'err'); }
      };
      reader.readAsText(f);
      this.value = '';
    };
    $('logoutBtn').onclick = function () {
      St.supabase.signOut();
      renderLogin();
    };
  }

  function wireLogin() {
    var form = $('loginForm');
    form.onsubmit = function (e) {
      e.preventDefault();
      var email = $('loginEmail').value.trim();
      var pwd = $('loginPwd').value;
      if (!email || !pwd) return;
      $('loginBtn').disabled = true;
      $('loginBtn').textContent = '登录中…';
      St.supabase.signIn(email, pwd).then(function (s) {
        $('loginBtn').disabled = false;
        $('loginBtn').textContent = '登录';
        $('userEmail').textContent = s.email;
        renderDash();
        load();
      }, function (err) {
        $('loginBtn').disabled = false;
        $('loginBtn').textContent = '登录';
        renderLogin(esc(explainAuthError(err)), rawOf(err));
      });
    };
    var diagBtn = $('diagBtnLogin');
    if (diagBtn) diagBtn.onclick = function () { runDiagnostics(); };
    var diagBtnDash = $('diagBtnDash');
    if (diagBtnDash) diagBtnDash.onclick = function () { runDiagnostics(); };
  }

  function boot() {
    document.title = (CFG.admin && CFG.admin.title) || '数据后台';
    $('adminTitle').textContent = (CFG.admin && CFG.admin.title) || '数据后台';
    wireFilters();
    wireLogin();

    var modeText = BACKEND === 'supabase' ? 'Supabase 云端数据库' : (BACKEND === 'custom' ? '自定义接口' : '本地模式（local）');
    $('modeChip').textContent = '数据源：' + modeText;
    $('logoutBtn').classList.toggle('hidden', BACKEND !== 'supabase');
    $('userEmail').textContent = (St.supabase.session() || {}).email || '';

    if (BACKEND === 'local') {
      notice('当前 <code>config.js</code> 里的 <code>backend</code> 是 <b>local</b>：这里只能看到「本机浏览器」里存下的作答记录（包括你自己测试的那几次）。' +
        '想让所有访客的数据都汇总到这里，请按 README 把 backend 改成 <code>supabase</code>（推荐）或 <code>custom</code>。', 'warn');
      state.mergeLocal = false;
      $('mergeLocalRow').classList.add('hidden');
      renderDash();
      load();
      return;
    }

    if (BACKEND === 'custom') {
      var cs = CFG.custom || {};
      if (!cs.adminUrl) {
        notice('自定义接口模式下没有配置 <code>custom.adminUrl</code>，本页无法读取数据。' +
          '你可以直接在服务端/表格（例如 Google 表格）里看数据，或者按 README 添加一个只读接口。', 'warn');
      } else {
        notice('数据来自自定义只读接口。', 'ok');
      }
      $('mergeLocalRow').classList.remove('hidden');
      renderDash();
      load();
      return;
    }

    // Supabase
    if (!St.supabase.ready()) {
      notice('Supabase 还没配置好：请打开 <code>config.js</code> 填写 <code>supabase.url</code> 和 <code>supabase.anonKey</code>。', 'err');
      renderLogin();
      return;
    }
    notice('', '');
    St.supabase.validToken().then(function (token) {
      if (token) {
        $('userEmail').textContent = (St.supabase.session() || {}).email || '';
        renderDash();
        load();
      } else {
        renderLogin();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
