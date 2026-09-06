// sql-host.js — chạy `sqlcmd` (child_process, KHÔNG dùng shell) cho những chỗ cần ĐỌC database
// thật. Vỏ mỏng quanh `core/src/sql-config.mjs`: core sinh chuỗi/SQL, file này CHỈ đọc Web.config
// từ đĩa và gọi tiến trình con — không biết gì về FBO.
//
// BA QUYẾT ĐỊNH BẢO MẬT CÓ CHỦ Ý — đừng "dọn gọn" mất chúng khi sửa file này:
//
//   1. Mật khẩu đi qua biến môi trường `SQLCMDPASSWORD` của tiến trình con, KHÔNG qua argv `-P`.
//      Argv của một tiến trình lộ ra ngoài (Task Manager cột "Command line", `wmic process list
//      full`); biến môi trường CỦA RIÊNG tiến trình con thì không hiện ở đó.
//   2. `execFile`, không phải `exec`/`spawn(..., {shell:true})` — tham số đi thẳng vào mảng argv,
//      không qua một shell nào diễn giải lại. Bảng/cột/field đưa vào câu SQL đã được
//      `sql-config.mjs` chặn ký tự lạ bằng regex identifier TRƯỚC khi tới đây; lớp `execFile`
//      này chặn thêm một lớp nữa ở tầng tiến trình.
//   3. KHÔNG BAO GIỜ đưa connection string đầy đủ, `pwd`, hay biến `env` vào `output.appendLine`
//      hay bất kỳ thông báo nào cho người dùng — chỉ log server + tên database, đúng mức đủ để
//      chẩn đoán mà không lộ credential ra Output Channel (thứ có thể bị copy/paste đi nơi khác).
//
// -N -C (encrypt + trust server certificate) LUÔN bật, mirror
// `SqlConnectionSettings.EnsureConnectionSettings` của DevWorkFlow — driver ODBC 17 trở lên (bản
// cài trên máy: 15.0.1300.359) mặc định đòi mã hoá, và SQL Server cũ (2008, thấy trong Web.config
// mẫu của FBISP24) không có certificate hợp lệ nên phải tin cậy certificate của chính nó.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SQLCMD_CANDIDATES = [
  'C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\180\\Tools\\Binn\\SQLCMD.EXE',
  'C:\\Program Files\\Microsoft SQL Server\\Client SDK\\ODBC\\170\\Tools\\Binn\\SQLCMD.EXE',
];

/** `fboDesigner.sqlcmdPath` thắng; không khai thì thử hai đường cài mặc định, cuối cùng rơi về
 * `sqlcmd` trần và để hệ điều hành tự tra PATH. */
function resolveSqlcmdPath(sqlcmdPathSetting) {
  if (sqlcmdPathSetting && String(sqlcmdPathSetting).trim() !== '') return String(sqlcmdPathSetting).trim();
  for (const c of SQLCMD_CANDIDATES) if (fs.existsSync(c)) return c;
  return 'sqlcmd';
}

const SEP = '\u001f'; // unit separator — gần như không bao giờ xuất hiện trong dữ liệu thật

/**
 * Chạy một câu SQL qua `sqlcmd`, trả về mảng dòng ĐÃ TÁCH CỘT. KHÔNG BAO GIỜ throw ra ngoài —
 * lỗi kết nối/timeout/sqlcmd-không-có-trên-máy đều là chuyện BÌNH THƯỜNG ở bậc dò tự động (dò
 * không ra thì rơi xuống hỏi tay, không phải chặn cả lệnh).
 *
 * @param {object} conn   `{server, database, uid, pwd}` từ `core.parseConnectionString`
 * @param {string} query  văn bản SQL, sinh bởi `core/src/sql-config.mjs` hoặc `add-column.mjs`
 * @param {object} opts   `{ sqlcmdPath, timeoutMs = 15000 }`
 * @returns {Promise<{ok:true, rows:string[][]} | {ok:false, reason:string}>}
 */
