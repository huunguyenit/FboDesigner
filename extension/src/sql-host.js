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
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

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
 * ═══ `-i <file> -o <file> -f 65001`, KHÔNG PHẢI `-Q "<query>"` + đọc thẳng stdout ═══
 *
 * BA LẦN đo, ba kết luận khác nhau, và bài học nằm ở CHỖ ĐO chứ không phải Ở SQL SERVER:
 *
 *   1. `-Q "<query>"` (câu lệnh qua ARGV) + đọc stdout bằng `latin1` — tiếng Việt ra `?`. Kết
 *      luận cũ: "`sqlcmd` không cứu được tiếng Việt", nên mọi cột chữ phải đi vòng qua hex.
 *   2. Đối chiếu trực tiếp `zc_rptPurchaseDiscount` của HOATP qua MCP (SQL Server 2008 R2): một
 *      SELECT trần tiếng Việt đọc THẲNG (không hex) ra ĐÚNG dấu. Kết luận 1 SAI — vấn đề không
 *      phải bản thân `sqlcmd`, mà là CÁCH GỌI. Đổi sang `-i <file UTF-8 có BOM>` (bỏ `-Q`) — vẫn
 *      còn `?` khi đọc lại qua stdout.
 *   3. `execFile` cho stdout của tiến trình con là một PIPE, không phải console/TTY thật. `-f
 *      65001` áp dụng đúng cho phía ĐỌC file input, nhưng KHÔNG áp dụng cho phía GHI qua một
 *      pipe — `sqlcmd` vẫn tự chọn codepage console mặc định khi VIẾT ra stdout. Ghi kết quả ra
 *      một FILE THẬT bằng `-o <file>` thì `-f` mới áp dụng cho CẢ HAI chiều I/O qua file — đúng
 *      cách `run_sql_script` của MCP 4ai-fbo vẫn làm, và đã xác nhận ra đúng dấu.
 *
 * Từ nay ĐỌC KẾT QUẢ QUA FILE (`outFile`), không đọc `stdout` của `execFile` nữa. Cả hai file
 * tạm (input, output) đều UTF-8 kèm BOM — cách `sqlcmd` tự nhận diện Unicode thay vì ANSI/OEM
 * mặc định. Dọn cả hai trong `finally`, kể cả khi `sqlcmd` lỗi hay hết giờ.
 *
 * @param {object} conn   `{server, database, uid, pwd}` từ `core.parseConnectionString`
 * @param {string} query  văn bản SQL, sinh bởi `core/src/sql-config.mjs` hoặc `add-column.mjs`
 * @param {object} opts   `{ sqlcmdPath, timeoutMs = 15000 }`
 * @returns {Promise<{ok:true, rows:string[][]} | {ok:false, reason:string}>}
 */
/**
 * Đối số dòng lệnh cho `sqlcmd` — TÁCH RIÊNG để test được không cần chạy tiến trình con thật.
 *
 * `-i tmpFile -o outFile` (không phải `-Q query` + đọc thẳng stdout) và `-f 65001` (UTF-8 cả
 * đọc lẫn ghi) — xem lý do đầy đủ ở `runSqlcmd`. `headers` bật thì bỏ `-h -1` (xem `runSqlcmd`).
 */
function buildSqlcmdArgs(conn, tmpFile, outFile, { headers = false } = {}) {
  const args = [
    '-S', conn.server, '-N', '-C', '-l', '15',
    ...(headers ? [] : ['-h', '-1']),
    '-W', '-s', SEP, '-f', '65001', '-i', tmpFile, '-o', outFile,
  ];
  if (conn.database) args.push('-d', conn.database);
  if (conn.uid) args.push('-U', conn.uid); else args.push('-E');
  return args;
}

/** Nội dung file kết quả (Buffer, UTF-8, có thể có BOM) → mảng dòng đã tách cột. */
function decodeSqlcmdRows(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf ?? ''), 'binary');
  // `-o` với `-f 65001` ghi kèm BOM ở đầu file, giống mọi file UTF-8 `sqlcmd` tự nhận diện được.
  const withoutBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    ? bytes.subarray(3)
    : bytes;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(withoutBom);
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/u, ''))
    .filter((l) => l.length > 0)
    .map((l) => l.split(SEP));
}

