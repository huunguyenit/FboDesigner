// add-column.mjs — sinh script ADD COLUMN cho field vừa thêm vào controller mà cột chưa có
// trên database.
//
// LUẬT CỦA FILE NÀY (giống filter-declare.mjs): thuần, không chạm đĩa, không nối database. Nó
// nhận field/table/partition đã quét — và khi cần, danh sách cột đã có trên DB do tầng vỏ tự dò
// bằng `sys.columns` — rồi trả về SCRIPT. Dò DB, hỏi người dùng độ dài cột, mở file, chạy sqlcmd
// đều là việc của tầng vỏ, cùng giao kèo với mọi file khác trong `core/`.
//
// Ghi lại phần thảo luận ngày 2026-08-28 (đầy đủ ở `docs/IDEAS-FUTURE-TOOLS.md` §2):
//
//   field cần tạo cột    `external` vắng mặt hoặc `="false"` VÀ `aliasName` vắng mặt hoặc `="a"`.
//                        Field còn lại LÀ cột thật nhưng không thuộc bảng chính — `external="true"`
//                        là cột hiển thị qua join (luôn có hậu tố `%l`: `ten_tk_me%l` trong
//                        `Account.f`), `aliasName` khác `"a"` là bí danh tham số/join khác
//                        (`aliasName="fromDate"`, `"Period"`… trong nhiều `Dir/` của FBISP24).
//
//   độ dài cột chữ       `field@maxLength` CHỈ áp dụng cho cột `external` (xác nhận của người
//                        dùng ngày 2026-08-28) — KHÔNG dùng nó để suy độ dài varchar của cột bảng
//                        chính. Độ dài thật phải dò `sys.columns` cho cột cùng tên ở bảng khác
//                        (field hệ thống như `ma_kh` dùng lặp tên xuyên bảng), hoặc hỏi tay khi dò
//                        không ra — cả hai là việc của tầng vỏ; file này chỉ NHẬN kết quả qua
//                        `stringLengths`.
//
//   bảng chia kỳ THẬT    `<partition prime="…">` không đồng nghĩa "bảng chia kỳ". Đối chiếu toàn
//                        bộ FBISP24 (`Dir/`, `Grid/`): `prime` KẾT THÚC BẰNG `$` cộng `increase`
//                        khác rỗng (`dateadd(month, 1, {0})`) mới là bảng THẬT SỰ xoay theo kỳ —
//                        457/461 dòng `prime$` khớp cặp này. `prime` không kết thúc `$` (đã là tên
//                        bảng đủ như `bid02$000000`, hay bảng tĩnh `bigia01`, `pxdc`) là bảng TĨNH
//                        dù có thẻ `<partition>` — chạy script THƯỜNG như bảng không có thẻ này.
//                        Bốn ngoại lệ đo được (`hrca$`, `hrvaora$`, `kktt$` — prime kết thúc `$`
//                        nhưng thiếu `increase`) bị coi là bảng tĩnh; sai về phía này là script
//                        chạy được (một ALTER TABLE) chứ không phải một vòng lặp trên bảng có thể
//                        không tồn tại.

import { scanFields, scanRoot } from './spans.mjs';
import { scanPartition } from './filter-declare.mjs';

const IDENT = /^[A-Za-z_][\w$]*$/;

function assertIdent(name, what) {
  const s = String(name ?? '');
  if (!IDENT.test(s)) throw new Error(`${what} không hợp lệ để đưa vào SQL: "${s}"`);
  return s;
}

const SQL_TYPE_BY_FBO_TYPE = {
  datetime: 'smalldatetime',
  decimal: 'numeric(19,4)',
  boolean: 'bit',
};

function fboTypeOf(field) {
  return String(field?.attrs?.type ?? '').trim();
}

/** Field textbox (không khai `type`, hoặc `type="String"`) — kiểu SQL của nó là `varchar(N)`. */
function isStringField(field) {
  const t = fboTypeOf(field).toLowerCase();
  return t === '' || t === 'string';
}

/**
 * Field không phải cột bảng chính thì trả về LÝ DO (string); là cột bảng chính thì trả `null`.
 * Xem giải thích "field cần tạo cột" ở đầu file.
 */
export function mainTableExclusionReason(field) {
  const external = String(field?.attrs?.external ?? '').trim().toLowerCase();
  if (external === 'true') return 'external="true" — cột hiển thị qua join, không phải cột bảng chính';
  const alias = field?.attrs?.aliasName;
  if (alias !== undefined && String(alias).trim() !== 'a') {
    return `aliasName="${alias}" — không phải cột bảng chính (alias khác "a")`;
  }
  return null;
}

/**
 * Kiểu cột SQL cho một field. Cột chữ cần `stringLength` do tầng vỏ dò/hỏi truyền vào — xem
 * "độ dài cột chữ" ở đầu file. Không tự suy từ `field@maxLength`.
 */
