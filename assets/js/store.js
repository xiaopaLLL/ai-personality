/* =============================================================================
 *  数据层：把一次作答组装成记录，并提交到 Supabase（或自定义接口 / 本地）。
 * =============================================================================
 *  前端只负责静默提交，不展示任何“后台/云端/上传成功”之类的状态。
 *  记录字段严格对应 supabase/schema.sql 里已有的列；
 *  新增的匹配元数据放在 percents.match 这个 JSON 字段里，不需要改表结构。
 * ========================================================================== */

(function (root) {
  'use strict';

  var KEY_PENDING = 'aipt:pending:v2';
  var KEY_LOCAL = 'aipt:local:v2';
  var LOCAL_LIMIT = 3000;

  /* ------------------------------ 小工具 ------------------------------ */

  function cfg() { return root.APP_CONFIG || {}; }

  function uid() {
    try {
      if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    } catch (e) { /* ignore */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  function iso() { return new Date().toISOString(); }

  function round6(v) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    return Math.round(v * 1e6) / 1e6;
  }

  function store(key, val) {
    try {
      if (arguments.length === 1) return root.localStorage.getItem(key);
      root.localStorage.setItem(key, val);
      return true;
    } catch (e) { return null; }
  }

  function readJSON(key, fallback) {
    var raw = store(key);
    if (!raw) return fallback;
    try {
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, val) { return store(key, JSON.stringify(val)); }

  function drop(obj) {
    var out = {};
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k];
      if (v !== undefined && v !== null && v !== '') out[k] = v;
    });
    return out;
  }

  function fetchWithTimeout(url, options, ms) {
    var opt = Object.assign({}, options || {});
    if (typeof AbortController !== 'undefined') {
      var ctrl = new AbortController();
      opt.signal = ctrl.signal;
      var timer = setTimeout(function () { ctrl.abort(); }, ms || 12000);
      return root.fetch(url, opt).then(function (r) { clearTimeout(timer); return r; },
        function (e) { clearTimeout(timer); throw e; });
    }
    return root.fetch(url, opt);
  }

  /* ------------------------------ 组装记录 ------------------------------ */

  function collectEnv() {
    var nav = root.navigator || {};
    var scr = root.screen || {};
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
    return {
      userAgent: nav.userAgent || '',
      referrer: (root.document && root.document.referrer) || '',
      lang: nav.language || '',
      screen: scr.width ? (scr.width + 'x' + scr.height) : '',
      timezone: tz
    };
  }

  function buildRecord(survey, result, answers, opts) {
    opts = opts || {};
    var c = cfg().collect || {};
    var env = opts.env || {};
    var display = result.display || (result.candidates && result.candidates[0]) || null;
    var keys = Object.keys((survey && survey.dimensions) || {});
    var percents = {};

    keys.forEach(function (k) {
      var p = (result.percents || {})[k];
      if (!p) return;
      percents[k] = {
        left: p.left,
        right: p.right,
        leftName: p.leftName,
        rightName: p.rightName,
        pole: p.pole,
        raw: p.raw
      };
    });

    percents.match = {
      profileCode: result.profileCode || '',
      display: display ? display.id : '',
      candidates: (result.candidates || []).map(function (t) { return t.id; }),
      tie: !!result.tie,
      allNeutral: !!result.allNeutral,
      near: (result.near || []).map(function (t) { return t.id; }),
      bestDistance: round6(result.bestDistance),
      secondDistance: round6(result.secondDistance)
    };

    var rec = {
      id: uid(),
      created_at: iso(),
      survey_id: (survey.meta && survey.meta.id) || 'survey',
      survey_version: (survey.meta && survey.meta.version) || 'v0',
      result_code: display ? display.id : '',
      result_name: display ? display.name : '',
      scores: result.raw || {},
      percents: percents,
      answers: answers || {},
      answer_detail: result.detail || [],
      answered: result.answered,
      total: result.total,
      duration_ms: c.duration === false ? null : (opts.durationMs || null)
    };

    if (c.nickname !== false && opts.nickname) rec.nickname = String(opts.nickname).slice(0, 40);
    if (c.userAgent !== false) rec.user_agent = env.userAgent || null;
    if (c.referrer !== false) rec.referrer = env.referrer || null;
    if (c.language !== false) rec.lang = env.lang || null;
    if (c.screen !== false) rec.screen = env.screen || null;
    if (c.timezone !== false) rec.timezone = env.timezone || null;
    return drop(rec);
  }

  /* ------------------------------ 本地暂存 ------------------------------ */

  function listLocal() { return readJSON(KEY_LOCAL, []); }
  function clearLocal() { writeJSON(KEY_LOCAL, []); }

  function saveLocal(rec) {
    var all = listLocal();
    all.unshift(rec);
    if (all.length > LOCAL_LIMIT) all = all.slice(0, LOCAL_LIMIT);
    writeJSON(KEY_LOCAL, all);
    return rec;
  }

  function deleteLocal(id) {
    writeJSON(KEY_LOCAL, listLocal().filter(function (r) { return r.id !== id; }));
  }

  /* ------------------------------ 待重发队列 ------------------------------ */

  function pendingList() { return readJSON(KEY_PENDING, []); }
  function pendingCount() { return pendingList().length; }

  function enqueue(rec) {
    var all = pendingList();
    all.push(rec);
    writeJSON(KEY_PENDING, all.slice(-500));
  }

  function dequeue(id) {
    writeJSON(KEY_PENDING, pendingList().filter(function (r) { return r.id !== id; }));
  }

  function flushPending() {
    var all = pendingList();
    if (!all.length) return Promise.resolve({ sent: 0, left: 0 });
    var sent = 0;
    return all.reduce(function (chain, rec) {
      return chain.then(function () {
        return send(rec).then(function (ok) {
          if (ok) { dequeue(rec.id); sent++; }
        }, function () { /* 留着下次再试 */ });
      });
    }, Promise.resolve()).then(function () {
      return { sent: sent, left: pendingList().length };
    });
  }

  /* ------------------------------ Supabase ------------------------------ */

  function sbConf() {
    var s = cfg().supabase || {};
    return {
      url: String(s.url || '').replace(/\/+$/, ''),
      key: s.anonKey || '',
      table: s.table || 'ai_personality_responses'
    };
  }

  function sbReady() {
    var c = sbConf();
    return !!(c.url && c.key && /^https?:\/\//.test(c.url));
  }

  function send(rec) {
    var backend = cfg().backend || 'local';
    if (backend === 'supabase') {
      if (!sbReady()) return Promise.reject(new Error('Supabase 未配置'));
      var c = sbConf();
      return fetchWithTimeout(c.url + '/rest/v1/' + encodeURIComponent(c.table), {
        method: 'POST',
        headers: {
          apikey: c.key,
          Authorization: 'Bearer ' + c.key,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify(rec)
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) {
            var data = null;
            try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
            var msg = (data && (data.message || data.hint || data.error)) || ('HTTP ' + res.status);
            throw new Error(msg);
          });
        }
        return true;
      });
    }

    if (backend === 'custom') {
      var cs = cfg().custom || {};
      if (!cs.endpoint) return Promise.reject(new Error('自定义接口未配置'));
      return fetchWithTimeout(cs.endpoint, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': cs.contentType || 'text/plain;charset=utf-8' }, cs.headers || {}),
        body: JSON.stringify(rec),
        keepalive: true
      }, 12000).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return true;
      });
    }

    return Promise.reject(new Error('当前是本地模式'));
  }

  function submit(rec) {
    var backend = cfg().backend || 'local';
    if (backend === 'local') {
      saveLocal(rec);
      return Promise.resolve({ ok: true, mode: 'local' });
    }
    if (backend === 'supabase' && !sbReady()) {
      saveLocal(rec);
      return Promise.resolve({ ok: false, mode: 'supabase', localBackup: true, error: 'Supabase 还没配置好' });
    }
    if (backend === 'custom' && !(cfg().custom && cfg().custom.endpoint)) {
      saveLocal(rec);
      return Promise.resolve({ ok: false, mode: 'custom', localBackup: true, error: '自定义接口地址为空' });
    }
    return send(rec).then(function () {
      return { ok: true, mode: backend };
    }, function (err) {
      enqueue(rec);
      saveLocal(rec);
      return { ok: false, mode: backend, queued: true, localBackup: true, error: (err && err.message) || '网络错误' };
    });
  }

  /* =============================================================================
   *  数据后台 API（仅 /admin.html 使用）
   *  - supabase 模式：用 Supabase 邮箱账号登录，登录后才能读取/删除（RLS 限制）
   *  - local 模式：不需要登录，直接读本机 localStorage 的记录
   *  - custom 模式：暂不支持后台
   * ========================================================================== */

  var KEY_SESSION = 'aipt:session:v2';

  function session() { return readJSON(KEY_SESSION, null); }
  function signOut() {
    try { root.localStorage.removeItem(KEY_SESSION); } catch (e) { /* ignore */ }
  }

  function requestJSON(url, options, timeout) {
    return fetchWithTimeout(url, options || {}, timeout || 15000).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
        if (!res.ok) {
          var msg = (data && (data.message || data.error_description || data.msg || data.hint || data.error)) ||
            ('HTTP ' + res.status);
          var err = new Error(String(msg));
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function signIn(email, password) {
    if ((cfg().backend || 'local') !== 'supabase') {
      return Promise.reject(new Error('当前不是 Supabase 模式，不需要登录'));
    }
    var c = sbConf();
    if (!c.url || !c.key) return Promise.reject(new Error('config.js 里的 Supabase URL / anon key 没有配置完整'));
    return requestJSON(c.url + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(email || '').trim(), password: String(password || '') })
    }).then(function (data) {
      if (!data || !data.access_token) throw new Error('登录失败：没有拿到访问令牌');
      var s = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
        email: (data.user && data.user.email) || String(email || '').trim()
      };
      writeJSON(KEY_SESSION, s);
      return s;
    }, function (err) {
      var msg = err && err.message ? err.message : '登录失败';
      if (/invalid login credentials/i.test(msg)) msg = '邮箱或密码不正确';
      else if (/email not confirmed/i.test(msg)) msg = '邮箱还没确认：去 Supabase → Authentication → Users 手动确认该账号';
      else if (/failed to fetch|network/i.test(msg)) msg = '连不上 Supabase，请检查网络和 config.js 里的项目地址';
      throw new Error(msg);
    });
  }

  function refreshSession() {
    var s = session();
    var c = sbConf();
    if (!s || !s.refresh_token || !c.url) return Promise.reject(new Error('登录已过期，请重新登录'));
    return requestJSON(c.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(function (data) {
      if (!data || !data.access_token) throw new Error('登录已过期，请重新登录');
      var ns = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || s.refresh_token,
        expires_at: Date.now() + (Number(data.expires_in) || 3600) * 1000,
        email: (data.user && data.user.email) || s.email
      };
      writeJSON(KEY_SESSION, ns);
      return ns;
    }, function () {
      signOut();
      throw new Error('登录已过期，请重新登录');
    });
  }

  function validToken() {
    var s = session();
    if (!s) return Promise.resolve(null);
    if (s.expires_at && s.expires_at - 60000 > Date.now()) return Promise.resolve(s.access_token);
    return refreshSession().then(function (ns) { return ns.access_token; }, function () { return null; });
  }

  function filterLocalRows(rows, opts) {
    var out = (rows || []).filter(function (r) {
      if (opts.version && r.survey_version !== opts.version) return false;
      if (opts.code && r.result_code !== opts.code) return false;
      if (opts.from && String(r.created_at || '') < String(opts.from)) return false;
      if (opts.to && String(r.created_at || '') > String(opts.to)) return false;
      return true;
    });
    out.sort(function (a, b) { return String(b.created_at || '').localeCompare(String(a.created_at || '')); });
    return out;
  }

  function adminFetchRows(opts) {
    opts = opts || {};
    var backend = cfg().backend || 'local';
    var limit = Math.max(1, Math.min(5000, Number(opts.limit) || 1000));

    if (backend === 'local') {
      return Promise.resolve(filterLocalRows(listLocal(), opts).slice(0, limit));
    }
    if (backend !== 'supabase') {
      return Promise.reject(new Error('当前是自定义接口模式，这个数据后台只支持 Supabase 或本地模式'));
    }
    if (!sbReady()) {
      return Promise.reject(new Error('config.js 里的 Supabase URL / anon key 没有配置完整'));
    }
    return validToken().then(function (token) {
      if (!token) {
        var e = new Error('登录已过期，请重新登录');
        e.code = 'UNAUTH';
        throw e;
      }
      var c = sbConf();
      var qs = ['select=*', 'order=created_at.desc', 'limit=' + limit];
      if (opts.version) qs.push('survey_version=eq.' + encodeURIComponent(opts.version));
      if (opts.code) qs.push('result_code=eq.' + encodeURIComponent(opts.code));
      if (opts.from) qs.push('created_at=gte.' + encodeURIComponent(opts.from));
      if (opts.to) qs.push('created_at=lte.' + encodeURIComponent(opts.to));
      return requestJSON(c.url + '/rest/v1/' + encodeURIComponent(c.table) + '?' + qs.join('&'), {
        headers: { apikey: c.key, Authorization: 'Bearer ' + token },
        timeout: 20000
      }).then(function (data) {
        return Array.isArray(data) ? data : [];
      }, function (err) {
        if (err && (err.status === 401 || err.status === 403)) {
          signOut();
          var e2 = new Error(err.status === 403
            ? '当前账号没有读取权限（检查 Supabase RLS 是否给 authenticated 开了 select）'
            : '登录已过期，请重新登录');
          e2.code = 'UNAUTH';
          throw e2;
        }
        throw err;
      });
    });
  }

  function adminRemove(id) {
    var backend = cfg().backend || 'local';
    if (backend === 'local') {
      deleteLocal(id);
      return Promise.resolve(true);
    }
    if (backend !== 'supabase') {
      return Promise.reject(new Error('当前是自定义接口模式，后台不支持删除'));
    }
    var c = sbConf();
    return validToken().then(function (token) {
      if (!token) {
        var e = new Error('登录已过期，请重新登录');
        e.code = 'UNAUTH';
        throw e;
      }
      return fetchWithTimeout(c.url + '/rest/v1/' + encodeURIComponent(c.table) + '?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { apikey: c.key, Authorization: 'Bearer ' + token, Prefer: 'return=minimal' }
      }, 15000).then(function (res) {
        if (res.status === 401 || res.status === 403) {
          signOut();
          var e2 = new Error('登录已过期或无删除权限，请重新登录');
          e2.code = 'UNAUTH';
          throw e2;
        }
        if (!res.ok) throw new Error('删除失败：HTTP ' + res.status);
        return true;
      });
    });
  }

  /* ------------------------------ CSV 导出 ------------------------------ */

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function localTime(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return String(isoStr);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function toCSV(rows, survey) {
    var dims = Object.keys((survey && survey.dimensions) || {});
    var questions = (survey && survey.questions) || [];
    var head = ['提交时间', '问卷版本', '结果编号', '结果名称', '昵称', '用时(秒)', '完成题数', '总题数',
      'profileCode', '并列候选', '是否并列', '是否全中性', '近似机体', '最佳距离', '次佳距离'];
    dims.forEach(function (k) {
      var d = survey.dimensions[k];
      head.push(d.label + '-' + d.left.name + '%');
      head.push(d.label + '-' + d.right.name + '%');
      head.push(d.label + '-原始分');
    });
    questions.forEach(function (q) { head.push('[' + q.id + '] ' + q.text); });
    head = head.concat(['设备', '来源页', '语言', '屏幕', '时区']);

    var lines = [head.map(csvCell).join(',')];
    (rows || []).forEach(function (r) {
      var detail = {};
      (r.answer_detail || []).forEach(function (d) { if (d && d.id) detail[d.id] = d.text; });
      if (!Object.keys(detail).length && r.answers) {
        Object.keys(r.answers).forEach(function (qid) {
          var q = questions.filter(function (x) { return x.id === qid; })[0];
          if (q && q.options && q.options[r.answers[qid]]) detail[qid] = q.options[r.answers[qid]].text;
        });
      }
      var m = (r.percents && r.percents.match) || {};
      var row = [
        localTime(r.created_at), r.survey_version || '', r.result_code || '', r.result_name || '',
        r.nickname || '', r.duration_ms ? Math.round(r.duration_ms / 1000) : '',
        r.answered === undefined ? '' : r.answered, r.total === undefined ? '' : r.total,
        m.profileCode || '', (m.candidates || []).join(' / '),
        m.tie ? '是' : '否', m.allNeutral ? '是' : '否',
        (m.near || []).join(' / '),
        m.bestDistance === undefined ? '' : m.bestDistance,
        m.secondDistance === undefined ? '' : m.secondDistance
      ];
      dims.forEach(function (k) {
        var p = (r.percents || {})[k] || {};
        row.push(p.left === undefined ? '' : p.left);
        row.push(p.right === undefined ? '' : p.right);
        row.push((r.scores || {})[k] === undefined ? '' : (r.scores || {})[k]);
      });
      questions.forEach(function (q) { row.push(detail[q.id] || ''); });
      row = row.concat([r.user_agent || '', r.referrer || '', r.lang || '', r.screen || '', r.timezone || '']);
      lines.push(row.map(csvCell).join(','));
    });
    return '\ufeff' + lines.join('\r\n');
  }

  var admin = {
    dataSource: function () { return cfg().backend || 'local'; },
    isRemote: function () { return (cfg().backend || 'local') !== 'local'; },
    ready: sbReady,
    session: session,
    signIn: signIn,
    signOut: signOut,
    validToken: validToken,
    fetchRows: adminFetchRows,
    remove: adminRemove
  };

  var Store = {
    uid: uid,
    collectEnv: collectEnv,
    buildRecord: buildRecord,
    submit: submit,
    send: send,
    flushPending: flushPending,
    pendingCount: pendingCount,
    listLocal: listLocal,
    saveLocal: saveLocal,
    clearLocal: clearLocal,
    toCSV: toCSV,
    localTime: localTime,
    admin: admin,
    backend: function () { return cfg().backend || 'local'; }
  };

  root.Store = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