async function runSqlcmd(conn, query, { sqlcmdPath = null, timeoutMs = 15000, headers = false } = {}) {
  if (!conn?.server) return { ok: false, reason: 'thiếu server (Data Source) trong connection string' };

  const stamp = crypto.randomBytes(8).toString('hex');
  const tmpFile = path.join(os.tmpdir(), `fbo-designer-${stamp}.sql`);
  const outFile = path.join(os.tmpdir(), `fbo-designer-${stamp}.out`);
  try {
    // BOM ở đầu — cách `sqlcmd` tự nhận diện một file input là Unicode thay vì ANSI/OEM mặc định.
    fs.writeFileSync(tmpFile, `﻿${query}`, 'utf8');

    const args = buildSqlcmdArgs(conn, tmpFile, outFile, { headers });
    const env = { ...process.env };
    if (conn.uid && conn.pwd) env.SQLCMDPASSWORD = conn.pwd;

    const result = await new Promise((resolve) => {
      execFile(
        resolveSqlcmdPath(sqlcmdPath),
        args,
        {
          timeout: timeoutMs,
          env,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
          encoding: 'buffer',
        },
        (err, stdout, stderr) => {
          const errText = Buffer.isBuffer(stderr)
            ? new TextDecoder('utf-8', { fatal: false }).decode(stderr)
            : String(stderr || '');
          if (err) {
            // `err.cmd` của Node kèm NGUYÊN VĂN mảng args (có `-U` nhưng KHÔNG có mật khẩu — mật
            // khẩu đi qua env, không qua argv). Vẫn không đưa `err.cmd`/`args` vào `reason`: server
            // là thứ đủ để chẩn đoán, không cần in lại toàn bộ dòng lệnh.
            const detail = errText.trim().split(/\r?\n/)[0] || String(err.message || '').trim() || 'không rõ lý do';
            resolve({ ok: false, reason: `sqlcmd (${conn.server}) lỗi: ${detail}` });
            return;
          }
          /*
           * `-o <file>` — KHÔNG đọc `stdout` nữa. `execFile` với stdout là một PIPE (không phải
           * console/TTY thật) khiến `sqlcmd` áp `-f 65001` cho việc ĐỌC file input, nhưng KHÔNG
           * áp cho ĐƯỜNG GHI stdout — đo được: tiếng Việt vẫn ra `?` dù đã đổi input sang UTF-8.
           * Ghi kết quả ra một FILE THẬT với `-o` thì `-f` áp dụng cho CẢ HAI chiều I/O bằng file
           * — đúng cách `run_sql_script` của MCP 4ai-fbo đã làm và đã xác nhận đúng dấu.
           */
          let fileBuf;
          try { fileBuf = fs.readFileSync(outFile); } catch (readErr) {
            resolve({ ok: false, reason: `sqlcmd (${conn.server}) không ghi được file kết quả: ${readErr.message}` });
            return;
          }
          resolve({ ok: true, rows: decodeSqlcmdRows(fileBuf) });
        },
      );
    });
    return result;
  } finally {
    // File tạm, dọn best-effort — không chặn kết quả vì việc dọn dẹp lỗi.
    try { fs.unlinkSync(tmpFile); } catch { /* đã dọn hoặc chưa từng ghi được — bỏ qua */ }
    try { fs.unlinkSync(outFile); } catch { /* đã dọn hoặc chưa từng ghi được — bỏ qua */ }
  }
}