export function sqlTypeOf(field, { stringLength = null } = {}) {
  const raw = fboTypeOf(field);
  const t = raw.toLowerCase();
  if (t in SQL_TYPE_BY_FBO_TYPE) return { ok: true, sql: SQL_TYPE_BY_FBO_TYPE[t] };
  if (isStringField(field)) {
    const n = Number(stringLength);
    if (!Number.isFinite(n) || n <= 0) {
      return { ok: false, reason: 'field kiểu chữ — cần độ dài cột (varchar(N)), N chưa xác định' };
    }
    return { ok: true, sql: `varchar(${Math.round(n)})` };
  }
  return { ok: false, reason: `chưa biết ánh xạ SQL cho type="${raw}"` };
}

/** Bảng có THẬT SỰ chia kỳ hay không — xem "bảng chia kỳ THẬT" ở đầu file. */
export function isRotatingPartition(partition) {
  if (!partition?.prime) return false;
  return /\$$/.test(partition.prime) && String(partition.increase ?? '').trim() !== '';
}

/**
 * Dò field nào cần tạo cột: field bảng chính (loại field ngoại/bí danh khác) mà chưa có ở
 * `existingColumns` — tên cột đã có trên bảng đích, do tầng vỏ dò bằng `sys.columns`. Bỏ trống
 * `existingColumns` thì coi MỌI field bảng chính là ứng viên (tầng vỏ tự lọc tiếp).
 *
 * @param {string} text   văn bản controller ĐÃ BUNG entity
 * @param {object} opts
 *   `fields`             mảng field của `scanFields`; bỏ trống thì tự quét từ `text`
 *   `existingColumns`    mảng/Set tên cột đã có trên bảng đích (không phân biệt hoa thường)
 */
export function planAddColumns(text, { fields = null, existingColumns = null } = {}) {
  const scanned = fields ?? scanFields(text);
  const root = scanRoot(text);
  const partition = scanPartition(text);
  const table = root.attrs?.table ?? null;
  const database = String(root.attrs?.database ?? '').trim() || 'app';

  const excluded = [];
  const mainTableFields = [];
  for (const field of scanned) {
    const reason = mainTableExclusionReason(field);
    if (reason) excluded.push({ name: field.name, reason });
    else mainTableFields.push(field);
  }

  const existing = existingColumns
    ? new Set([...existingColumns].map((c) => String(c).trim().toLowerCase()))
    : null;
  const candidates = existing
    ? mainTableFields.filter((f) => !existing.has(f.name.toLowerCase()))
    : mainTableFields;

  return {
    table,
    database,
    partition,
    rotating: isRotatingPartition(partition),
    excluded,
    mainTableFields,
    candidates,
  };
}

/**
 * Kiểu SQL cho từng field ứng viên. `stringLengths` = `{ [tên field]: N }`, do tầng vỏ dò/hỏi.
 * Field chưa có độ dài (hoặc chưa biết ánh xạ kiểu) vẫn có mặt trong kết quả với `ok:false` — để
 * tầng vỏ biết còn field nào phải hỏi tay trước khi sinh script.
 */
export function buildColumnDefs(fields, { stringLengths = {} } = {}) {
  return fields.map((field) => {
    const raw = fboTypeOf(field);
    const len = isStringField(field) ? Number(stringLengths[field.name]) : null;
    const res = sqlTypeOf(field, { stringLength: len });
    return { name: field.name, fboType: raw || 'string', ...res };
  });
}

/**
 * Chuỗi backfill cho DÒNG CŨ sau `ALTER TABLE … ADD` (mặc định NULL vì không có DEFAULT). Cột
 * chữ/số/bit backfill về giá trị "rỗng" của kiểu đó, giống mẫu người dùng đưa (`CHAR(2)` →
 * `''`). Cột NGÀY (`smalldatetime`) KHÔNG backfill — bịa một ngày giả cho dòng cũ sai hơn hẳn để
 * NULL, cùng lý do `filter-declare.mjs` không bọc cột ngày qua `isnull()`.
 */
function backfillLiteral(sqlType) {
  if (/^varchar/i.test(sqlType)) return "''";
  if (/^bit$/i.test(sqlType)) return '0';
  if (/^numeric/i.test(sqlType)) return '0';
  return null;
}

/**
 * TEMPLATE MẶC ĐỊNH cho bảng chia kỳ thật — nguyên văn cấu trúc người dùng đưa ngày 2026-08-28,
 * tổng quát hoá bằng placeholder `{{...}}`. Đúng yêu cầu "script này phải tuỳ chỉnh được": tầng
 * vỏ có thể truyền một `template` khác vào `renderAddColumnSql` (đọc từ file người dùng tự sửa)
 * thay vì hằng số này — hàm chỉ điền tham số, không hard-code cấu trúc script.
 *
 * Placeholder:
 *   {{primeMaster}}     bảng master kỳ gốc, VD "m81$000000" — dùng để kiểm cột đã tồn tại chưa
 *   {{primePattern}}    chỗ giữ chia kỳ, VD "m81$%Partition" — cho FastBusiness$Partition$Execute
 *   {{partitionField}}  cột kỳ (`partition@field`, VD "ngay_ct")
 *   {{column}}          tên cột mới
 *   {{sqlType}}         kiểu SQL của cột mới
 *   {{backfill}}        biểu thức backfill dòng cũ; "NULL" nếu không backfill (cột ngày)
 */
