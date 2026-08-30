// sql-config.mjs — đọc/giải chuỗi kết nối SQL Server đọc từ `Web.config`, VÀ sinh câu SQL đọc
// (không bao giờ ghi) cho tầng vỏ chạy bằng `sqlcmd`. Thuần: nhận VĂN BẢN, trả VĂN BẢN/dữ liệu —
// không tự tìm file, không tự mở kết nối, cùng giao kèo với mọi file khác trong `core/`.
//
// LUẬT KHÔNG ĐƯỢC PHÁ: không hàm nào ở đây được phép nhận hay trả về giá trị rồi GHI nó vào một
// chỗ người khác đọc lại được (log, script SQL, thông báo) nếu giá trị đó là mật khẩu — mọi hàm
// trả `pwd` CHỈ để tầng vỏ truyền tiếp cho `sqlcmd` qua biến môi trường, không log lại.
//
// %Database — vì sao cần giải: `Web.config` của FBISP24 khai
//   appConnectionString = "Data Source=…;Initial Catalog=%Database;…"
// `%Database` là CHỖ GIỮ, không phải tên database thật — một `sys` phục vụ nhiều `app` (nhiều
// khách/tenant dùng chung server), và tên app database thật nằm ở CHÍNH DATABASE `sys`, bảng
// `entity`, cột `cdata`. Xác nhận của người dùng ngày 2026-08-28, đối chiếu khớp với
// DevWorkFlow (`DevWorkFlow.Infrastructure/Services/EntityRepository.cs` — câu SQL y hệt
// `ENTITY_APP_DATABASE_SQL` dưới đây; `DevWorkFlow.Application/Shell/AppConnectionResolver.cs`
// — DWF cũng mặc định lấy DÒNG ĐẦU khi tự chọn, giống chỉ dẫn của người dùng).
//
// Catalog tuỳ biến: `core/config/sql.json` (ENTITY_APP_DATABASE_SQL, kiểu dò độ dài…).

import { SQL_CONFIG } from './msg.mjs';

const IDENT = new RegExp(SQL_CONFIG.identPattern);

function assertIdent(name, what) {
  const s = String(name ?? '');
  if (!IDENT.test(s)) throw new Error(`${what} không hợp lệ để đưa vào SQL: "${s}"`);
  return s;
}

/**
 * Câu SQL lấy tên app database thật cho một `sys` — chạy trên database `sys`. `ORDER BY code`
 * khớp đúng thứ tự DWF dùng khi tự chọn database ĐẦU TIÊN (1 sys — nhiều app); tầng vỏ lấy dòng
 * đầu của kết quả làm mặc định, giống `AppConnectionResolver.ApplyAppDatabase`.
 */
export const ENTITY_APP_DATABASE_SQL = (SQL_CONFIG.entityAppDatabaseSql || []).join('\n');

/**
 * Chuỗi kết nối ADO.NET (`Data Source=…;Initial Catalog=…;Uid=…;Pwd=…`) → từng phần. Cùng thuật
 * toán với `AppConnectionResolver.TryGetDatabaseName`/`WebConfigReader` của DevWorkFlow: tách
 * `;`, tách `=` ĐẦU TIÊN của mỗi phần, khoá KHÔNG phân biệt hoa/thường, khoá trùng lấy giá trị
 * ĐẦU TIÊN (đứng trước trong chuỗi thắng).
 */
export function parseConnectionString(text) {
  const map = {};
  for (const part of String(text ?? '').split(';')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const value = trimmed.slice(eq + 1).trim();
    if (value === '' || key in map) continue;
    map[key] = value;
  }
  const pick = (...keys) => keys.map((k) => map[k.toLowerCase()]).find((v) => v !== undefined) ?? null;
  return {
    server: pick('Data Source', 'Server', 'Address', 'Addr', 'Network Address'),
    database: pick('Initial Catalog', 'Database'),
    uid: pick('Uid', 'User ID', 'User'),
    pwd: pick('Pwd', 'Password'),
  };
}

/**
 * Thay `%Database`/`%UserID` bằng giá trị thật — cùng cơ chế
 * `AppConnectionResolver.ReplacePlaceholders` của DevWorkFlow. Bỏ trống `database`/`userId` thì
 * giữ nguyên placeholder tương ứng (không thay bằng chuỗi rỗng — placeholder trống sai còn hơn
 * placeholder bị xoá mất dấu vết).
 */
export function resolvePlaceholders(connectionString, { database = null, userId = null } = {}) {
  let result = String(connectionString ?? '');
  if (database) result = result.replace(/%Database/gi, database);
  if (userId) result = result.replace(/%UserID/gi, userId);
  return result;
}

/** Tên cột đã có trên một bảng — bậc 1 của "field vừa thêm" (docs/IDEAS-FUTURE-TOOLS.md §2). */
export function existingColumnsSql(table) {
  const t = assertIdent(table, 'tên bảng');
  return `SET NOCOUNT ON;\nSELECT name FROM sys.columns WHERE object_id = OBJECT_ID('${t}');`;
}

/**
 * Độ dài cột chữ CÙNG TÊN đã tồn tại ở bảng khác — bậc 2 của "độ dài cột chữ"
 * (docs/IDEAS-FUTURE-TOOLS.md §2). Chỉ `varchar`/`char`: dự án dùng `varchar` cho cột chữ
 * (`filter-declare.mjs:528`), và `max_length` của hai kiểu đó tính bằng BYTE = đúng số ký tự,
 * không cần chia đôi như `nvarchar`/`nchar`. `DISTINCT` để tầng vỏ tự biết có mơ hồ (nhiều độ dài
 * khác nhau cho cùng tên field ở các bảng khác nhau) hay không — mơ hồ thì rơi xuống hỏi tay,
 * không tự chọn một trong các số đó.
 */
export function stringColumnLengthSql(fieldName) {
  const f = assertIdent(fieldName, 'tên field');
  const types = (SQL_CONFIG.stringLengthTypes || ['varchar', 'char'])
    .map((t) => `'${t}'`)
    .join(', ');
  return [
    'SET NOCOUNT ON;',
    'SELECT DISTINCT c.max_length',
    'FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id',
    `WHERE c.name = '${f}' AND t.name IN (${types}) AND c.max_length > 0`,
    'ORDER BY c.max_length;',
  ].join('\n');
}
