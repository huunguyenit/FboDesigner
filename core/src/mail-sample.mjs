// mail-sample.mjs — dựng SQL cho phép «Dữ liệu mẫu» của Email Designer: NSD gõ một `stt_rec` +
// `contactID` thật, công cụ chạy lại đúng ba câu `master`/`detail`/`footer` của
// `<action><query id="report">` (xem `mail-template.mjs#readMailReportCommands`) để lấy giá trị
// mẫu THẬT — thay cho JSON người dùng tự gõ tay (`mail-variables.mjs#parseMailSample`).
//
// ═══ VÌ SAO CẦN MỘT BƯỚC DÒ BẢNG TRƯỚC (`buildMailTableProbe`) ═══
//
// `command@id="master|footer"` và `command@id="detail"` đọc dữ liệu qua biến `@@table` — nhưng
// KHÔNG có bảng thật nào đứng sẵn ở đó để lấy: `action@table` trên chính Message.xml (khảo sát
// corpus thật, 2026-09-12) là một TIỀN TỐ chia kỳ còn thiếu số kỳ (`m91$000000` — sáu số `0` là
// chỗ giữ), và runtime gửi mail biết đúng kỳ vì nó đang cầm sẵn chứng từ. Xem trước ở đây ngược
// lại CHỈ có một `stt_rec` người dùng tự gõ, có thể thuộc kỳ bất kỳ trong quá khứ — không thể giả
// định "kỳ hiện tại" như `grid-sample.mjs#partitionPeriod` làm cho lưới (luật đó chỉ đúng cho một
// hàng BẤT KỲ của lưới, không đúng cho một CHỨNG TỪ CỤ THỂ).
//
// Nên phải dò đúng bảng bằng quy trình hệ thống mô tả (người dùng, 2026-09-12): `dmct9` cho biết
// mẫu tên bảng theo `ma_ct` (ba ký tự cuối của `stt_rec`) — cột `m$`/`c$`/`d$` là mẫu bảng
// master/bảng chỉ mục (không chia kỳ, có `ngay_ct` để tính kỳ)/bảng detail. Có kỳ thật rồi mới
// nối vào tiền tố `m$` ra được TÊN BẢNG THẬT.
//
// ĐỐI CHIẾU: đã grep toàn bộ DevWorkFlow (C#) — không có `dmxn`/`dmct9`/luồng này ở đó, nên đây
// KHÔNG phải luật có thể "đọc DWF rồi port" như những rule khác của repo này; quy trình sống
// trong chính script nghiệp vụ, không trong tầng UI. `buildMailTableProbe` dưới đây viết LẠI quy
// trình ấy bằng tham số buộc (`sp_executesql ... @p = @srec`) thay vì nối chuỗi ba lớp lồng nhau
// như bản gốc người dùng đưa — cùng hành vi, an toàn với `stt_rec` chứa dấu nháy, và không phải
// tính tay việc nhân đôi dấu nháy qua ba tầng chuỗi lồng (rất dễ sai, không cách nào chạy thử ở
// đây để biết chắc). Chưa chạy được trên database thật nào — cần người dùng xác nhận trước khi
// tầng vỏ (extension) nối vào lệnh có ghi dữ liệu thật.
//
// ═══ BƯỚC GHI (`buildMailSampleStub`) LÀ BƯỚC CÓ TÁC DỤNG PHỤ DUY NHẤT Ở ĐÂY ═══
//
// `master` join vào bảng `dmxn` (bảng đánh dấu "đã xem"/"đã nhắc") để lấy đủ dòng — chứng từ chưa
// từng gửi nhắc cho đúng `contactID` đó thì KHÔNG có dòng `dmxn` tương ứng, và một inner join thiếu
// dòng là toàn câu `master` trả về rỗng dù chứng từ có thật. `buildMailSampleStub` chèn một dòng
// giả (giá trị 'ZZZZZZ'/'YYYYYY' — nguyên văn từ mô tả gốc) để join luôn có dòng, rồi xoá dòng cũ
// (nếu có) trước khi chèn — KHÔNG dùng `merge`/`update` vì không biết trước có dòng nào chưa.
//
// Đây là câu lệnh DUY NHẤT trong core GHI vào một bảng của khách (khác toàn bộ phần còn lại của
// `grid-sample.mjs`/`mail-sample.mjs`, luôn chỉ đọc) — tầng vỏ PHẢI hỏi xác nhận trước khi chạy nó,
// cùng luật đã áp cho nhánh lưới báo cáo (`extension/src/sample-host.js`, mục 5 ở đầu file).