/**
 * Hex style 2 từ `convert(varbinary, …)` → chuỗi Unicode.
 *
 * LUÔN LUÔN UTF-16LE, không đoán: câu lệnh ép `convert(nvarchar(4000), …)` ở trong cùng trước
 * khi lấy `varbinary` (xem `grid-sample.selectItem`), nên dãy byte không còn phụ thuộc kiểu cột.
 *
 * Bản trước đoán bằng cách đếm byte lẻ bằng 0 để phân biệt UTF-16LE với Windows-1258. Phép đoán
 * ấy lật đúng vào chuỗi khó nhất — một tên toàn tiếng Việt (`Ạ` = A0 1E) có ít byte 0 hơn hẳn
 * một tên tiếng Anh. Ép kiểu ở vế SQL rẻ hơn mọi phép đoán ở vế này.
 *
 * `NFC` vẫn giữ: `nvarchar` của SQL Server không hứa dạng chuẩn hoá nào, mà `Ạ` dựng sẵn với
 * `Ạ` tổ hợp là hai chuỗi khác nhau khi đo độ dài — thứ cả tính năng sinh ra để đo.
 */
function decodeHexCell(value) {
  if (value === undefined || value === null || value === 'NULL') return '';
  const hex = String(value).trim();
  if (hex === '') return '';
  if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length % 2 !== 0) return hex;
  return Buffer.from(hex, 'hex').toString('utf16le').replace(/\u0000/g, '').normalize('NFC');
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
 * `sentinel` là mốc «từ đây trở xuống mới là dữ liệu», và nó tồn tại vì ba trong bốn nhánh chạy
 * SQL CỦA FILE: câu ấy in ra vài bộ kết quả phụ trước bộ ta cần (dòng tiêu đề báo cáo, tham số
 * lề in…). `sqlcmd -h -1` nối tất cả lại thành một khối, nên không cắt ở mốc thì mấy dòng phụ
 * thành mấy dòng dữ liệu đầu tiên — sai mà nhìn vẫn ra vẻ đúng.
 *
 * KHÔNG tìm thấy mốc thì giữ nguyên mọi dòng: câu lệnh có thể dừng giữa chừng, và mất hết dữ
 * liệu vì thiếu một dòng đánh dấu là đổi một lỗi nhỏ lấy một lỗi to.
 *
 * `columns`: `string[]` (nhãn) hoặc `{ label, textual }[]`. Khi `textAsHex`, cột chữ là hex
 * style 2 → giải Windows-1258 (varchar tiếng Việt FBO sống sót qua sqlcmd).
 *
 * @returns {Promise<{ok:true, rows:Array<Record<string,string>>} | {ok:false, reason:string}>}
 */
async function runSampleQuery(conn, sql, columns, {
  sqlcmdPath = null,
  timeoutMs = 10000,
  sentinel = null,
  textAsHex = false,
} = {}) {
  const result = await runSqlcmd(conn, sql, { sqlcmdPath, timeoutMs });
  if (!result.ok) return result;

  let raw = result.rows;
  if (sentinel) {
    const at = raw.findIndex((cells) => cells.length === 1 && cells[0] === sentinel);
    if (at !== -1) raw = raw.slice(at + 1);
  }

  const cols = (columns ?? []).map((c) => (typeof c === 'string'
    ? { label: c, textual: false }
    : { label: c.label, textual: c.textual === true }));

  const rows = raw.map((cells) => {
    const row = {};
    cols.forEach((col, i) => {
      const cell = cells[i];
      if (cell === undefined || cell === 'NULL') {
        row[col.label] = '';
        return;
      }
      row[col.label] = textAsHex && col.textual ? decodeHexCell(cell) : cell;
    });
    return row;
  });

  return { ok: true, rows };
}

/**
 * NHƯ `runSampleQuery`, nhưng khớp cột theo TÊN THẬT của resultset — dùng khi ta KHÔNG dựng
 * `select` bọc ngoài (báo cáo mà proc/câu tự in kết quả, xem `grid-sample.mjs:
 * buildResultsetSelect`), nên không biết trước resultset có cột gì, ở vị trí nào.
 *
 * Bật header của `sqlcmd` (`runSqlcmd({headers: true})`) thay vì `-h -1`: dòng NGAY SAU mốc
 * là TÊN CỘT thật, dòng kế — NẾU toàn dấu `-` — là gạch ngang trang trí của sqlcmd, bỏ qua; còn
 * lại là dữ liệu. Không giả định số dòng tiêu đề cố định: kiểm THẬT dòng thứ hai có phải toàn
 * gạch ngang không, phòng khi phiên bản sqlcmd khác không in dòng ấy.
 *
 * `wanted`: `{ name, label, textual }[]` — `name` là tên cột THẬT cần tìm trong header (khớp
 * không phân biệt hoa/thường, `rtrim` hai đầu), `label` là khoá gán vào object dòng kết quả
 * (giữ %l gốc — xem `grid-sample.mjs: pickColumns`). Field nào không thấy trong header thì vào
 * `skipped` — không đoán, không giữ một cột rỗng lặng lẽ.
 *
 * @returns {Promise<{ok:true, rows:Array<Record<string,string>>, skipped:string[]} | {ok:false, reason:string}>}
 */