function runSqlcmd(conn, query, { sqlcmdPath = null, timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    if (!conn?.server) { resolve({ ok: false, reason: 'thiếu server (Data Source) trong connection string' }); return; }

    const args = ['-S', conn.server, '-N', '-C', '-l', '15', '-h', '-1', '-W', '-s', SEP, '-Q', query];
    if (conn.database) args.push('-d', conn.database);
    if (conn.uid) args.push('-U', conn.uid); else args.push('-E');

    const env = { ...process.env };
    if (conn.uid && conn.pwd) env.SQLCMDPASSWORD = conn.pwd;

    execFile(
      resolveSqlcmdPath(sqlcmdPath),
      args,
      { timeout: timeoutMs, env, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // `err.cmd` của Node kèm NGUYÊN VĂN mảng args (có `-U` nhưng KHÔNG có mật khẩu — mật
          // khẩu đi qua env, không qua argv). Vẫn không đưa `err.cmd`/`args` vào `reason`: server
          // là thứ đủ để chẩn đoán, không cần in lại toàn bộ dòng lệnh.
          const detail = String(stderr || err.message || '').trim().split(/\r?\n/)[0] || 'không rõ lý do';
          resolve({ ok: false, reason: `sqlcmd (${conn.server}) lỗi: ${detail}` });
          return;
        }
        const rows = String(stdout)
          .split(/\r?\n/)
          .map((l) => l.replace(/\s+$/u, ''))
          .filter((l) => l.length > 0)
          .map((l) => l.split(SEP));
        resolve({ ok: true, rows });
      },
    );
  });
}

/**
 * Giải `%Database` trong `appConnectionString` template — đọc bảng `entity` trên `sys`, lấy
 * `cdata` của DÒNG ĐẦU (theo `code`), đúng mặc định của DevWorkFlow khi tự chọn (xem
 * `sql-config.mjs`). Không tự đưa ra UI chọn giữa nhiều app database — v1 lấy mặc định, người
 * dùng cần app khác thì tự sửa script sinh ra.
 *
 * @returns {Promise<{ok:true, database:string, all:Array<{code,cname,cdata}>} | {ok:false, reason:string}>}
 */
async function resolveAppDatabase(core, sysConn, { sqlcmdPath = null } = {}) {
  const result = await runSqlcmd(sysConn, core.ENTITY_APP_DATABASE_SQL, { sqlcmdPath });
  if (!result.ok) return result;
  if (result.rows.length === 0) {
    return { ok: false, reason: 'bảng entity không có dòng nào có cdata — không xác định được app database' };
  }
  const all = result.rows.map(([code, cname, cdata]) => ({ code, cname, cdata }));
  return { ok: true, database: all[0].cdata, all };
}

/** Tên cột đã có trên một bảng — dò `sys.columns`, dùng cho bậc "field vừa thêm" của #2. */
async function existingColumns(core, appConn, table, { sqlcmdPath = null } = {}) {
  let sql;
  try { sql = core.existingColumnsSql(table); } catch (err) { return { ok: false, reason: err.message }; }
  const result = await runSqlcmd(appConn, sql, { sqlcmdPath });
  if (!result.ok) return result;
  return { ok: true, columns: result.rows.map((r) => r[0]).filter(Boolean) };
}

/**
 * Độ dài cột chữ cùng tên ở bảng khác — bậc 2 của "độ dài cột chữ" (#2). Trả `length: null` khi
 * KHÔNG dò ra được MỘT con số chắc chắn (không có dòng nào, hoặc nhiều độ dài khác nhau) — gọi
 * chỗ tự rơi xuống hỏi tay, không tự chọn đại một giá trị.
 */
async function stringColumnLength(core, appConn, fieldName, { sqlcmdPath = null } = {}) {
  let sql;
  try { sql = core.stringColumnLengthSql(fieldName); } catch (err) { return { ok: false, reason: err.message }; }
  const result = await runSqlcmd(appConn, sql, { sqlcmdPath });
  if (!result.ok) return result;
  const lengths = result.rows.map((r) => Number(r[0])).filter((n) => Number.isFinite(n) && n > 0);
  if (lengths.length === 1) return { ok: true, length: lengths[0], candidates: lengths };
  return { ok: true, length: null, candidates: lengths };
}

/**
 * Đọc `Web.config` của program (GỐC program, cạnh `App_Data` — không phải cạnh file controller;
 * ba biến thể hoa/thường như `WebConfigReader.FindWebConfig` của DevWorkFlow), rồi lấy connection
 * string theo `name` (`sysConnectionString`/`appConnectionString`) đã parse sẵn thành từng phần.
 */
function readConnection(core, programRoot, name, output) {
  if (!programRoot) return null;
  const candidate = ['Web.config', 'web.config', 'WEB.CONFIG']
    .map((f) => path.join(programRoot, f))
    .find((p) => fs.existsSync(p));
  if (!candidate) return null;
  try {
    const text = core.readSource(candidate).text;
    const cs = core.scanConnectionString(text, name);
    if (!cs) { output?.appendLine(`sql-host: ${candidate} không khai connectionString "${name}"`); return null; }
    return core.parseConnectionString(cs);
  } catch (err) {
    output?.appendLine(`sql-host: không đọc được ${candidate} — ${err.message}`);
    return null;
  }
}