import { substituteParams, SAMPLE_SENTINEL } from './grid-sample.mjs';
import { assertIdent } from './sql-config.mjs';
import { readMailReportCommands } from './mail-template.mjs';
import { MAX_SAMPLE_ROWS } from './mail-variables.mjs';
import { formatNumber } from './format.mjs';

const PREAMBLE = [
  'SET NOCOUNT ON;',
  'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;',
];

/** Cùng luật tên biến của `parseMailSample` — cột SQL lạ (khoảng trắng, `%l`) bỏ qua. */
const SAMPLE_NAME_RE = /^[A-Za-z_]\w*$/;

/** `'abc'` — nháy đơn cho một mẩu SQL, nhân đôi nháy bên trong. Cùng quy tắc `grid-sample.mjs`,
 * lặp lại ở đây để không phải export thêm một hàm nội bộ của file đó. */
function quote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

/** `contactID` là `id` số của `userinfo2` — ép về số nguyên trần, `'0'` khi không đọc được (cùng
 * quy ước với nhánh số của `grid-sample.mjs#scriptParamLiteral`). KHÔNG nháy: cột so sánh là số. */
function contactLiteral(value) {
  const v = String(value ?? '').trim();
  return /^\d+$/.test(v) ? v : '0';
}

const sentinelSelect = () => `select ${quote(SAMPLE_SENTINEL)};`;

/**
 * Dòng đánh dấu tạm trong `dmxn` — GHI, cần xác nhận của người dùng trước khi tầng vỏ chạy (xem
 * chú thích đầu file). Idempotent: xoá dòng cũ (nếu người dùng bấm "Xem" nhiều lần cho cùng một
 * cặp stt_rec/contactID) rồi mới chèn.
 *
 * @param {{stt_rec:string, contactID:string|number}} opts
 * @returns {{sql:string}}
 */
export function buildMailSampleStub({ stt_rec, contactID }) {
  const rec = quote(stt_rec);
  const uid = contactLiteral(contactID);
  return {
    sql: [
      'SET NOCOUNT ON;',
      `delete dmxn where stt_rec = ${rec} and user_id = ${uid};`,
      `insert into dmxn select ${rec}, 'ZZZZZZ', 'YYYYYY', ${uid}, getdate();`,
    ].join('\n'),
  };
}

/**
 * Câu DÒ — CHỈ ĐỌC — trả về đúng một dòng `{ma_nt, mtable, dtable}` cho `stt_rec` đã cho, hoặc
 * KHÔNG dòng nào khi `stt_rec` không khớp một `ma_ct` nào trong `dmct9` (ba ký tự cuối `stt_rec`)
 * hay không tìm được chứng từ trong bảng chỉ mục tương ứng — cả hai ca tầng vỏ đều phải đọc là
 * "không dò được bảng", không phải lỗi.
 *
 * @param {{stt_rec:string}} opts
 * @returns {{sql:string}}
 */