export const DEFAULT_PARTITION_TEMPLATE = [
  'DECLARE @ngay_ct1 smalldatetime, @ngay_ct2 smalldatetime',
  'SELECT @ngay_ct1 = ngay_gh1, @ngay_ct2 = ngay_gh2 from dmstt',
  '',
  "IF NOT EXISTS(SELECT 1 FROM syscolumns WHERE id IN (SELECT id FROM sysobjects WHERE name = '{{primeMaster}}') AND name = '{{column}}')",
  'BEGIN',
  '\tALTER TABLE {{primeMaster}} ADD {{column}} {{sqlType}}',
  '\tDECLARE @strsql NVARCHAR(4000)',
  "\tSET @strsql = 'alter table {{primePattern}} add {{column}} {{sqlType}}'",
  "\tEXEC FastBusiness$Partition$Execute @strsql, '', '{{partitionField}}', @ngay_ct1, @ngay_ct2, 1, 1",
  "\tSET @strsql = 'update {{primePattern}} set {{column}} = {{backfill}} where %[{{column}} is null]%'",
  "\tEXEC FastBusiness$Partition$Execute @strsql, '', '{{partitionField}}', @ngay_ct1, @ngay_ct2, 1, 1",
  'END',
].join('\n');

function applyTemplate(template, vars) {
  return String(template).replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (!(key in vars)) throw new Error(`template thiếu giá trị cho placeholder {{${key}}}`);
    return vars[key];
  });
}

function renderRotatingAlter(defs, { partition, template, sourceFile }) {
  const prime = assertIdent(partition.prime, 'partition@prime');
  const primeMaster = `${prime}000000`;
  const primePattern = partition.primeTable ?? `${prime}%Partition`;
  const partitionField = partition.field || 'ngay_ct';

  const head = [
    `-- add column — bảng chia kỳ "${prime}" (field kỳ: ${partitionField})`,
    sourceFile ? `-- sinh từ: ${sourceFile}` : null,
    '-- sinh bởi FBO Designer từ TEMPLATE tuỳ chỉnh được — xem DEFAULT_PARTITION_TEMPLATE.',
    '-- ĐỌC LẠI TRƯỚC KHI CHẠY.',
  ].filter((l) => l !== null);

  const body = defs.map((d) => {
    const column = assertIdent(d.name, 'tên cột');
    const backfill = backfillLiteral(d.sql) ?? 'NULL';
    return applyTemplate(template, {
      primeMaster, primePattern, partitionField, column, sqlType: d.sql, backfill,
    });
  });

  return [head.join('\n'), '', body.join('\n\n'), ''].join('\n');
}

function renderPlainAlter(defs, { table, sourceFile }) {
  const t = assertIdent(table, 'tên bảng');
  const head = [
    `-- add column — bảng "${t}"`,
    sourceFile ? `-- sinh từ: ${sourceFile}` : null,
    '-- sinh bởi FBO Designer. ĐỌC LẠI TRƯỚC KHI CHẠY.',
  ].filter((l) => l !== null);

  const body = defs.map((d) => {
    const column = assertIdent(d.name, 'tên cột');
    return [
      `IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('${t}') AND name = '${column}')`,
      `  ALTER TABLE ${t} ADD ${column} ${d.sql};`,
    ].join('\n');
  });

  return [head.join('\n'), '', body.join('\n\n'), ''].join('\n');
}

/**
 * Script ADD COLUMN cho danh sách cột đã xác định kiểu (`buildColumnDefs`, mọi phần tử phải
 * `ok:true` — ném lỗi nếu còn phần tử chưa xác định được kiểu, đây là lỗi gọi sai thứ tự, không
 * phải trường hợp cần đoán ý). Bảng chia kỳ THẬT (`isRotatingPartition`) đi template chia kỳ tuỳ
 * chỉnh được; còn lại — kể cả có thẻ `<partition>` nhưng là bảng tĩnh — đi một khối
 * `IF NOT EXISTS … ALTER TABLE … ADD …` mỗi cột.
 */
export function renderAddColumnSql(defs, {
  table = null,
  partition = null,
  sourceFile = '',
  template = DEFAULT_PARTITION_TEMPLATE,
} = {}) {
  if (defs.length === 0) return '';
  const bad = defs.filter((d) => !d.ok);
  if (bad.length > 0) {
    throw new Error(
      `còn ${bad.length} cột chưa xác định được kiểu SQL: ${bad.map((d) => `${d.name} (${d.reason})`).join('; ')}`,
    );
  }

  if (isRotatingPartition(partition)) return renderRotatingAlter(defs, { partition, template, sourceFile });

  const targetTable = partition?.table || table;
  if (!targetTable) throw new Error('không xác định được tên bảng đích (root@table và partition@table đều trống)');
  return renderPlainAlter(defs, { table: targetTable, sourceFile });
}