/**
 * PHẦN THUẦN của `runSampleQueryNamed` — tách riêng để test được KHÔNG cần chạy `sqlcmd` thật.
 *
 * Nhận `raw` là mảng dòng ĐÃ TÁCH CỘT (`runSqlcmd` trả về), làm hai việc: (1) cắt bỏ mọi thứ
 * TRƯỚC mốc — resultset của các câu chạy trước bảng đã chọn; (2) đọc header + bỏ gạch ngang +
 * khớp `wanted` theo TÊN thay vì vị trí.
 */
function mapNamedRows(raw, wanted, sentinel) {
  let rows = raw;
  if (sentinel) {
    const at = rows.findIndex((cells) => cells.length === 1 && cells[0] === sentinel);
    if (at !== -1) rows = rows.slice(at + 1);
  }

  const header = rows[0] ?? [];
  const dashLine = rows[1] ?? [];
  const isDashLine = dashLine.length > 0 && dashLine.every((c) => /^-+$/.test(String(c ?? '').trim()));
  const data = rows.slice(isDashLine ? 2 : 1);

  const indexByName = new Map(header.map((name, i) => [String(name ?? '').trim().toLowerCase(), i]));
  const found = [];
  const skipped = [];
  for (const w of wanted) {
    const at = indexByName.get(String(w.name ?? w.label ?? '').trim().toLowerCase());
    if (at === undefined) skipped.push(w.label ?? w.name);
    else found.push({ ...w, at });
  }

  const mapped = data.map((cells) => {
    const row = {};
    for (const w of found) {
      const cell = cells[w.at];
      row[w.label ?? w.name] = (cell === undefined || cell === 'NULL') ? '' : cell;
    }
    return row;
  });

  return { rows: mapped, skipped };
}

async function runSampleQueryNamed(conn, sql, wanted, {
  sqlcmdPath = null,
  timeoutMs = 10000,
  sentinel = null,
} = {}) {
  const result = await runSqlcmd(conn, sql, { sqlcmdPath, timeoutMs, headers: true });
  if (!result.ok) return result;
  return { ok: true, ...mapNamedRows(result.rows, wanted, sentinel) };
}

/**
 * Cắt đúng đoạn nằm GIỮA mốc của bảng đã chọn và mốc KẾ TIẾP (hoặc hết luồng, nếu bảng đã chọn
 * là bảng cuối) — TÁCH RIÊNG để test được không cần chạy `sqlcmd` thật.
 *
 * `markers` là TOÀN BỘ danh sách mốc theo đúng thứ tự script sinh ra chúng (xem
 * `grid-sample.mjs: buildResultsetSelect`) — cần cả danh sách, không chỉ mốc của bảng đã chọn,
 * để nhận ra ĐÂU LÀ mốc KẾ TIẾP (ranh giới kết thúc đoạn cần lấy).
 */