export function buildMailTableProbe({ stt_rec }) {
  const rec = quote(stt_rec);
  return {
    sql: [
      ...PREAMBLE,
      sentinelSelect(),
      `declare @srec varchar(32) = ${rec};`,
      'declare @m varchar(8), @c varchar(64), @d varchar(32), @masterValue nvarchar(4000), @q nvarchar(1024), @ma_nt varchar(8);',
      'create table #t (ma_nt varchar(8), mtable varchar(32), dtable varchar(32));',
      "select @m = m$, @c = case when right(c$, 1) = '$' then c$ + '000000' else c$ end, @d = d$",
      '  from dmct9 where rtrim(ma_ct) = right(@srec, 3);',
      'if @m is not null',
      'begin',
      "  select @masterValue = '';",
      "  if right(@m, 1) = '$' select @masterValue = ' + convert(char(6), ngay_ct, 112)';",
      "  select @q = 'insert into #t(mtable) select ''' + @m + '''' + @masterValue + ' as mtable from ' + @c + ' where stt_rec = @p';",
      "  exec sp_executesql @q, N'@p varchar(32)', @p = @srec;",
      "  if right(@m, 1) = '$' update #t set dtable = replace(mtable, 'm', 'd') else update #t set dtable = @d;",
      '  select @q = null;',
      "  select @q = 'select @out = ma_nt from ' + mtable + ' where stt_rec = @p' from #t",
      "    where exists (select 1 from information_schema.columns c where c.table_name = #t.mtable and c.column_name = 'ma_nt');",
      '  if @q is not null',
      '  begin',
      "    exec sp_executesql @q, N'@p varchar(32), @out varchar(8) output', @p = @srec, @out = @ma_nt output;",
      "    update #t set ma_nt = isnull(@ma_nt, '');",
      '  end',
      'end',
      'select * from #t;',
      'drop table #t;',
    ].join('\n'),
  };
}

/**
 * Ba câu SELECT `master`/`detail`/`footer` của MỘT action, đã thay `@@table`/`@@contactID`/
 * `@@stt_rec` bằng giá trị thật — chạy SAU khi `buildMailTableProbe` đã cho biết `masterTable`/
 * `detailTable`.
 *
 * Thứ tự dựng mặc định: `master` → `footer` → `detail`. Tầng vỏ PHẢI chạy `master` trước, lấy
 * `d_language` làm `@@language`, rồi mới dựng/chạy `footer` và `detail` (nhiều câu detail/footer
 * trong corpus dùng `@@language`). Dùng `only: ['master']` rồi `only: ['footer','detail']` với
 * `params['@@language']` đã có.
 *
 * `@@table` của `master` VÀ `footer` dùng `masterTable`; của `detail` dùng `detailTable`.
 *
 * @param {string} clearText văn bản Message.xml ĐÃ bung entity
 * @param {object} opts
 *   `actionId`      id của action đang xem
 *   `stt_rec`       chứng từ người dùng gõ
 *   `contactID`     userID người dùng gõ
 *   `masterTable`   tên bảng master đã dò được (`buildMailTableProbe`)
 *   `detailTable`   tên bảng detail đã dò được
 *   `params`        đè/bổ sung biến `@@…` khác câu cần (ví dụ `@@sysDatabaseName`/`@@language`)
 *   `only`          danh sách id cần dựng (`master`|`footer`|`detail`); bỏ trống = cả ba theo thứ tự trên
 * @returns {{ok:true, commands:{master:{sql,table}|null, detail:{sql,table}|null, footer:{sql,table}|null}}
 *           |{ok:false, reason:string}}
 */
export function buildMailSampleSelect(clearText, {
  actionId, stt_rec, contactID, masterTable, detailTable, params = {}, only = null,
}) {
  const read = readMailReportCommands(clearText, actionId);
  if (!read.ok) return read;

  const base = {
    ...params,
    '@@contactID': contactLiteral(contactID),
    '@@stt_rec': quote(stt_rec),
  };

  const tableOf = { master: masterTable, footer: masterTable, detail: detailTable };
  // master trước (có d_language), footer cùng bảng master, detail sau cùng — khi đã có @@language.
  const ids = Array.isArray(only) && only.length > 0 ? only : ['master', 'footer', 'detail'];
  const commands = { master: null, detail: null, footer: null };
  for (const id of ids) {
    if (id !== 'master' && id !== 'detail' && id !== 'footer') {
      return { ok: false, reason: `only: id không hợp lệ "${id}"` };
    }
    const sql = read.commands[id];
    if (sql === null) { commands[id] = null; continue; }

    const table = assertIdent(String(tableOf[id] ?? '').trim(), `bảng ${id === 'detail' ? 'detail' : 'master'}`);
    const values = { ...base, '@@table': table };
    const { text, unknown } = substituteParams(sql, values);
    if (unknown.length > 0) {
      return { ok: false, reason: `command "${id}" của "${actionId}" còn biến chưa biết: ${unknown.join(', ')}` };
    }

    commands[id] = { sql: [...PREAMBLE, sentinelSelect(), text, ';'].join('\n'), table };
  }
  return { ok: true, commands };
}

