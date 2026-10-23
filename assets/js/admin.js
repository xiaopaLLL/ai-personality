/* =============================================================================
 *  AI 协作机体测试 · 数据后台交互（/admin.html）
 * =============================================================================
 *  依赖（按 index.html 相同的顺序加载）：
 *    config.js → assets/js/questions.js → assets/js/personality.js
 *    → assets/js/store.js → assets/js/admin.js
 *
 *  数据接口只使用 window.Store.admin 契约：
 *    dataSource() / isRemote() / ready() / session() / signIn() / signOut()
 *    fetchRows(opts) / remove(id)
 *  以及 window.Store.toCSV(rows, SURVEY)。
 *
 *  三种模式：
 *    local    跳过登录，直接看本机 localStorage 记录（看板顶部有提示条）
 *    supabase 邮箱密码登录后读取云端数据；localStorage 有有效会话时直接进看板
 *    custom   自定义接口模式，本后台未配置，只显示提示
 *
 *  安全约定：所有来自数据表的动态文本一律用 textContent / setAttribute
 *  写入 DOM，不拼 innerHTML；删除前必须 confirm。
 * ========================================================================== */
(function () {
  'use strict';

  var S = window.SURVEY || {};
  var E = window.Engine;
  var St = window.Store;
  var CFG = window.APP_CONFIG || {};
  var META = S.meta || {};
  var DIMS = S.dimensions || {};
  var CURRENT_VERSION = META.version || 'v2.0';
  var DIM_ORDER = (E && E.DIM_ORDER) || ['drive', 'heart', 'order', 'role'];

  var FETCH_LIMIT = 1000;  // 后台默认读取最近 1000 条
  var TABLE_LIMIT = 500;   // 表格最多渲染 500 行
  var NOTICE_MS = 4500;
  var DEFAULT_VERSION_FILTER = 'v2';   // 默认 V2 全部（v2.x）
  var KNOWN_VERSION_LIST = ['1.0', '2.0']; // 已知版本（normalized，不含前导 v），当前版本运行时再补

  var state = {
    source: 'local',
    email: '',
    rows: [],
    filterVersion: DEFAULT_VERSION_FILTER, // 'all' | 'v1' | 'v2' | 'v1.0' | 'v2.0' | 'v2.1' | ...
    filterRange: 'all',     // all | today | 7 | 30
    filterType: '',         // '' 或 M01..M08
    filterLegacy: '',       // 旧版四字母代码（点击旧版分布时设置）
    loading: false,
    loaded: false
  };

  var els = {};
  var noticeTimer = null;

  /* ================================ 小工具 ================================ */

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function on(node, event, handler) {
    if (node && node.addEventListener) node.addEventListener(event, handler);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function messageOf(err) {
    return (err && err.message) ? String(err.message) : '未知错误';
  }

  function toDate(value) {
    if (!value) return null;
    var d = new Date(value);
    if (isNaN(d.getTime())) {
      // 兼容 "YYYY-MM-DD HH:mm:ss" 这类不带 T 的旧格式
      d = new Date(String(value).replace(' ', 'T'));
      if (isNaN(d.getTime())) return null;
    }
    return d;
  }

  function dayKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function fmtTime(value) {
    var d = toDate(value);
    if (!d) return value ? String(value) : '—';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtDuration(ms) {
    var n = Number(ms);
    if (!isFinite(n) || n <= 0) return '—';
    var sec = n / 1000;
    if (sec < 60) return (Math.round(sec * 10) / 10) + ' 秒';
    var m = Math.floor(sec / 60);
    var s = Math.round(sec % 60);
    if (s === 60) { m += 1; s = 0; }
    return m + ' 分 ' + s + ' 秒';
  }

  function fmtPct(part, total) {
    if (!total) return 0;
    return Math.round((part / total) * 100);
  }

  function fmtAvg(v) {
    return (Math.round(v * 10) / 10).toFixed(1) + '%';
  }

  /* ============================== 版本号工具 ============================== */
  /* 记录里的 survey_version 可能是 'v2.1' / '2.1' / 'V2.1' / ''；
   * 这里统一归一化成不带前导 v 的小写串（'2.1'），展示时再补 'v'。 */

  function normalizeVersion(value) {
    var s = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
    if (!s) return '';
    if (s.charAt(0) === 'v') s = s.slice(1).trim();
    return s;
  }

  function displayVersion(normalized) {
    var n = String(normalized === undefined || normalized === null ? '' : normalized);
    if (!n) return '';
    return /^\d/.test(n) ? 'v' + n : n;
  }

  function versionParts(version) {
    return String(version || '').split(/[.\-_+]/);
  }

  function compareVersions(a, b) {
    var pa = versionParts(a);
    var pb = versionParts(b);
    var length = Math.max(pa.length, pb.length);
    for (var i = 0; i < length; i++) {
      var xa = pa[i] === undefined ? '' : pa[i];
      var xb = pb[i] === undefined ? '' : pb[i];
      if (xa === '' || xb === '') return xa === '' ? -1 : 1;
      var na = parseInt(xa, 10);
      var nb = parseInt(xb, 10);
      if (!isNaN(na) && !isNaN(nb)) {
        if (na !== nb) return na - nb;
        continue;
      }
      if (xa !== xb) return xa < xb ? -1 : 1;
    }
    return 0;
  }

  function seriesOfVersion(normalized) {
    var n = String(normalized || '');
    if (/^1(?:\.|$)/.test(n)) return '1';
    if (/^2(?:\.|$)/.test(n)) return '2';
    return '';
  }

  function isMachineRow(row) {
    return /^M0[1-8]$/i.test(String(row && row.result_code || ''));
  }

  function versionOf(row) {
    return normalizeVersion(row && row.survey_version);
  }

  function isCurrentVersionRow(row) {
    return versionOf(row) === normalizeVersion(CURRENT_VERSION);
  }

  /** 把任意值（含旧的 new/old、无前导 v 的版本）规范成下拉里的 value */
  function canonicalVersionValue(value) {
    var raw = String(value === undefined || value === null ? '' : value).trim();
    if (!raw) return '';
    var low = raw.toLowerCase();
    if (low === 'all') return 'all';
    if (low === 'new') return 'v2';
    if (low === 'old') return 'v1';
    var normalized = normalizeVersion(raw);
    if (!normalized) return '';
    if (normalized === '1') return 'v1';
    if (normalized === '2') return 'v2';
    return /^\d/.test(normalized) ? 'v' + normalized : normalized;
  }

  function isV1Range() {
    var canonical = canonicalVersionValue(state.filterVersion);
    if (canonical === 'v1') return true;
    return seriesOfVersion(normalizeVersion(canonical)) === '1';
  }

  /** 已知版本 + 已载入数据里出现过的版本（normalized，去重排序） */
  function collectVersionList() {
    var seen = {};
    var list = [];
    function add(raw) {
      var n = normalizeVersion(raw);
      if (!n || seen[n]) return;
      seen[n] = true;
      list.push(n);
    }
    KNOWN_VERSION_LIST.forEach(add);
    add(CURRENT_VERSION);
    state.rows.forEach(function (row) { add(row && row.survey_version); });
    list.sort(compareVersions);
    return list;
  }

  function rangeLabel() {
    var selection = state.filterVersion;
    if (!selection || selection === 'all') {
      var all = collectVersionList();
      return all.length
        ? '全部版本（' + all.map(displayVersion).join(' / ') + '）'
        : '全部版本';
    }
    if (selection === 'v1' || selection === 'v2') {
      var series = selection.slice(1);
      var list = collectVersionList().filter(function (version) {
        return seriesOfVersion(version) === series;
      });
      var prefix = selection === 'v1' ? 'V1 全部' : 'V2 全部';
      return list.length
        ? prefix + '（' + list.map(displayVersion).join(' / ') + '）'
        : prefix;
    }
    return displayVersion(normalizeVersion(selection)) || selection;
  }

  function rangeShortLabel() {
    var selection = state.filterVersion;
    if (!selection || selection === 'all') return '全部版本';
    if (selection === 'v1') return 'V1 全部';
    if (selection === 'v2') return 'V2 全部';
    return displayVersion(normalizeVersion(selection)) || selection;
  }

  function createVersionOption(value, label) {
    var option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  function createVersionGroup(label) {
    var group = document.createElement('optgroup');
    group.label = label;
    return group;
  }

  /** 把任意版本选择值对齐到 #filterVersion 里实际存在的 option；不存在则回退默认 V2 全部 */
  function normalizeVersionSelection(value) {
    var canonical = canonicalVersionValue(value);
    var select = els.filterVersion;
    if (select && select.options) {
      for (var i = 0; i < select.options.length; i++) {
        if (select.options[i].value === canonical) return canonical;
      }
      for (var j = 0; j < select.options.length; j++) {
        if (select.options[j].value === DEFAULT_VERSION_FILTER) return DEFAULT_VERSION_FILTER;
      }
      if (select.options.length) return select.options[0].value;
    }
    return canonical || DEFAULT_VERSION_FILTER;
  }

  /** 按「已知版本 + 数据里出现的版本」重建版本下拉（保留当前选择；失效则回退默认） */
  function buildVersionFilter() {
    var select = els.filterVersion;
    if (!select) return;

    var versions = collectVersionList();
    var v1 = versions.filter(function (v) { return seriesOfVersion(v) === '1'; });
    var v2 = versions.filter(function (v) { return seriesOfVersion(v) === '2'; });
    var others = versions.filter(function (v) { return !seriesOfVersion(v); });

    clear(select);
    select.appendChild(createVersionOption('all', '全部版本'));

    if (v1.length) {
      var group1 = createVersionGroup('V1 系列');
      group1.appendChild(createVersionOption('v1', 'V1 全部（v1.x）'));
      v1.forEach(function (version) {
        if (version !== '1') {
          group1.appendChild(createVersionOption('v' + version, displayVersion(version)));
        }
      });
      select.appendChild(group1);
    }

    if (v2.length) {
      var group2 = createVersionGroup('V2 系列');
      group2.appendChild(createVersionOption('v2', 'V2 全部（v2.x）'));
      v2.forEach(function (version) {
        if (version !== '2') {
          group2.appendChild(createVersionOption('v' + version, displayVersion(version)));
        }
      });
      select.appendChild(group2);
    }

    if (others.length) {
      var groupOther = createVersionGroup('其它版本');
      others.forEach(function (version) {
        var value = /^\d/.test(version) ? 'v' + version : version;
        groupOther.appendChild(createVersionOption(value, displayVersion(version)));
      });
      select.appendChild(groupOther);
    }

    var selection = normalizeVersionSelection(state.filterVersion);
    state.filterVersion = selection;
    select.value = selection;
  }

  /* ============================== 记录字段解析 ============================== */

  function typeOf(row) {
    if (!row || !E) return null;
    var type = E.typeById && E.typeById(row.result_code);
    if (type) return type;
    var name = row.result_name;
    if (!name) return null;
    var types = E.types || [];
    for (var i = 0; i < types.length; i++) {
      if (types[i].name === name) return types[i];
    }
    return null;
  }

  function matchMeta(row) {
    return (row && row.percents && row.percents.match) || null;
  }

  function isTie(row) {
    var m = matchMeta(row);
    if (!m) return false;
    if (m.tie) return true;
    return !!(m.candidates && m.candidates.length > 1);
  }

  function isAllNeutral(row) {
    var m = matchMeta(row);
    return !!(m && m.allNeutral);
  }

  function isNear(row) {
    var m = matchMeta(row);
    return !!(m && m.near && m.near.length);
  }

  function isComplete(row) {
    var answered = Number(row && row.answered);
    var total = Number(row && row.total);
    return isFinite(answered) && isFinite(total) && total > 0 && answered >= total;
  }

  function durationOf(row) {
    var n = Number(row && row.duration_ms);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /* ================================ 筛选 ================================ */

  function matchVersion(row) {
    var target = state.filterVersion;
    if (!target || target === 'all') return true;
    var version = versionOf(row);

    if (target === 'v1') {
      // v1 系列：survey_version 以 1 开头；没有版本号但 result_code 是四字母的旧记录也算 v1
      if (version) return seriesOfVersion(version) === '1';
      return !isMachineRow(row);
    }
    if (target === 'v2') {
      // v2 系列：survey_version 以 2 开头；兼容没有版本号但已是 M01-M08 的数据
      if (version) return seriesOfVersion(version) === '2';
      return isMachineRow(row);
    }
    // 精确版本：按归一化后的版本号完全相等
    return version === normalizeVersion(target);
  }

  function matchRange(row) {
    if (state.filterRange === 'all') return true;
    var d = toDate(row && row.created_at);
    if (!d) return false;
    if (state.filterRange === 'today') return dayKey(d) === dayKey(new Date());
    var days = state.filterRange === '7' ? 7 : 30;
    var from = startOfToday();
    from.setDate(from.getDate() - (days - 1));
    return d.getTime() >= from.getTime();
  }

  function matchType(row) {
    if (state.filterType) {
      if (!isMachineRow(row)) return false;
      var type = typeOf(row);
      if (!type || type.id !== state.filterType) return false;
    }
    if (state.filterLegacy) {
      if (isMachineRow(row)) return false;
      if (String(row.result_code || '') !== state.filterLegacy) return false;
    }
    return true;
  }

  function sortDesc(rows) {
    return (rows || []).slice().sort(function (a, b) {
      return String(b && b.created_at || '').localeCompare(String(a && a.created_at || ''));
    });
  }

  function versionRows() { return state.rows.filter(matchVersion); }
  function cohortRows() { return versionRows().filter(matchRange); }
  function filteredRows() { return cohortRows().filter(matchType); }

  /* ================================ 视图 ================================ */

  function showView(name) {
    els.viewLogin.hidden = name !== 'login';
    els.viewDash.hidden = name !== 'dash';
    try { document.body.setAttribute('data-view', name); } catch (e) { /* ignore */ }
    try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
  }

  function setLoginMessage(msg, kind) {
    var node = els.loginMsg;
    if (!node) return;
    node.textContent = msg || '';
    node.className = 'adm-login-msg' + (kind ? ' is-' + kind : '');
  }

  function setLoginBusy(busy) {
    if (!els.loginBtn) return;
    els.loginBtn.disabled = !!busy;
    els.loginBtn.textContent = busy ? '登录中…' : '登录';
  }

  function setBusy(busy) {
    if (els.refreshBtn) {
      els.refreshBtn.disabled = !!busy;
      els.refreshBtn.textContent = busy ? '读取中…' : '刷新';
    }
    if (els.viewDash) els.viewDash.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function showNotice(msg, kind, sticky) {
    var node = els.notice;
    if (!node) return;
    if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null; }
    node.textContent = msg || '';
    node.className = 'adm-notice' + (kind ? ' is-' + kind : '');
    node.hidden = !msg;
    if (msg && !sticky) {
      noticeTimer = setTimeout(function () {
        node.hidden = true;
        node.textContent = '';
      }, NOTICE_MS);
    }
  }

  function clearNotice() {
    if (noticeTimer) { clearTimeout(noticeTimer); noticeTimer = null; }
    if (els.notice) {
      els.notice.hidden = true;
      els.notice.textContent = '';
    }
  }

  /* ============================== 状态条渲染 ============================== */

  function renderStatus() {
    var sourceLabels = {
      supabase: 'SUPABASE · 云端',
      local: 'LOCAL · 本机浏览器',
      custom: 'CUSTOM · 自定义接口'
    };
    if (els.statusSource) els.statusSource.textContent = sourceLabels[state.source] || state.source;
    if (els.statusVersion) els.statusVersion.textContent = rangeLabel();
    if (els.statusEmail) {
      els.statusEmail.textContent = state.email ||
        (state.source === 'local' ? '未登录（本地模式）' : '未登录');
    }
    if (els.statusCount) {
      if (!state.loaded && state.loading) {
        els.statusCount.textContent = '读取中…';
      } else if (state.rows.length) {
        els.statusCount.textContent = state.rows.length + ' 条记录' +
          (state.rows.length >= FETCH_LIMIT ? '（上限）' : '');
      } else {
        els.statusCount.textContent = state.loaded ? '0 条记录' : '—';
      }
    }
  }

  /* ================================ KPI ================================ */

  var KPI_DEFS = [
    { key: 'total', label: '总答卷', note: '当前版本范围 + 时间筛选' },
    { key: 'today', label: '今日新增', note: '按本机日期统计' },
    { key: 'newVersion', label: '新版答卷', note: 'M01–M08 机体数据' },
    { key: 'complete', label: '完成答卷率', note: 'answered = total' },
    { key: 'duration', label: '平均用时', note: '含 duration_ms 的记录' },
    { key: 'tie', label: '并列答卷数', note: 'percents.match.tie = true' }
  ];

  function renderKpis(rows) {
    var todayKey = dayKey(new Date());
    var today = 0, newVersion = 0, complete = 0, tie = 0;
    var durSum = 0, durCount = 0;

    rows.forEach(function (row) {
      var d = toDate(row && row.created_at);
      if (d && dayKey(d) === todayKey) today++;
      if (isMachineRow(row)) newVersion++;
      if (isComplete(row)) complete++;
      if (isTie(row)) tie++;
      var ms = durationOf(row);
      if (ms) { durSum += ms; durCount++; }
    });

    var total = rows.length;
    var values = {
      total: String(total),
      today: String(today),
      newVersion: String(newVersion),
      complete: total ? Math.round((complete / total) * 100) + '%' : '—',
      duration: durCount ? fmtDuration(durSum / durCount) : '—',
      tie: String(tie)
    };

    clear(els.kpis);
    KPI_DEFS.forEach(function (def) {
      var card = el('div', 'adm-kpi');
      card.appendChild(el('span', 'adm-kpi-label mono', def.label));
      card.appendChild(el('span', 'adm-kpi-value', values[def.key]));
      card.appendChild(el('span', 'adm-kpi-note', def.note));
      els.kpis.appendChild(card);
    });
  }

  /* ============================ 8 机体分布 ============================ */

  function renderTypeChart(cohort) {
    var types = (E && E.types) || [];
    var machineRows = cohort.filter(isMachineRow);
    var totalMachine = machineRows.length;
    var legacyCount = cohort.length - totalMachine;
    var disableRows = isV1Range();
    var counts = {};

    machineRows.forEach(function (row) {
      var type = typeOf(row);
      if (type) counts[type.id] = (counts[type.id] || 0) + 1;
    });

    clear(els.typeChart);
    types.forEach(function (type) {
      var n = counts[type.id] || 0;
      var pct = fmtPct(n, totalMachine);
      var row = el('button', 'adm-dist-row');
      row.type = 'button';
      row.setAttribute('data-code', type.id);
      row.setAttribute('aria-pressed', state.filterType === type.id ? 'true' : 'false');
      if (state.filterType === type.id) row.classList.add('is-active');
      if (disableRows) row.disabled = true;

      var name = el('span', 'adm-dist-name');
      name.appendChild(el('span', 'adm-dist-name-text', type.name));
      name.appendChild(el('span', 'adm-dist-code mono', type.id));
      row.appendChild(name);

      var bar = el('span', 'adm-dist-bar');
      var fill = el('span', 'adm-dist-fill');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      row.appendChild(bar);

      var val = el('span', 'adm-dist-val');
      val.appendChild(el('b', null, String(n)));
      val.appendChild(el('i', null, ' · ' + pct + '%'));
      row.appendChild(val);

      row.title = disableRows
        ? type.name + '：当前版本范围没有 8 机体数据'
        : type.name + '：' + n + ' 份（' + pct + '%），点击筛选下方表格';
      els.typeChart.appendChild(row);
    });

    if (!totalMachine) {
      els.typeChart.appendChild(el('p', 'adm-empty',
        '当前版本范围（' + rangeShortLabel() + '）没有 8 机体数据。'));
    }

    if (els.typeMeta) {
      els.typeMeta.textContent = totalMachine + ' 份 8 机体' +
        (legacyCount ? ' · ' + legacyCount + ' 份旧版' : '');
    }

    renderLegacyChart(cohort);
  }

  function renderLegacyChart(cohort) {
    if (!els.legacyBlock || !els.legacyChart) return;
    var oldRows = cohort.filter(function (row) { return !isMachineRow(row); });
    // 所选版本范围内存在四字母旧记录时才显示旧版类型区（v2/v2.0/v2.1 下自动隐藏）
    els.legacyBlock.hidden = oldRows.length === 0;
    clear(els.legacyChart);
    if (!oldRows.length) return;

    var groups = {};
    var order = [];
    oldRows.forEach(function (row) {
      var code = String(row.result_code || '').trim() || '（无编号）';
      if (!groups[code]) {
        groups[code] = { code: code, name: row.result_name ? String(row.result_name) : '', count: 0 };
        order.push(code);
      }
      groups[code].count++;
      if (!groups[code].name && row.result_name) groups[code].name = String(row.result_name);
    });

    order.sort(function (a, b) { return groups[b].count - groups[a].count; });
    var totalOld = oldRows.length;

    order.forEach(function (code) {
      var group = groups[code];
      var pct = fmtPct(group.count, totalOld);
      var row = el('button', 'adm-dist-row');
      row.type = 'button';
      row.setAttribute('data-legacy', code);
      row.setAttribute('aria-pressed', state.filterLegacy === code ? 'true' : 'false');
      if (state.filterLegacy === code) row.classList.add('is-active');

      var name = el('span', 'adm-dist-name');
      name.appendChild(el('span', 'adm-dist-legacy-code mono', code));
      if (group.name) name.appendChild(el('span', 'adm-dist-code', group.name));
      row.appendChild(name);

      var bar = el('span', 'adm-dist-bar');
      var fill = el('span', 'adm-dist-fill');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      row.appendChild(bar);

      var val = el('span', 'adm-dist-val');
      val.appendChild(el('b', null, String(group.count)));
      val.appendChild(el('i', null, ' · ' + pct + '%'));
      row.appendChild(val);

      row.title = '旧版类型 ' + code + '：' + group.count + ' 份，点击筛选下方表格';
      els.legacyChart.appendChild(row);
    });
  }

  /* ============================== 四维平均 ============================== */

  function renderDimChart(cohort) {
    clear(els.dimChart);
    var machineRows = cohort.filter(isMachineRow);

    DIM_ORDER.forEach(function (key) {
      var dim = DIMS[key];
      if (!dim) return;
      var leftName = (dim.left && dim.left.name) || '左侧';
      var rightName = (dim.right && dim.right.name) || '右侧';
      var sum = 0;
      var n = 0;

      machineRows.forEach(function (row) {
        var p = row.percents && row.percents[key];
        var v = p ? Number(p.left) : NaN;
        if (isFinite(v)) { sum += v; n++; }
      });

      var avg = n ? sum / n : null;

      var wrap = el('div', 'adm-dim');
      var head = el('div', 'adm-dim-head');
      head.appendChild(el('span', 'adm-dim-label', dim.label || key));
      head.appendChild(el('span', 'adm-dim-n mono', n ? 'n=' + n : '无有效样本'));
      wrap.appendChild(head);

      var body = el('div', 'adm-dim-body');
      body.appendChild(el('span', 'adm-dim-pole', leftName));

      var track = el('div', 'adm-dim-track');
      var fill = el('span', 'adm-dim-fill');
      fill.style.width = (avg === null ? 0 : Math.max(0, Math.min(100, avg))) + '%';
      track.appendChild(fill);
      track.appendChild(el('span', 'adm-dim-mid'));
      track.title = avg === null
        ? (dim.label || key) + '：暂无新版数据'
        : (dim.label || key) + '：' + leftName + ' ' + fmtAvg(avg) + ' / ' +
          rightName + ' ' + fmtAvg(100 - avg);
      body.appendChild(track);

      body.appendChild(el('span', 'adm-dim-pole adm-dim-pole--right', rightName));
      wrap.appendChild(body);

      var foot = el('div', 'adm-dim-foot');
      foot.appendChild(el('span', 'mono adm-dim-val-l',
        avg === null ? '左侧平均 —' : '左侧平均 ' + fmtAvg(avg)));
      foot.appendChild(el('span', 'mono adm-dim-val-r',
        avg === null ? '右侧平均 —' : '右侧平均 ' + fmtAvg(100 - avg)));
      wrap.appendChild(foot);

      els.dimChart.appendChild(wrap);
    });
  }

  /* ============================ 16 题选项分布 ============================ */

  function renderQuestionStats(cohort) {
    var questions = S.questions || [];
    var answeredRows = cohort.filter(function (row) {
      return row && row.answers && typeof row.answers === 'object';
    });

    clear(els.questionStats);

    questions.forEach(function (question) {
      var counts = [0, 0, 0];
      var valid = 0;

      answeredRows.forEach(function (row) {
        var raw = row.answers ? row.answers[question.id] : undefined;
        var idx = Number(raw);
        if (isFinite(idx) && Math.floor(idx) === idx && idx >= 0 && idx < counts.length) {
          counts[idx]++;
          valid++;
        }
      });

      var block = el('div', 'adm-q');

      var head = el('div', 'adm-q-head');
      head.appendChild(el('span', 'adm-q-id', String(question.id || '').toUpperCase()));
      var dim = DIMS[question.dim];
      head.appendChild(el('span', 'adm-q-dim', (dim && dim.label) || question.dim || ''));
      block.appendChild(head);

      block.appendChild(el('p', 'adm-q-text', question.text || ''));

      (question.options || []).forEach(function (opt, index) {
        var n = counts[index] || 0;
        var pct = fmtPct(n, valid);
        var row = el('div', 'adm-opt');

        var text = el('span', 'adm-opt-text', opt.text || '');
        text.title = opt.text || '';
        row.appendChild(text);

        var track = el('span', 'adm-opt-track');
        var fill = el('span', 'adm-opt-fill');
        fill.style.width = pct + '%';
        track.appendChild(fill);
        row.appendChild(track);

        row.appendChild(el('span', 'adm-opt-val', n + ' · ' + pct + '%'));
        block.appendChild(row);
      });

      els.questionStats.appendChild(block);
    });

    if (els.questionMeta) {
      els.questionMeta.textContent = 'OPTION STATS · ' + cohort.length + ' 份';
    }
  }

  /* ============================== 14 天趋势 ============================== */

  function renderTrend() {
    var chart = els.trendChart;
    if (!chart) return;
    clear(chart);

    var days = [];
    var today = startOfToday();
    for (var i = 13; i >= 0; i--) {
      var d = new Date(today.getTime());
      d.setDate(d.getDate() - i);
      days.push({ key: dayKey(d), month: d.getMonth() + 1, day: d.getDate(), count: 0 });
    }

    var byKey = {};
    days.forEach(function (item) { byKey[item.key] = item; });

    // 趋势不受“时间范围”筛选影响，只看版本与机体筛选
    versionRows().filter(matchType).forEach(function (row) {
      var d = toDate(row && row.created_at);
      if (!d) return;
      var item = byKey[dayKey(d)];
      if (item) item.count++;
    });

    var max = 1;
    days.forEach(function (item) { if (item.count > max) max = item.count; });
    var total = 0;

    days.forEach(function (item, index) {
      total += item.count;
      var isToday = index === days.length - 1;
      var col = el('div', 'adm-trend-col' + (item.count ? '' : ' is-zero') +
        (isToday ? ' is-today' : ''));
      col.title = item.key + '：' + item.count + ' 条';

      col.appendChild(el('span', 'adm-trend-count', String(item.count)));

      var barWrap = el('div', 'adm-trend-barwrap');
      var bar = el('span', 'adm-trend-bar');
      bar.style.height = item.count
        ? Math.max(3, Math.round((item.count / max) * 104)) + 'px'
        : '2px';
      barWrap.appendChild(bar);
      col.appendChild(barWrap);

      col.appendChild(el('span', 'adm-trend-date', item.month + '/' + item.day));
      chart.appendChild(col);
    });

    if (els.trendNote) {
      els.trendNote.textContent = '统计口径：按本机日期归档，最近 14 天共 ' + total +
        ' 条；不受“时间范围”筛选影响（当前版本范围：' + rangeShortLabel() + '）。';
    }
  }

  /* ================================ 表格 ================================ */

  function buildRow(row) {
    var tr = el('tr');
    tr.setAttribute('data-id', String(row.id || ''));

    var time = el('td', 'adm-cell-time');
    time.textContent = fmtTime(row.created_at);
    var created = toDate(row.created_at);
    if (created) time.title = created.toISOString();
    tr.appendChild(time);

    var version = el('td');
    var versionBadge = el('span', 'adm-ver mono', row.survey_version || '—');
    if (isCurrentVersionRow(row)) versionBadge.classList.add('is-current');
    version.appendChild(versionBadge);
    tr.appendChild(version);

    var result = el('td', 'adm-cell-result');
    if (isMachineRow(row)) {
      var type = typeOf(row);
      result.appendChild(el('span', 'adm-result-name',
        (type && type.name) || row.result_name || '未知机体'));
      result.appendChild(el('span', 'adm-result-code mono',
        (type && type.id) || row.result_code || ''));
    } else {
      result.appendChild(el('span', 'adm-result-legacy mono', row.result_code || '（无编号）'));
      if (row.result_name) {
        result.appendChild(el('span', 'adm-result-oldname', String(row.result_name)));
      }
    }
    tr.appendChild(result);

    var nick = el('td', 'adm-cell-nick');
    nick.textContent = row.nickname ? String(row.nickname) : '—';
    if (row.nickname) nick.title = String(row.nickname);
    tr.appendChild(nick);

    var duration = el('td', 'adm-cell-dur');
    duration.textContent = fmtDuration(durationOf(row));
    tr.appendChild(duration);

    var flags = el('td', 'adm-cell-flags');
    if (isTie(row)) flags.appendChild(el('span', 'adm-flag adm-flag--tie', '并列'));
    if (isAllNeutral(row)) flags.appendChild(el('span', 'adm-flag adm-flag--neutral', '全中性'));
    if (!isTie(row) && isNear(row)) flags.appendChild(el('span', 'adm-flag', '近似'));
    if (!flags.firstChild) flags.appendChild(el('span', 'adm-cell-note', '—'));
    tr.appendChild(flags);

    var device = el('td', 'adm-device');
    device.appendChild(el('span', 'adm-device-main', row.screen || '—'));
    if (row.lang) device.appendChild(el('span', 'adm-device-sub mono', String(row.lang)));
    if (row.user_agent) device.title = String(row.user_agent);
    tr.appendChild(device);

    var ops = el('td', 'adm-cell-ops');
    var view = el('button', 'adm-btn-view', '查看');
    view.type = 'button';
    view.setAttribute('data-view', String(row.id || ''));
    view.title = '查看这份答卷的逐题答案';
    ops.appendChild(view);
    var del = el('button', 'adm-btn-del', '删除');
    del.type = 'button';
    del.setAttribute('data-del', String(row.id || ''));
    ops.appendChild(del);
    tr.appendChild(ops);

    return tr;
  }

  function renderTable(rows) {
    var tbody = els.tableBody;
    if (!tbody) return;
    clear(tbody);

    var list = rows.slice(0, TABLE_LIMIT);
    if (els.tableInfo) {
      els.tableInfo.textContent = rows.length + ' 条筛选结果 · 显示 ' + list.length +
        (rows.length > list.length ? ' 行（上限 ' + TABLE_LIMIT + '）' : ' 行');
    }

    if (!list.length) {
      var tr = el('tr', 'adm-table-empty');
      var td = el('td');
      td.colSpan = 8;
      if (!state.rows.length) {
        td.textContent = state.loaded ? '暂无数据。' : '正在读取数据…';
      } else if (!versionRows().length) {
        td.textContent = '当前版本范围（' + rangeShortLabel() + '）暂无答卷。';
      } else {
        td.textContent = '当前筛选条件下没有记录，调整时间 / 机体筛选试试。';
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    list.forEach(function (row) { tbody.appendChild(buildRow(row)); });
  }

  /* ============================== 全部渲染 ============================== */

  /** 版本范围联动：v1 系列没有机体编号 → 清空并禁用机体筛选，同时显示提示 */
  function syncVersionDependentState() {
    var legacyOnly = isV1Range();
    if (legacyOnly) state.filterType = '';
    if (els.filterType) {
      if (legacyOnly) {
        els.filterType.value = '';
        els.filterType.disabled = true;
        els.filterType.title = '旧版记录没有机体编号，当前版本范围不适用';
        els.filterType.setAttribute('aria-disabled', 'true');
      } else {
        if (els.filterType.value !== (state.filterType || '')) {
          els.filterType.value = state.filterType || '';
        }
        els.filterType.disabled = false;
        els.filterType.removeAttribute('title');
        els.filterType.setAttribute('aria-disabled', 'false');
      }
    }
    if (els.filterTypeHint) els.filterTypeHint.hidden = !legacyOnly;
  }

  /** 所选版本 + 时间范围内没有旧版记录（或旧类型已不存在）时，清空旧版类型筛选 */
  function clearStaleLegacyFilter(cohort) {
    var hasLegacy = false;
    for (var i = 0; i < cohort.length; i++) {
      if (!isMachineRow(cohort[i])) { hasLegacy = true; break; }
    }
    if (!hasLegacy) { state.filterLegacy = ''; return; }
    if (!state.filterLegacy) return;
    for (var j = 0; j < cohort.length; j++) {
      var row = cohort[j];
      if (!isMachineRow(row) && String(row.result_code || '') === state.filterLegacy) return;
    }
    state.filterLegacy = '';
  }

  function renderAll() {
    syncVersionDependentState();
    var cohort = cohortRows();
    clearStaleLegacyFilter(cohort);
    var filtered = cohort.filter(matchType);
    renderStatus();
    renderKpis(cohort);
    renderTypeChart(cohort);
    renderDimChart(cohort);
    renderQuestionStats(cohort);
    renderTrend();
    renderTable(filtered);
  }

  /* ============================== 数据加载 ============================== */

  function load(opts) {
    opts = opts || {};
    if (state.loading) return;
    if (!St || !St.admin || typeof St.admin.fetchRows !== 'function') {
      showNotice('数据层没有就绪：Store.admin.fetchRows 缺失，请检查 store.js 是否加载。', 'error', true);
      return;
    }

    state.loading = true;
    setBusy(true);
    clearNotice();
    renderStatus();

    if (els.tableInfo) els.tableInfo.textContent = '读取中…';

    var request;
    try {
      request = St.admin.fetchRows({ limit: FETCH_LIMIT });
    } catch (err) {
      state.loading = false;
      setBusy(false);
      renderAll();
      handleLoadError(err);
      return;
    }

    request.then(function (rows) {
      state.rows = sortDesc(Array.isArray(rows) ? rows : []);
      state.loading = false;
      state.loaded = true;
      setBusy(false);
      buildVersionFilter();  // 按最新数据重建版本下拉，同时保留当前选择
      renderAll();
      if (opts.successMsg) showNotice(opts.successMsg, 'success', false);
    }, function (err) {
      state.loading = false;
      state.loaded = true;
      setBusy(false);
      if (isExpiredAuth(err)) {
        forceRelogin(messageOf(err));
        return;
      }
      renderAll();
      handleLoadError(err);
    });
  }

  /* ============================== 错误处理 ============================== */

  function isExpiredAuth(err) {
    var msg = messageOf(err);
    if (err && err.status === 401) return true;
    if (err && err.code === 'UNAUTH') {
      // Store 把 403 也标成 UNAUTH，但权限问题不应把用户踢回登录页
      if (/权限|permission|rls|policy|row-level/i.test(msg)) return false;
      return true;
    }
    if (/登录已过期|重新登录|jwt|token/i.test(msg) && !/权限|permission|rls/i.test(msg)) {
      return true;
    }
    return false;
  }

  function forceRelogin(msg) {
    try { St.admin.signOut(); } catch (e) { /* ignore */ }
    state.email = '';
    showView('login');
    setLoginMessage(msg || '登录已过期，请重新登录。', 'error');
  }

  function handleLoadError(err) {
    var msg = messageOf(err);
    var hint;
    if (/权限|permission|rls|policy|row-level/i.test(msg)) {
      hint = '请到 Supabase 检查 RLS 策略：authenticated 角色需要有表 ai_personality_responses 的 select 权限（auth_can_read）；修复后请重新登录并刷新页面。';
    } else if (/不存在|does not exist|not exist|relation|schema|could not find|找不到/i.test(msg)) {
      hint = '请到 Supabase → Table Editor 确认表 ai_personality_responses 存在，并核对 config.js 里的 supabase.table。';
    } else if (/network|failed to fetch|连不上|timeout|超时|abort/i.test(msg)) {
      hint = '请检查网络连接后点击“刷新”重试。';
    } else {
      hint = '可到 Supabase 控制台检查数据表与 RLS 配置后点击“刷新”重试。';
    }
    showNotice('读取失败：' + msg + '。' + hint, 'error', true);
  }

  function handleRemoveError(err) {
    if (isExpiredAuth(err)) {
      forceRelogin(messageOf(err));
      return;
    }
    var msg = messageOf(err);
    var hint = /权限|permission|rls|policy|row-level/i.test(msg)
      ? '请到 Supabase 检查 auth_can_delete 策略是否允许 authenticated 删除。'
      : '请稍后重试，或到 Supabase 控制台手动删除。';
    showNotice('删除失败：' + msg + '。' + hint, 'error', true);
  }

  /* ================================ 登录 ================================ */

  function onLoginSubmit(event) {
    if (event && event.preventDefault) event.preventDefault();
    if (state.loading) return;
    if (!St || !St.admin || typeof St.admin.signIn !== 'function') {
      setLoginMessage('数据层没有就绪：Store.admin.signIn 缺失。', 'error');
      return;
    }

    var email = (els.loginEmail && els.loginEmail.value || '').trim();
    var password = (els.loginPwd && els.loginPwd.value || '');

    if (!email) {
      setLoginMessage('请输入登录邮箱。', 'error');
      if (els.loginEmail) { try { els.loginEmail.focus(); } catch (e) { /* ignore */ } }
      return;
    }
    if (!password) {
      setLoginMessage('请输入登录密码。', 'error');
      if (els.loginPwd) { try { els.loginPwd.focus(); } catch (e) { /* ignore */ } }
      return;
    }

    state.loading = true;
    setLoginBusy(true);
    setLoginMessage('正在登录…', 'info');

    var request;
    try {
      request = St.admin.signIn(email, password);
    } catch (err) {
      state.loading = false;
      setLoginBusy(false);
      setLoginMessage(messageOf(err), 'error');
      return;
    }

    request.then(function (session) {
      state.loading = false;
      setLoginBusy(false);
      state.email = (session && session.email) || email;
      setLoginMessage('', '');
      if (els.loginPwd) els.loginPwd.value = '';
      showView('dash');
      load();
    }, function (err) {
      state.loading = false;
      setLoginBusy(false);
      setLoginMessage(messageOf(err) || '登录失败，请检查邮箱和密码。', 'error');
      if (els.loginPwd) {
        try { els.loginPwd.select(); } catch (e) { /* ignore */ }
      }
    });
  }

  function onLogout() {
    closeDetail();
    try { St.admin.signOut(); } catch (e) { /* ignore */ }
    state.email = '';
    state.rows = [];
    state.loaded = false;
    state.filterType = '';
    state.filterLegacy = '';
    if (els.filterType) els.filterType.value = '';
    showView('login');
    setLoginMessage('已退出登录。', 'info');
    if (els.loginEmail) { try { els.loginEmail.focus(); } catch (e) { /* ignore */ } }
  }

  /* ================================ 导出 ================================ */

  function fileStamp() {
    var d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '-' + pad2(d.getHours()) + pad2(d.getMinutes());
  }

  function downloadBlob(filename, content, mime) {
    try {
      var blob = new Blob([content], { type: mime });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      setTimeout(function () {
        try {
          if (link.parentNode) link.parentNode.removeChild(link);
          URL.revokeObjectURL(url);
        } catch (e) { /* ignore */ }
      }, 1500);
      return true;
    } catch (err) {
      showNotice('导出失败：' + messageOf(err), 'error', true);
      return false;
    }
  }

  function onExportCsv() {
    var rows = filteredRows();
    if (!rows.length) {
      showNotice('当前筛选条件下没有可导出的记录。', 'info', true);
      return;
    }
    if (!St || typeof St.toCSV !== 'function') {
      showNotice('数据层未提供 CSV 导出（Store.toCSV 缺失）。', 'error', true);
      return;
    }
    var csv;
    try {
      csv = St.toCSV(rows, S);
    } catch (err) {
      showNotice('CSV 生成失败：' + messageOf(err), 'error', true);
      return;
    }
    if (downloadBlob('aipt-responses-' + fileStamp() + '.csv', csv, 'text/csv;charset=utf-8')) {
      showNotice('已导出 ' + rows.length + ' 条记录为 CSV。', 'success', false);
    }
  }

  function onExportJson() {
    var rows = filteredRows();
    if (!rows.length) {
      showNotice('当前筛选条件下没有可导出的记录。', 'info', true);
      return;
    }
    var text;
    try {
      text = JSON.stringify(rows, null, 2);
    } catch (err) {
      showNotice('JSON 生成失败：' + messageOf(err), 'error', true);
      return;
    }
    if (downloadBlob('aipt-responses-' + fileStamp() + '.json', text, 'application/json;charset=utf-8')) {
      showNotice('已导出 ' + rows.length + ' 条记录为 JSON。', 'success', false);
    }
  }

  /* ============================== 答卷详情弹层 ============================== */

  var detailState = {
    row: null,
    trigger: null,
    copyTimer: null
  };

  function findRowById(id) {
    if (id === null || id === undefined) return null;
    var target = String(id);
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      if (row && String(row.id) === target) return row;
    }
    return null;
  }

  function typeNameById(id) {
    var type = E && E.typeById ? E.typeById(id) : null;
    return type ? type.name : '';
  }

  function fmtDistance(value) {
    var n = Number(value);
    if (!isFinite(n)) return '—';
    return String(Math.round(n * 10000) / 10000);
  }

  function fmtSignedNumber(value) {
    var n = Number(value);
    if (!isFinite(n)) return '';
    var rounded = Math.round(n * 100) / 100;
    return rounded > 0 ? '+' + rounded : String(rounded);
  }

  /** 从 answer_detail.score（对象或数字）里取某个维度的分值；没有该维度则取第一个数字 */
  function scoreValue(score, dim) {
    if (typeof score === 'number') return isFinite(score) ? score : null;
    if (score && typeof score === 'object') {
      if (dim && score[dim] !== undefined && score[dim] !== null && isFinite(Number(score[dim]))) {
        return Number(score[dim]);
      }
      var keys = Object.keys(score);
      for (var i = 0; i < keys.length; i++) {
        var raw = score[keys[i]];
        if (raw === undefined || raw === null) continue;
        var n = Number(raw);
        if (isFinite(n)) return n;
      }
    }
    return null;
  }

  function scoreBadgeText(score, dim) {
    var value = scoreValue(score, dim);
    return value === null ? '' : fmtSignedNumber(value);
  }

  /** 旧版 answer_detail 的 score 可能带多个维度，拼成 “+2 / -1” */
  function scoreBadgeFull(score) {
    if (typeof score === 'number') return fmtSignedNumber(score);
    if (score && typeof score === 'object') {
      var parts = [];
      Object.keys(score).forEach(function (key) {
        var raw = score[key];
        if (raw === undefined || raw === null) return;
        var text = fmtSignedNumber(raw);
        if (text) parts.push(text);
      });
      return parts.join(' / ');
    }
    return '';
  }

  function metaItem(label, value, opts) {
    opts = opts || {};
    var item = el('div', 'adm-detail-meta-item');
    item.appendChild(el('dt', 'adm-detail-meta-label mono', label));
    var text = value === undefined || value === null || value === '' ? '—' : String(value);
    var dd = el('dd', 'adm-detail-meta-value' + (opts.mono ? ' is-mono' : '') +
      (opts.clamp ? ' is-clamp' : ''), text);
    if (opts.title && value) dd.title = String(value);
    item.appendChild(dd);
    return item;
  }

  function renderDetailTitle(row) {
    if (!els.detailTitle) return;
    clear(els.detailTitle);
    var machine = isMachineRow(row);
    var type = typeOf(row);
    var name = machine
      ? ((type && type.name) || row.result_name || '未知机体')
      : (row.result_name || '旧版类型');
    var code = machine
      ? ((type && type.id) || row.result_code || '')
      : (row.result_code || '');
    els.detailTitle.appendChild(el('span', 'adm-detail-name', name));
    if (code) {
      els.detailTitle.appendChild(el('span', 'adm-detail-code mono' + (machine ? '' : ' is-legacy'), code));
    }
  }

  function renderDetailFlags(row) {
    if (!els.detailFlags) return;
    clear(els.detailFlags);
    var chips = [];
    if (isTie(row)) chips.push({ text: '并列', cls: ' adm-detail-flag--tie' });
    if (isAllNeutral(row)) chips.push({ text: '全中性', cls: ' adm-detail-flag--neutral' });
    if (!isTie(row) && isNear(row)) chips.push({ text: '近似', cls: ' adm-detail-flag--near' });
    if (!chips.length) {
      els.detailFlags.appendChild(el('span', 'adm-detail-flag-empty mono', '无并列 / 全中性 / 近似标记'));
      return;
    }
    chips.forEach(function (chip) {
      els.detailFlags.appendChild(el('span', 'adm-detail-flag' + chip.cls + ' mono', chip.text));
    });
  }

  function renderDetailMeta(row, match) {
    var meta = els.detailMeta;
    if (!meta) return;
    clear(meta);

    var answered = Number(row.answered);
    var total = Number(row.total);
    var progress = (isFinite(answered) && isFinite(total) && total > 0)
      ? answered + ' / ' + total + (isComplete(row) ? ' · 已完成' : ' · 未完成')
      : '—';
    var env = [row.lang, row.screen, row.timezone]
      .filter(function (value) { return !!value; })
      .join(' · ');

    meta.appendChild(metaItem('提交时间', fmtTime(row.created_at)));
    meta.appendChild(metaItem('问卷版本', row.survey_version || '—', { mono: true }));
    meta.appendChild(metaItem('昵称', row.nickname ? String(row.nickname) : '（未填写）'));
    meta.appendChild(metaItem('用时', fmtDuration(durationOf(row))));
    meta.appendChild(metaItem('完成题数', progress));
    meta.appendChild(metaItem('设备 UA', row.user_agent || '—', { clamp: true, title: row.user_agent }));
    meta.appendChild(metaItem('来源 referrer', row.referrer || '—', { clamp: true, title: row.referrer }));
    meta.appendChild(metaItem('语言 / 屏幕 / 时区', env || '—'));

    // 旧版记录没有 percents.match 时，这几行整体隐藏
    if (match) {
      var candidates = Array.isArray(match.candidates) ? match.candidates : [];
      var candidateText = candidates.map(function (id) {
        var name = typeNameById(id);
        return name ? String(id) + ' ' + name : String(id);
      }).join('、');
      meta.appendChild(metaItem('profileCode', match.profileCode || '—', { mono: true }));
      meta.appendChild(metaItem('并列候选', candidateText || '—'));
      meta.appendChild(metaItem('最佳距离', fmtDistance(match.bestDistance), { mono: true }));
      meta.appendChild(metaItem('次佳距离', fmtDistance(match.secondDistance), { mono: true }));
    }
  }

  function renderDetailDims(row) {
    var box = els.detailDims;
    if (!box) return;
    clear(box);

    DIM_ORDER.forEach(function (key) {
      var dim = DIMS[key] || {};
      var p = row.percents && row.percents[key];
      var leftValue = p ? Number(p.left) : NaN;
      var hasPercents = isFinite(leftValue);
      var left = hasPercents ? Math.max(0, Math.min(100, leftValue)) : null;
      var rightValue = p ? Number(p.right) : NaN;
      var right = hasPercents
        ? (isFinite(rightValue) ? Math.max(0, Math.min(100, rightValue)) : 100 - left)
        : null;

      var leftName = (p && p.leftName) || (dim.left && dim.left.name) || '左侧';
      var rightName = (p && p.rightName) || (dim.right && dim.right.name) || '右侧';

      var raw = row.scores ? row.scores[key] : undefined;
      if (raw === undefined || raw === null || raw === '') raw = p ? p.raw : undefined;
      var rawNumber = Number(raw);
      var hasRaw = raw !== undefined && raw !== null && raw !== '' && isFinite(rawNumber);

      var wrap = el('div', 'adm-detail-dim');

      var head = el('div', 'adm-detail-dim-head');
      head.appendChild(el('span', 'adm-detail-dim-label', dim.label || key));
      head.appendChild(el('span', 'adm-detail-dim-raw mono',
        hasRaw ? '原始分 ' + fmtSignedNumber(rawNumber) : '原始分 —'));
      wrap.appendChild(head);

      var poles = el('div', 'adm-detail-dim-poles');
      poles.appendChild(el('span', 'adm-detail-pole',
        leftName + ' ' + (left === null ? '—' : left + '%')));
      poles.appendChild(el('span', 'adm-detail-pole adm-detail-pole--right',
        rightName + ' ' + (right === null ? '—' : right + '%')));
      wrap.appendChild(poles);

      var track = el('div', 'adm-detail-dim-track');
      track.setAttribute('role', 'img');
      track.setAttribute('aria-label',
        leftName + ' ' + (left === null ? '—' : left + '%') + ' / ' +
        rightName + ' ' + (right === null ? '—' : right + '%'));
      var leftBar = el('span', 'adm-detail-dim-left');
      leftBar.style.width = (left === null ? 0 : left) + '%';
      var rightBar = el('span', 'adm-detail-dim-right');
      rightBar.style.width = (right === null ? 0 : right) + '%';
      track.appendChild(leftBar);
      track.appendChild(rightBar);
      wrap.appendChild(track);

      box.appendChild(wrap);
    });
  }

  function buildDetailMap(row) {
    var map = {};
    var list = Array.isArray(row.answer_detail) ? row.answer_detail : [];
    list.forEach(function (item) {
      if (item && item.id) map[String(item.id)] = item;
    });
    return map;
  }

  function resolveAnswer(question, row) {
    var options = question.options || [];
    var raw = row.answers ? row.answers[question.id] : undefined;
    var idx = Number(raw);
    if (raw !== undefined && raw !== null && raw !== '' && isFinite(idx) &&
        Math.floor(idx) === idx && idx >= 0 && idx < options.length) {
      return { index: idx };
    }
    return { missing: true };
  }

  /** 新版：按当前题库顺序渲染 16 题，缺题/非法下标显示「未作答」 */
  function renderNewAnswers(row, container) {
    var questions = S.questions || [];
    var detailMap = buildDetailMap(row);

    questions.forEach(function (question) {
      var detail = detailMap[question.id] || null;
      var block = el('div', 'adm-detail-q');

      var head = el('div', 'adm-detail-q-head');
      head.appendChild(el('span', 'adm-detail-q-id mono', String(question.id || '').toUpperCase()));
      var dim = DIMS[question.dim];
      head.appendChild(el('span', 'adm-detail-q-dim mono', (dim && dim.label) || question.dim || ''));
      block.appendChild(head);

      block.appendChild(el('p', 'adm-detail-q-text', question.text || ''));

      var resolved = resolveAnswer(question, row);
      var selectedIndex = resolved.missing ? null : resolved.index;
      var textOnly = '';

      if (selectedIndex === null && detail) {
        var detailIndex = Number(detail.index);
        var options = question.options || [];
        if (detail.index !== undefined && detail.index !== null && isFinite(detailIndex) &&
            Math.floor(detailIndex) === detailIndex && detailIndex >= 0 && detailIndex < options.length) {
          selectedIndex = detailIndex;
        } else if (detail.text) {
          for (var i = 0; i < options.length; i++) {
            if (options[i].text === detail.text) { selectedIndex = i; break; }
          }
          if (selectedIndex === null) textOnly = String(detail.text);
        }
      }

      if (selectedIndex === null) {
        if (textOnly) {
          block.appendChild(el('p', 'adm-detail-answer-text', '记录中所选：' + textOnly));
        } else {
          block.appendChild(el('p', 'adm-detail-missing', '未作答'));
        }
      } else {
        var optionsWrap = el('div', 'adm-detail-options');
        (question.options || []).forEach(function (option, optIndex) {
          var isSelected = optIndex === selectedIndex;
          var opt = el('div', 'adm-detail-option' + (isSelected ? ' is-selected' : ''));
          opt.appendChild(el('span', 'adm-detail-option-text', option.text || ''));
          if (isSelected) {
            opt.appendChild(el('span', 'adm-detail-selected-tag mono', '所选'));
            var badge = detail ? scoreBadgeText(detail.score || detail.scores, question.dim) : '';
            if (!badge) badge = scoreBadgeText(option.scores, question.dim);
            if (badge) opt.appendChild(el('span', 'adm-detail-score mono', badge));
          }
          optionsWrap.appendChild(opt);
        });
        block.appendChild(optionsWrap);
      }

      container.appendChild(block);
    });
  }

  /** 旧版：优先按 answer_detail 的文本与顺序展示；为空再按下标 + 当前题库兜底 */
  function renderLegacyAnswers(row) {
    var container = els.detailAnswers;
    var note = els.detailAnswersNote;
    var items = Array.isArray(row.answer_detail) ? row.answer_detail.filter(function (item) {
      return !!item && (item.id || item.text);
    }) : [];

    if (items.length) {
      if (note) {
        note.hidden = false;
        note.textContent = '旧版记录只保留所选答案文本；旧版题目文本可能与当前题库不同，下面按记录中的顺序展示。';
      }
      var list = el('ol', 'adm-detail-old-list');
      items.forEach(function (item, index) {
        var li = el('li', 'adm-detail-old-item');
        var head = el('div', 'adm-detail-old-head');
        head.appendChild(el('span', 'adm-detail-q-id mono',
          item.id ? String(item.id).toUpperCase() : '第 ' + (index + 1) + ' 题'));
        var badge = scoreBadgeFull(item.score || item.scores);
        if (badge) head.appendChild(el('span', 'adm-detail-score mono', badge));
        li.appendChild(head);
        li.appendChild(el('p', 'adm-detail-old-text', item.text || '（这条记录没有保存答案文本）'));
        list.appendChild(li);
      });
      container.appendChild(list);
      return;
    }

    var hasAnswers = row.answers && typeof row.answers === 'object' &&
      Object.keys(row.answers).length > 0;
    if (hasAnswers) {
      if (note) {
        note.hidden = false;
        note.textContent = '旧版记录没有逐题答案文本，以下按当前题库和记录里的选项下标推断；题目文本可能与当时不同。';
      }
      renderNewAnswers(row, container);
      return;
    }

    if (note) {
      note.hidden = false;
      note.textContent = '该旧版记录没有保存逐题答案（旧版数据可能只保存了结果）。';
    }
    container.appendChild(el('p', 'adm-detail-empty', '没有可展示的逐题答案。'));
  }

  function renderDetailAnswers(row) {
    var container = els.detailAnswers;
    if (!container) return;
    clear(container);
    if (els.detailAnswersNote) {
      els.detailAnswersNote.hidden = true;
      els.detailAnswersNote.textContent = '';
    }
    if (isMachineRow(row)) renderNewAnswers(row, container);
    else renderLegacyAnswers(row);
  }

  function renderDetail(row) {
    setDetailCopyMessage('', '');
    renderDetailTitle(row);
    renderDetailFlags(row);
    renderDetailMeta(row, matchMeta(row));
    renderDetailDims(row);
    renderDetailAnswers(row);
  }

  function setDetailCopyMessage(msg, kind) {
    var node = els.detailCopyMsg;
    if (!node) return;
    if (detailState.copyTimer) {
      clearTimeout(detailState.copyTimer);
      detailState.copyTimer = null;
    }
    node.textContent = msg || '';
    node.className = 'adm-detail-copy-msg' + (kind ? ' is-' + kind : '');
    node.hidden = !msg;
    if (msg) {
      detailState.copyTimer = setTimeout(function () {
        node.hidden = true;
        node.textContent = '';
      }, 3200);
    }
  }

  function copyTextToClipboard(text) {
    return new Promise(function (resolve) {
      function fallback() {
        var ok = false;
        try {
          var area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', 'readonly');
          area.style.position = 'fixed';
          area.style.top = '-1000px';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
          document.body.removeChild(area);
        } catch (e) { ok = false; }
        resolve(ok);
      }
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(function () { resolve(true); }, fallback);
      } else {
        fallback();
      }
    });
  }

  function onDetailCopy() {
    if (!detailState.row) return;
    var text;
    try {
      text = JSON.stringify(detailState.row, null, 2);
    } catch (err) {
      setDetailCopyMessage('复制失败：' + messageOf(err), 'error');
      return;
    }
    copyTextToClipboard(text).then(function (ok) {
      setDetailCopyMessage(
        ok ? '已复制该答卷 JSON 到剪贴板。' : '复制失败，请手动选择文本复制。',
        ok ? 'success' : 'error'
      );
    });
  }

  function openDetail(id, trigger) {
    var row = findRowById(id);
    if (!row || !els.detailModal) return;

    var focusTarget = trigger || null;
    if (focusTarget && focusTarget.tagName === 'TR') {
      focusTarget = (focusTarget.querySelector && focusTarget.querySelector('button[data-view]')) || focusTarget;
    }

    detailState.row = row;
    detailState.trigger = focusTarget;

    renderDetail(row);
    els.detailModal.hidden = false;
    document.body.classList.add('adm-modal-open');
    try { els.detailModal.scrollTop = 0; } catch (e) { /* ignore */ }
    if (els.detailClose) {
      try { els.detailClose.focus({ preventScroll: true }); }
      catch (e) { try { els.detailClose.focus(); } catch (e2) { /* ignore */ } }
    }
  }

  function closeDetail() {
    if (!els.detailModal || els.detailModal.hidden) return;
    els.detailModal.hidden = true;
    document.body.classList.remove('adm-modal-open');
    setDetailCopyMessage('', '');

    var trigger = detailState.trigger;
    detailState.trigger = null;
    detailState.row = null;

    if (trigger) {
      var target = trigger;
      if (target.isConnected === false) target = els.refreshBtn || null;
      if (target && typeof target.focus === 'function') {
        try { target.focus({ preventScroll: true }); }
        catch (e) { try { target.focus(); } catch (e2) { /* ignore */ } }
      }
    }
  }

  function onDetailModalClick(event) {
    var target = event && event.target;
    if (!target) return;
    if (target === els.detailModal || target === els.detailBackdrop) closeDetail();
  }

  function onDocumentKeydown(event) {
    if (!event) return;
    var key = event.key;
    if (key === 'Escape' || key === 'Esc' || event.keyCode === 27) {
      if (els.detailModal && !els.detailModal.hidden) {
        if (event.preventDefault) event.preventDefault();
        closeDetail();
      }
    }
  }

  /* ================================ 删除 ================================ */

  function handleDeleteClick(btn) {
    var id = btn.getAttribute('data-del');
    if (!id) return;
    if (!window.confirm('确定删除这条答卷吗？删除后无法恢复。')) return;
    if (!St || !St.admin || typeof St.admin.remove !== 'function') {
      showNotice('数据层没有就绪：Store.admin.remove 缺失。', 'error', true);
      return;
    }

    btn.disabled = true;
    btn.textContent = '删除中';

    var request;
    try {
      request = St.admin.remove(id);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = '删除';
      handleRemoveError(err);
      return;
    }

    request.then(function () {
      load({ successMsg: '已删除 1 条答卷。' });
    }, function (err) {
      btn.disabled = false;
      btn.textContent = '删除';
      handleRemoveError(err);
    });
  }

  function onTableClick(event) {
    var target = event && event.target;
    if (!target || !target.closest) return;

    var deleteBtn = target.closest('button[data-del]');
    if (deleteBtn) {
      handleDeleteClick(deleteBtn);
      return;
    }

    var viewBtn = target.closest('button[data-view]');
    if (viewBtn) {
      openDetail(viewBtn.getAttribute('data-view'), viewBtn);
      return;
    }

    // 整行可点：点到按钮/链接/输入等交互元素时忽略
    if (target.closest('a, button, input, select, textarea, label')) return;
    var tr = target.closest('tr[data-id]');
    if (tr) openDetail(tr.getAttribute('data-id'), tr);
  }

  /* ================================ 事件绑定 ================================ */

  function buildTypeFilter() {
    var select = els.filterType;
    if (!select) return;
    clear(select);

    var all = document.createElement('option');
    all.value = '';
    all.textContent = '全部机体';
    select.appendChild(all);

    ((E && E.types) || []).forEach(function (type) {
      var option = document.createElement('option');
      option.value = type.id;
      option.textContent = type.name;
      select.appendChild(option);
    });

    select.value = state.filterType || '';
  }

  function onVersionChange(event) {
    var raw = event && event.target ? event.target.value : '';
    var selection = normalizeVersionSelection(raw);
    state.filterVersion = selection;
    state.filterLegacy = '';
    if (event && event.target && event.target.value !== selection) {
      try { event.target.value = selection; } catch (e) { /* ignore */ }
    }
    renderAll();
  }

  function onRangeChange(event) {
    state.filterRange = event.target.value;
    renderAll();
  }

  function onTypeSelectChange(event) {
    state.filterType = event.target.value;
    state.filterLegacy = '';
    renderAll();
  }

  function onTypeChartClick(event) {
    var target = event && event.target;
    if (!target || !target.closest) return;
    var btn = target.closest('button[data-code]');
    if (!btn) return;
    var code = btn.getAttribute('data-code');
    state.filterType = state.filterType === code ? '' : code;
    state.filterLegacy = '';
    if (els.filterType) els.filterType.value = state.filterType;
    renderAll();
  }

  function onLegacyChartClick(event) {
    var target = event && event.target;
    if (!target || !target.closest) return;
    var btn = target.closest('button[data-legacy]');
    if (!btn) return;
    var code = btn.getAttribute('data-legacy');
    state.filterLegacy = state.filterLegacy === code ? '' : code;
    state.filterType = '';
    if (els.filterType) els.filterType.value = '';
    renderAll();
  }

  function bindEvents() {
    on(els.loginForm, 'submit', onLoginSubmit);
    on(els.logoutBtn, 'click', onLogout);
    on(els.refreshBtn, 'click', function () { load(); });
    on(els.exportCsv, 'click', onExportCsv);
    on(els.exportJson, 'click', onExportJson);
    on(els.filterVersion, 'change', onVersionChange);
    on(els.filterRange, 'change', onRangeChange);
    on(els.filterType, 'change', onTypeSelectChange);
    on(els.tableBody, 'click', onTableClick);
    on(els.typeChart, 'click', onTypeChartClick);
    on(els.legacyChart, 'click', onLegacyChartClick);
    on(els.detailModal, 'click', onDetailModalClick);
    on(els.detailClose, 'click', function () { closeDetail(); });
    on(els.detailCopy, 'click', onDetailCopy);
    on(document, 'keydown', onDocumentKeydown);
    on(window, 'keydown', onDocumentKeydown);
  }

  /* ================================ 启动 ================================ */

  function cacheElements() {
    els.viewLogin = $('viewLogin');
    els.viewDash = $('viewDash');
    els.loginForm = $('loginForm');
    els.loginEmail = $('loginEmail');
    els.loginPwd = $('loginPwd');
    els.loginBtn = $('loginBtn');
    els.loginMsg = $('loginMsg');
    els.loginLead = $('loginLead');
    els.logoutBtn = $('logoutBtn');
    els.refreshBtn = $('refreshBtn');
    els.exportCsv = $('exportCsv');
    els.exportJson = $('exportJson');
    els.kpis = $('kpis');
    els.typeChart = $('typeChart');
    els.typeMeta = $('typeMeta');
    els.legacyBlock = $('legacyBlock');
    els.legacyChart = $('legacyChart');
    els.dimChart = $('dimChart');
    els.trendChart = $('trendChart');
    els.trendNote = $('trendNote');
    els.questionStats = $('questionStats');
    els.questionMeta = $('questionMeta');
    els.tableBody = $('tableBody');
    els.tableInfo = $('tableInfo');
    els.filterVersion = $('filterVersion');
    els.filterRange = $('filterRange');
    els.filterType = $('filterType');
    els.filterTypeHint = $('filterTypeHint');
    els.notice = $('notice');
    els.modeBanner = $('modeBanner');
    els.statusSource = $('statusSource');
    els.statusVersion = $('statusVersion');
    els.statusEmail = $('statusEmail');
    els.statusCount = $('statusCount');
    els.footerTable = $('footerTable');
    els.detailModal = $('detailModal');
    els.detailBackdrop = $('detailBackdrop');
    els.detailTitle = $('detailTitle');
    els.detailMeta = $('detailMeta');
    els.detailFlags = $('detailFlags');
    els.detailDims = $('detailDims');
    els.detailAnswers = $('detailAnswers');
    els.detailAnswersNote = $('detailAnswersNote');
    els.detailCopy = $('detailCopy');
    els.detailClose = $('detailClose');
    els.detailCopyMsg = $('detailCopyMsg');
  }

  function showFatal(msg) {
    if (els.viewLogin) {
      showView('login');
      setLoginMessage(msg, 'error');
      if (els.loginForm) els.loginForm.hidden = true;
      if (els.loginLead) els.loginLead.textContent = '数据后台没有加载成功，暂时无法使用。';
    }
  }

  function enterLocalMode() {
    state.source = 'local';
    state.email = '';
    if (els.modeBanner) {
      els.modeBanner.hidden = false;
      els.modeBanner.textContent = '本地模式 · 仅显示本机浏览器记录';
    }
    if (els.logoutBtn) els.logoutBtn.hidden = true;
    showView('dash');
    renderStatus();
    load();
  }

  function enterCustomMode() {
    state.source = 'custom';
    showView('login');
    if (els.loginForm) els.loginForm.hidden = true;
    if (els.loginLead) {
      els.loginLead.textContent = '这个数据后台只支持 Supabase 云端数据或本机 local 记录，自定义接口模式暂不提供查看面板。';
    }
    setLoginMessage('当前为自定义接口模式，本后台未配置。', 'warn');
  }

  function enterConfigError() {
    state.source = 'supabase';
    showView('login');
    if (els.loginForm) els.loginForm.hidden = true;
    if (els.loginLead) {
      els.loginLead.textContent = 'Supabase 配置不完整，暂时无法登录读取数据。';
    }
    setLoginMessage('config.js 里的 supabase.url / anonKey 没有配置完整，请检查后刷新页面。', 'error');
  }

  function enterSupabaseMode() {
    state.source = 'supabase';
    if (els.logoutBtn) els.logoutBtn.hidden = false;

    var session = null;
    try { session = St.admin.session(); } catch (e) { session = null; }

    if (session && session.access_token) {
      state.email = session.email || '';
      showView('dash');
      renderStatus();
      load();
      return;
    }

    showView('login');
    renderStatus();
  }

  function boot() {
    cacheElements();

    if (!St || !St.admin || typeof St.admin.dataSource !== 'function') {
      showFatal('数据层没有就绪：Store.admin 缺失，请检查 assets/js/store.js 是否加载。');
      return;
    }

    bindEvents();
    buildTypeFilter();
    buildVersionFilter();  // 首屏先用「已知版本」生成下拉，载入数据后会再次重建

    if (els.footerTable) {
      var tableName = (CFG.supabase && CFG.supabase.table) || 'ai_personality_responses';
      els.footerTable.textContent = tableName;
    }

    var source;
    try {
      source = St.admin.dataSource();
    } catch (err) {
      showFatal('无法读取当前数据源：' + messageOf(err));
      return;
    }
    state.source = source || 'local';

    if (state.source === 'local') {
      enterLocalMode();
      return;
    }
    if (state.source === 'custom') {
      enterCustomMode();
      return;
    }

    // supabase
    var ready = false;
    try { ready = St.admin.ready(); } catch (e) { ready = false; }
    if (!ready) {
      enterConfigError();
      return;
    }
    enterSupabaseMode();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