/**
 * Tách RAW rows (đã bật header) thành TỪNG BẢNG — ranh giới là mỗi dòng TOÀN dấu gạch ngang.
 *
 * KHÔNG cần mốc nào chèn vào script: `sqlcmd` (bật header) tự in một dòng TÊN CỘT rồi một dòng
 * gạch ngang cho MỖI resultset nó trả về, kể cả khi hai resultset liên tiếp trùng hình dạng.
 * Tìm hết mọi dòng-gạch-ngang trước (không mập mờ vị trí), rồi với mỗi dòng ấy: dòng NGAY TRƯỚC
 * nó là tiêu đề, dữ liệu chạy từ ngay SAU nó tới ngay TRƯỚC dòng-gạch-ngang KẾ TIẾP (hay hết
 * luồng, nếu đây là bảng cuối).
 *
 * Rủi ro chấp nhận được: một ô dữ liệu CHỮ tình cờ toàn dấu `-` (ví dụ `"---"`) sẽ bị nhận nhầm
 * thành ranh giới — cùng đánh đổi `mapNamedRows` đã chấp nhận cho MỘT bảng, ở đây áp dụng cho
 * NHIỀU bảng.
 */
function splitResultsets(raw) {
  const dashAt = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (row.length > 0 && row.every((c) => /^-+$/.test(String(c ?? '').trim()))) dashAt.push(i);
  }
  return dashAt.map((at, k) => ({
    header: raw[at - 1] ?? [],
    data: raw.slice(at + 1, k + 1 < dashAt.length ? dashAt[k + 1] - 1 : raw.length),
  }));
}

/** Một BẢNG đã tách (`{header, data}`) → khớp `wanted` theo TÊN — phần chung với `mapNamedRows`. */
function mapSegment(segment, wanted) {
  const indexByName = new Map(segment.header.map((name, i) => [String(name ?? '').trim().toLowerCase(), i]));
  const found = [];
  const skipped = [];
  for (const w of wanted) {
    const at = indexByName.get(String(w.name ?? w.label ?? '').trim().toLowerCase());
    if (at === undefined) skipped.push(w.label ?? w.name);
    else found.push({ ...w, at });
  }
  const rows = segment.data.map((cells) => {
    const row = {};
    for (const w of found) {
      const cell = cells[w.at];
      row[w.label ?? w.name] = (cell === undefined || cell === 'NULL') ? '' : cell;
    }
    return row;
  });
  return { rows, skipped };
}

/**
 * Báo cáo KHÔNG `'#$query'` — chạy ĐỦ script, KHÔNG SỬA MỘT KÝ TỰ NÀO (không mốc, không bảng
 * tạm, không dò schema trước), rồi TẦNG VỎ tự đếm có bao nhiêu bảng THẬT SỰ trả về (`dir@id` là
 * chỉ số vào chính danh sách ấy, đúng cách ADO.NET đánh số `DataSet.Tables[N]` — CHỈ biết được
 * SAU KHI CHẠY, không phải trước). `targetIndex` là `null` khi Filter không khai `dir@id`, hay
 * một số nguyên khi có khai. Không khai, hay khai vượt quá số bảng thật có, thì lấy bảng CUỐI
 * CÙNG. Xem lý do đầy đủ ở `grid-sample.mjs: buildDirectResultsetSelect`.
 */
async function runSampleQueryDataset(conn, sql, targetIndex, wanted, {
  sqlcmdPath = null,
  timeoutMs = 10000,
} = {}) {
  const result = await runSqlcmd(conn, sql, { sqlcmdPath, timeoutMs, headers: true });
  if (!result.ok) return result;

  const segments = splitResultsets(result.rows);
  if (segments.length === 0) return { ok: true, rows: [], skipped: wanted.map((w) => w.label ?? w.name), tableCount: 0 };

  const inRange = Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < segments.length;
  const idx = inRange ? targetIndex : segments.length - 1;
  return {
    ok: true,
    tableCount: segments.length,
    tableIndex: idx,
    outOfRange: Number.isInteger(targetIndex) && !inRange,
    ...mapSegment(segments[idx], wanted),
  };
}

module.exports = {
  runSqlcmd,
  buildSqlcmdArgs,
  decodeSqlcmdRows,
  runSampleQuery,
  runSampleQueryNamed,
  runSampleQueryDataset,
  mapNamedRows,
  splitResultsets,
  resolveAppDatabase,
  resolveTargetConnection,
  existingColumns,
  stringColumnLength,
  readConnection,
  resolveSqlcmdPath,
};
