// test-sql-host-exec.mjs — cách `runSqlcmd` GỌI tiến trình con: đối số dòng lệnh (`buildSqlcmdArgs`)
// và cách đọc lại file kết quả (`decodeSqlcmdRows`). Đây là phần TÁCH RIÊNG để test được không cần
// một `sqlcmd` thật (chuỗi giả `node:child_process` không đáng tin: builtin của Node không đi qua
// `Module._load`, nên không chặn được `execFile` thật bằng cách ấy).
//
// BA LẦN đo trên `zc_rptPurchaseDiscount` của HOATP qua MCP (2026-09-08), ba kết luận:
//   1. `-Q "<query>"` (câu lệnh qua ARGV) + đọc `stdout` bằng `latin1` — tiếng Việt ra `?`.
//   2. Đổi sang `-i <file UTF-8>` (bỏ `-Q`) nhưng VẪN đọc qua `stdout` của `execFile` — vẫn `?`.
//   3. `execFile` cho `stdout` là một PIPE, không phải console/TTY thật — `-f 65001` không áp
//      dụng cho phía GHI qua pipe. Ghi kết quả ra một FILE THẬT bằng `-o <file>` thì `-f` mới áp
//      dụng cho CẢ HAI chiều I/O qua file — đúng dấu, đúng cách `run_sql_script` của MCP đã làm.

import { createRequire } from 'node:module';
import { ok, eq, section } from '../../core/test/harness.mjs';

const require_ = createRequire(import.meta.url);
const { buildSqlcmdArgs, decodeSqlcmdRows } = require_('../src/sql-host.js');

/** Dòng tiếng Việt y hệt HOATP trả về đúng dấu qua MCP khi đọc trực tiếp, không hex. */
const VIETNAMESE = 'Trần Ái Quyết';
/** Đúng ký tự phân cách cột mà sql-host.js dùng nội bộ (hằng `SEP`). */
const SEP = String.fromCharCode(31);
/** BOM UTF-8 — `sqlcmd` tự ghi kèm ở đầu file `-o` khi dùng `-f 65001`. */
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

section('sql-host — buildSqlcmdArgs: -i/-o (file), KHÔNG -Q (argv/stdout)');

const conn = { server: 'S', database: 'D' };
const args = buildSqlcmdArgs(conn, 'C:\\temp\\in.sql', 'C:\\temp\\out.txt', {});

ok('KHÔNG dùng -Q (đường ARGV từng làm mất dấu tiếng Việt)', !args.includes('-Q'));
ok('dùng -i kèm đúng đường dẫn file input', args.includes('-i') && args[args.indexOf('-i') + 1] === 'C:\\temp\\in.sql');
ok('dùng -o kèm đúng đường dẫn file output (không đọc stdout qua pipe nữa)',
  args.includes('-o') && args[args.indexOf('-o') + 1] === 'C:\\temp\\out.txt');
ok('dùng -f 65001 (UTF-8 cả hai chiều I/O qua file)', args.includes('-f') && args[args.indexOf('-f') + 1] === '65001');
ok('mặc định tắt tiêu đề (-h -1)', args.includes('-h') && args[args.indexOf('-h') + 1] === '-1');
ok('có -d đúng tên database', args.includes('-d') && args[args.indexOf('-d') + 1] === 'D');
ok('không uid/pwd thì -E (Windows auth)', args.includes('-E'));

section('sql-host — buildSqlcmdArgs: headers bật thì bỏ -h -1');

const withHeaders = buildSqlcmdArgs(conn, 'i.sql', 'o.txt', { headers: true });
ok('KHÔNG còn -h -1 khi headers bật', !withHeaders.includes('-h'));

section('sql-host — buildSqlcmdArgs: có uid/pwd thì -U, không phải -E');

const sqlAuth = buildSqlcmdArgs({ server: 'S', uid: 'sa', pwd: 'x' }, 'i.sql', 'o.txt', {});
ok('dùng -U kèm tên đăng nhập', sqlAuth.includes('-U') && sqlAuth[sqlAuth.indexOf('-U') + 1] === 'sa');
ok('không còn -E', !sqlAuth.includes('-E'));

section('sql-host — decodeSqlcmdRows: đọc UTF-8, tiếng Việt còn nguyên dấu');

const line1 = ['stt', 'ten_kh'].join(SEP);
const line2 = ['1', VIETNAMESE].join(SEP);
const fileContent = Buffer.concat([BOM, Buffer.from(`${line1}\r\n${line2}\r\n`, 'utf8')]);
const rows = decodeSqlcmdRows(fileContent);

eq('hai dòng, đúng số cột', rows.length, 2);
eq('dòng dữ liệu giữ nguyên dấu tiếng Việt (không phải "Tr?n ?i Quy?t")', rows[1], ['1', VIETNAMESE]);

section('sql-host — decodeSqlcmdRows: bỏ BOM ở đầu file (sqlcmd tự ghi kèm khi -f 65001)');

const noBom = decodeSqlcmdRows(Buffer.from(`${line1}\r\n${line2}\r\n`, 'utf8'));
eq('không có BOM vẫn đọc đúng — không lẫn BOM vào ô đầu tiên', noBom[0][0], 'stt');

section('sql-host — decodeSqlcmdRows: bỏ dòng trắng, cắt khoảng trắng cuối dòng');

const withBlanks = Buffer.concat([BOM, Buffer.from(`${line1}   \r\n\r\n${line2}\r\n\r\n`, 'utf8')]);
eq('bỏ hết dòng trắng, giữ đúng hai dòng có dữ liệu', decodeSqlcmdRows(withBlanks).length, 2);