/**
 * Gom dòng SQL `master` / `detail` / `footer` thành object dữ liệu mẫu mà
 * `parseMailSample` / `sampleValueOf` đã hiểu: trường header+footer ở đỉnh, dòng detail trong
 * mảng `detail`. Chỉ giữ tên cột hợp lệ (`\w+`); giá trị không phải scalar thì stringify.
 *
 * @param {{master?:object|null, detail?:object[], footer?:object|null}} parts
 * @returns {object}
 */
export function mailSampleFromRows({ master = null, detail = [], footer = null } = {}) {
  const pick = (row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return {};
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === 'detail' || !SAMPLE_NAME_RE.test(key)) continue;
      if (value === null || value === undefined) out[key] = '';
      else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
      else out[key] = String(value);
    }
    return out;
  };

  const top = { ...pick(master), ...pick(footer) };
  const detailRows = (Array.isArray(detail) ? detail : []).slice(0, MAX_SAMPLE_ROWS).map(pick);
  return detailRows.length > 0 ? { ...top, detail: detailRows } : top;
}

/**
 * Bảng format của report mail: hai cột `field` + `format` (không phân biệt hoa thường).
 * Tầng vỏ lấy BẢNG CUỐI của resultset detail/footer khi khớp hình này.
 */
export function isMailFormatTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const keys = Object.keys(rows[0]).map((k) => k.toLowerCase());
  return keys.includes('field') && keys.includes('format');
}

/** `{ field, format }[]` → Map tên cột → mặt nạ số. */
export function mailFormatMap(formatRows) {
  const map = new Map();
  for (const row of formatRows || []) {
    if (!row || typeof row !== 'object') continue;
    const field = String(row.field ?? row.Field ?? '').trim();
    const format = String(row.format ?? row.Format ?? '').trim();
    if (field && format) map.set(field, format);
  }
  return map;
}

/**
 * Áp mặt nạ số từ bảng format lên từng ô trùng tên cột. Không có mặt nạ / không phải số → giữ nguyên.
 */
export function applyMailFieldFormats(rows, formatMap) {
  if (!formatMap || formatMap.size === 0) return rows || [];
  return (rows || []).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const out = { ...row };
    for (const [field, mask] of formatMap) {
      if (!Object.hasOwn(out, field)) continue;
      const formatted = formatNumber(out[field], mask);
      if (formatted !== null) out[field] = formatted;
    }
    return out;
  });
}

/**
 * Câu đọc `{!in_words}` — `ma_nt` / ngôn ngữ là chuỗi, `t_tt_nt` là số trần.
 * @param {{ma_nt:string, t_tt_nt:string|number, language:string}} opts
 */
export function buildMailInWordsSelect({ ma_nt, t_tt_nt, language }) {
  const amount = Number(String(t_tt_nt ?? '').replace(/\s/g, '').replace(/,/g, ''));
  const amountLit = Number.isFinite(amount) ? String(amount) : '0';
  return {
    sql: [
      ...PREAMBLE,
      sentinelSelect(),
      `select dbo.FastBusiness$Function$System$ReadCurrency(${quote(ma_nt)}, ${amountLit}, ${quote(language)}) as in_words;`,
    ].join('\n'),
  };
}
