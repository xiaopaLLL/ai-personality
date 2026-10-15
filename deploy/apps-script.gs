/**
 * =============================================================================
 *  备选后端 A：Google Apps Script + Google 表格
 * =============================================================================
 *  适合「不想注册 Supabase、就想用表格看数据」的情况。完全免费，5 分钟搞定。
 *
 *  部署步骤：
 *   1. 打开 https://sheets.new 新建一个空白表格，命名如「AI人格测试数据」。
 *   2. 菜单：扩展程序 → Apps Script。
 *   3. 把本文件全部内容粘贴进去，覆盖原来的 Code.gs，保存。
 *   4. 右上角「部署」→ 新建部署 → 类型选「Web 应用」：
 *        - 说明：ai-personality
 *        - 执行身份：我
 *        - 谁可以访问：任何人      ← 必须是「任何人」，否则收不到数据
 *      点「部署」，授权（会提示"未验证应用"，点 高级 → 继续前往）。
 *   5. 复制生成的 Web 应用网址（以 /exec 结尾）。
 *   6. 把网址填到 config.js：
 *        backend: 'custom',
 *        custom.endpoint: 'https://script.google.com/macros/s/AKfy..../exec',
 *        custom.adminUrl: 同一个网址（填写后 admin.html 就能直接看统计）,
 *        custom.adminToken: '自己随便设一个长字符串（见下方 TOKEN）'
 *   7. 以后想看数据，直接打开那个 Google 表格；或打开你的 admin.html（需填 adminToken）。
 *
 *  改题目后如果想换表头：删除表格第一行，重新提交一次即可自动重建。
 * =============================================================================
 */

/** 后台只读接口的口令：设成你自己的长随机字符串（config.js 里的 custom.adminToken 要一致） */
var ADMIN_TOKEN = 'change-me-to-a-long-random-string';

/** 表格工作表名称 */
var SHEET_NAME = 'responses';

var HEADERS = [
  'id', 'created_at', 'survey_id', 'survey_version', 'result_code', 'result_name',
  'scores', 'percents', 'answers', 'answer_detail', 'answered', 'total', 'duration_ms',
  'nickname', 'user_agent', 'referrer', 'lang', 'screen', 'timezone'
];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** 收数据：前端用 POST + text/plain 发 JSON 过来 */
function doPost(e) {
  try {
    var body = (e && e.postData && e.postData.contents) || '{}';
    var rec = JSON.parse(body);
    var sheet = getSheet_();
    var row = HEADERS.map(function (k) {
      var v = rec[k];
      if (v === undefined || v === null) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    });
    sheet.appendRow(row);
    return json_({ ok: true, id: rec.id || null });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

/** 只读接口：admin.html 通过 custom.adminUrl + ?token=... 调用 */
function doGet(e) {
  var token = (e && e.parameter && e.parameter.token) || '';
  if (token !== ADMIN_TOKEN) {
    return json_({ ok: false, error: 'unauthorized' });
  }
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return json_({ ok: true, rows: [] });
  var head = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var j = 0; j < head.length; j++) {
      var key = head[j];
      var val = values[i][j];
      if (key === 'scores' || key === 'percents' || key === 'answers' || key === 'answer_detail') {
        try { val = val ? JSON.parse(val) : null; } catch (err) { /* 保持原样 */ }
      }
      if (key === 'created_at' && val instanceof Date) val = val.toISOString();
      obj[key] = val;
    }
    rows.push(obj);
  }
  rows.reverse(); // 最新的在前
  return json_({ ok: true, rows: rows });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 可选：每天把表格数据备份一份到云端硬盘（菜单里手动跑一次即可创建触发器） */
function setupDailyBackup() {
  ScriptApp.newTrigger('backupNow').timeBased().everyDays(1).atHour(3).create();
}

function backupNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = 'ai-personality-backup-' + Utilities.formatDate(new Date(), 'GMT+8', 'yyyyMMdd');
  DriveApp.getFileById(ss.getId()).makeCopy(name, DriveApp.getRootFolder());
}