/**
 * Connection string của bảng ĐÍCH: `sysConnectionString` khi `root@database="Sys"`, ngược lại
 * `appConnectionString` — giải `%Database` qua `sys.entity.cdata` nếu còn placeholder.
 *
 * Dọn từ `add-column-host.js` lên đây khi lệnh «xem dữ liệu thật» cần đúng phép giải ấy. Chép
 * sang một bản thứ hai là hai bản sẽ lệch nhau đúng vào ngày một khách nào đó khai `%Database`
 * theo kiểu chưa gặp — và bản lệch thì nối vào SAI DATABASE mà vẫn chạy trơn.
 *
 * KHÔNG BAO GIỜ throw: mọi nhánh lỗi trả `{ok:false, reason}` để chỗ gọi tự quyết rơi về đâu.
 */
async function resolveTargetConnection(core, programRoot, database, output, label = 'sql') {
  const sysConn = readConnection(core, programRoot, 'sysConnectionString', output);
  if (String(database).trim().toLowerCase() === 'sys') {
    return sysConn ? { ok: true, conn: sysConn } : { ok: false, reason: 'không đọc được sysConnectionString từ Web.config' };
  }

  const appConn = readConnection(core, programRoot, 'appConnectionString', output);
  if (!appConn) return { ok: false, reason: 'không đọc được appConnectionString từ Web.config' };
  if (!appConn.database || !/%Database/i.test(appConn.database)) {
    return { ok: true, conn: appConn };
  }
  if (!sysConn) {
    return { ok: false, reason: 'appConnectionString còn %Database nhưng không đọc được sysConnectionString để giải' };
  }
  const resolved = await resolveAppDatabase(core, sysConn);
  if (!resolved.ok) return resolved;
  output?.appendLine(
    `${label}: %Database → "${resolved.database}" (bảng entity trên sys, dòng đầu theo code`
    + `${resolved.all.length > 1 ? `; còn ${resolved.all.length - 1} app database khác, xem sys.entity nếu cần đổi` : ''})`,
  );
  return { ok: true, conn: { ...appConn, database: resolved.database } };
}

/**
 * Chạy câu SELECT xem trước, trả về mảng ĐỐI TƯỢNG khoá theo nhãn cột.
 *
 * Ghép theo VỊ TRÍ, không theo tên cột trả về: `sqlcmd` chạy với `-h -1` nên KHÔNG in dòng tiêu
 * đề, mà thứ tự cột thì đúng bằng thứ tự trong câu `SELECT` do `buildSampleSelect` dựng — đó là
 * nguồn tin cậy hơn hẳn một dòng tiêu đề phải đi phân tích lại.
 *
 * `NULL` của SQL về CHUỖI RỖNG. `sqlcmd` in ô null ra bốn chữ `NULL`, và để nguyên thì lưới xem
 * trước hiện một ô rộng bốn ký tự ở chỗ runtime hiện ô trống — sai đúng cái người ta đang đo.
 * Đổi lại, một ô chứa đúng văn bản "NULL" cũng thành rỗng; đánh đổi ấy nghiêng hẳn về phía đo
 * đúng bề rộng, và đó là việc của lệnh này.
 *
 * @param {string[]} labels nhãn cột theo đúng thứ tự trong câu SELECT
 * @returns {Promise<{ok:true, rows:Array<Record<string,string>>} | {ok:false, reason:string}>}
 */
async function runSampleQuery(conn, sql, labels, { sqlcmdPath = null, timeoutMs = 10000 } = {}) {
  const result = await runSqlcmd(conn, sql, { sqlcmdPath, timeoutMs });
  if (!result.ok) return result;
  const rows = result.rows.map((cells) => {
    const row = {};
    labels.forEach((label, i) => {
      const raw = cells[i];
      row[label] = raw === undefined || raw === 'NULL' ? '' : raw;
    });
    return row;
  });
  return { ok: true, rows };
}

module.exports = {
  runSqlcmd,
  runSampleQuery,
  resolveAppDatabase,
  resolveTargetConnection,
  existingColumns,
  stringColumnLength,
  readConnection,
  resolveSqlcmdPath,
};
