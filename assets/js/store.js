/* =============================================================================
 *  数据层：三种后端的统一封装（local / supabase / custom）
 * =============================================================================
 *  对外接口（浏览器全局 Store）：
 *    Store.buildRecord(survey, result, answers, opts)  组装一条记录
 *    Store.submit(record) -> Promise<{ok, mode, queued?, error?}>
 *    Store.flushPending()                              重发本地暂存的上传
 *    Store.pendingCount()
 *    Store.listLocal() / Store.clearLocal() / Store.deleteLocal(id)
 *    Store.importRows(rows)                            把导出的 JSON 合进本地库
 *    Store.toCSV(rows, survey)                         导出 CSV 文本
 *    Store.supabase.signIn(email, pwd) / signOut() / session()
 *    Store.admin.fetchRows(opts) / remove(id)
 * ========================================================================== */

(function (root) {
  'use strict';

  var KEY_PENDING = 'aipt:pending:v1';
  var KEY_LOCAL = 'aipt:local:v1';
  var KEY_SESSION = 'aipt:session:v1';
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
      var timer = setTimeout(function () { ctrl.abort(); }, ms || 10000);
      return root.fetch(url, opt).then(function (r) { clearTimeout(timer); return r; },
        function (e) { clearTimeout(timer); throw e; });
    }
    return root.fetch(url, opt);
  }

  /* ------------------------------ 组装记录 ------------------------------ */

  function buildRecord(survey, result, answers, opts) {
    opts = opts || {};
    var c = cfg().collect || {};
    var env = opts.env || {};
    var rec = {
      id: uid(),
      created_at: iso(),
      survey_id: (survey.meta && survey.meta.id) || 'survey',
      survey_version: (survey.meta && survey.meta.version) || 'v0',
      result_code: result.code,
      result_name: result.name,
      scores: result.scores,
      percents: result.percents,
      answers: answers,
      answer_detail: result.detail,
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

  /* ------------------------------ 本地暂存 ------------------------------ */

  function listLocal() { return readJSON(KEY_LOCAL, []); }

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

  function clearLocal() { writeJSON(KEY_LOCAL, []); }

  function importRows(rows) {
    var all = listLocal();
    var have = {};
    all.forEach(function (r) { have[r.id] = true; });
    var added = 0;
    (rows || []).forEach(function (r) {
      if (!r || !r.id || have[r.id]) return;
      have[r.id] = true;
      all.push(r);
      added++;
    });
    all.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    writeJSON(KEY_LOCAL, all.slice(0, LOCAL_LIMIT));
    return added;
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
    return { url: String(s.url || '').replace(/\/+$/, ''), key: s.anonKey || '', table: s.table || 'ai_personality_responses' };
  }

  function sbReady() {
    var c = sbConf();
    return !!(c.url && c.key && /^https?:\/\//.test(c.url));
  }

  function supabaseRequest(pathname, options) {
    var c = sbConf();
    var opt = Object.assign({}, options || {});
    opt.headers = Object.assign({
      apikey: c.key,
      Authorization: 'Bearer ' + (opt.token || c.key)
    }, opt.headers || {});
    delete opt.token;
    return fetchWithTimeout(c.url + pathname, opt, opt.timeout || 12000).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
        if (!res.ok) {
          var msg = (data && (data.message || data.error_description || data.msg || data.hint)) || ('HTTP ' + res.status);
          var err = new Error(msg);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function send(rec) {
    var backend = cfg().backend || 'local';
    if (backend === 'supabase') {
      if (!sbReady()) return Promise.reject(new Error('Supabase 未配置'));
      var c = sbConf();
      return supabaseRequest('/rest/v1/' + encodeURIComponent(c.table), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(rec)
      }).then(function () { return true; });
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
      return Promise.resolve({ ok: false, mode: 'supabase', localBackup: true, error: 'Supabase 还没配置好（config.js 里 url / anonKey 为空）' });
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

  /* --------------------------- Supabase 后台 --------------------------- */

  function session() { return readJSON(KEY_SESSION, null); }

  function signIn(email, password) {
    var c = sbConf();
    if (!c.url || !c.key) return Promise.reject(new Error('请先在 config.js 填好 Supabase url 和 anonKey'));
    return fetchWithTimeout(c.url + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }, 12000).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var m = (data && (data.error_description || data.message || data.msg || data.error)) || ('HTTP ' + res.status);
          var err = new Error(m);
          err.status = res.status;
          err.code = (data && (data.error_code || data.code)) || '';
          err.raw = data;
          throw err;
        }
        var s = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + (data.expires_in || 3600) * 1000,
          email: (data.user && data.user.email) || email
        };
        writeJSON(KEY_SESSION, s);
        return s;
      });
    });
  }

  function refresh() {
    var s = session();
    var c = sbConf();
    if (!s || !s.refresh_token || !c.url) return Promise.reject(new Error('未登录'));
    return fetchWithTimeout(c.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }, 12000).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) throw new Error((data && (data.error_description || data.message)) || '登录已过期，请重新登录');
        var ns = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: Date.now() + (data.expires_in || 3600) * 1000,
          email: (data.user && data.user.email) || s.email
        };
        writeJSON(KEY_SESSION, ns);
        return ns;
      });
    });
  }

  function signOut() {
    try { root.localStorage.removeItem(KEY_SESSION); } catch (e) { /* ignore */ }
  }

  function validToken() {
    var s = session();
    if (!s) return Promise.resolve(null);
    if (s.expires_at && s.expires_at - 60000 > Date.now()) return Promise.resolve(s.access_token);
    return refresh().then(function (ns) { return ns.access_token; },
      function () { signOut(); return null; });
  }

  function query(pathname, opts) {
    return validToken().then(function (token) {
      if (!token) throw new Error('UNAUTH');
      return supabaseRequest(pathname, Object.assign({ token: token }, opts || {}));
    });
  }

  function fetchRows(opts) {
    opts = opts || {};
    var c = sbConf();
    var qs = ['select=*', 'order=created_at.desc', 'limit=' + (opts.limit || 1000)];
    if (opts.from) qs.push('created_at=gte.' + encodeURIComponent(opts.from));
    if (opts.to) qs.push('created_at=lte.' + encodeURIComponent(opts.to));
    if (opts.code) qs.push('result_code=eq.' + encodeURIComponent(opts.code));
    return query('/rest/v1/' + encodeURIComponent(c.table) + '?' + qs.join('&'));
  }

  function remove(id) {
    var c = sbConf();
    return validToken().then(function (token) {
      if (!token) throw new Error('UNAUTH');
      return fetchWithTimeout(c.url + '/rest/v1/' + encodeURIComponent(c.table) + '?id=eq.' + encodeURIComponent(id), {
        method: 'DELETE',
        headers: { apikey: c.key, Authorization: 'Bearer ' + token, Prefer: 'return=minimal' }
      }, 12000);
    }).then(function (res) {
      if (!res.ok) throw new Error('删除失败 HTTP ' + res.status);
      return true;
    });
  }

  /* --------------------------- 自定义接口后台 --------------------------- */

  function customAdminFetch(opts) {
    var cs = cfg().custom || {};
    if (!cs.adminUrl) return Promise.reject(new Error('未配置 custom.adminUrl'));
    var url = cs.adminUrl + (cs.adminUrl.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(cs.adminToken || '');
    return fetchWithTimeout(url, { method: 'GET', headers: cs.headers || {} }, 15000).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.rows)) return data.rows;
      if (data && Array.isArray(data.data)) return data.data;
      throw new Error('接口返回格式不认识（应为数组或 {rows: [...]}）');
    });
  }

  var admin = {
    fetchRows: function (opts) {
      var backend = cfg().backend || 'local';
      if (backend === 'supabase') return fetchRows(opts);
      if (backend === 'custom') return customAdminFetch(opts);
      return Promise.resolve(listLocal());
    },
    remove: function (id) {
      var backend = cfg().backend || 'local';
      if (backend === 'supabase') return remove(id);
      deleteLocal(id);
      return Promise.resolve(true);
    },
    isRemote: function () { return (cfg().backend || 'local') !== 'local'; }
  };

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
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function toCSV(rows, survey) {
    var dims = Object.keys((survey && survey.dimensions) || {});
    var questions = (survey && survey.questions) || [];
    var head = ['提交时间', '结果代码', '结果类型', '昵称', '用时(秒)'];
    dims.forEach(function (k) {
      var d = survey.dimensions[k];
      head.push(d.label + '-' + d.left.name + '%');
      head.push(d.label + '-' + d.right.name + '%');
      head.push(d.label + '-倾向');
    });
    questions.forEach(function (q) { head.push('[' + q.id + '] ' + q.text); });
    head = head.concat(['完成题数', '设备', '来源页', '语言', '屏幕', '时区', '问卷版本']);

    var lines = [head.map(csvCell).join(',')];
    (rows || []).forEach(function (r) {
      var detail = {};
      (r.answer_detail || []).forEach(function (d) { detail[d.id] = d.text; });
      if (!Object.keys(detail).length && r.answers) {
        Object.keys(r.answers).forEach(function (qid) {
          var q = questions.filter(function (x) { return x.id === qid; })[0];
          if (q && q.options[r.answers[qid]]) detail[qid] = q.options[r.answers[qid]].text;
        });
      }
      var row = [localTime(r.created_at), r.result_code, r.result_name, r.nickname || '',
        r.duration_ms ? Math.round(r.duration_ms / 1000) : ''];
      dims.forEach(function (k) {
        var p = (r.percents || {})[k] || {};
        row.push(p.left === undefined ? '' : p.left);
        row.push(p.right === undefined ? '' : p.right);
        row.push(p.pole === 'left' ? p.leftName : (p.pole === 'right' ? p.rightName : ''));
      });
      questions.forEach(function (q) { row.push(detail[q.id] || ''); });
      row = row.concat([(r.answered || '') + '/' + (r.total || ''), r.user_agent || '', r.referrer || '',
        r.lang || '', r.screen || '', r.timezone || '', r.survey_version || '']);
      lines.push(row.map(csvCell).join(','));
    });
    return '\ufeff' + lines.join('\r\n');
  }

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
    deleteLocal: deleteLocal,
    clearLocal: clearLocal,
    importRows: importRows,
    toCSV: toCSV,
    localTime: localTime,
    supabase: { signIn: signIn, signOut: signOut, session: session, ready: sbReady, validToken: validToken },
    admin: admin,
    backend: function () { return cfg().backend || 'local'; }
  };

  root.Store = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof window !== 'undefined' ? window : globalThis);
