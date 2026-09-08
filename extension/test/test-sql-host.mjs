// test-sql-host.mjs — phần THUẦN của sql-host.js (không chạy `sqlcmd` thật).
//
// `runSqlcmd`/`runSampleQuery`/`runSampleQueryNamed` gọi tiến trình con — không test được bằng
// node trần mà không có một máy có `sqlcmd` trên PATH. `mapNamedRows` là phần LOGIC của
// `runSampleQueryNamed` tách riêng ra đúng vì lý do đó: nhận mảng dòng ĐÃ TÁCH CỘT (hình dạng
// `runSqlcmd` trả về), không đụng gì tới tiến trình con.

import { createRequire } from 'node:module';
import { ok, eq, section } from '../../core/test/harness.mjs';

const require_ = createRequire(import.meta.url);
const { mapNamedRows } = require_('../src/sql-host.js');

const SENTINEL = '~fbo-sample~';

section('sql-host — mapNamedRows: cắt bỏ mọi thứ trước mốc');

const before = [
  ['2026-01-08', '2026-09-08'], // resultset của câu debug đứng trước — KHÔNG phải dữ liệu
  [SENTINEL],
  ['stt', 'ma_kh'], // header
  ['-----------', '-----------'], // gạch ngang trang trí của sqlcmd
  ['1', 'KH01'],
  ['2', 'KH02'],
];
const r1 = mapNamedRows(before, [{ name: 'stt' }, { name: 'ma_kh' }], SENTINEL);
eq('bỏ hết dòng trước mốc', r1.rows, [{ stt: '1', ma_kh: 'KH01' }, { stt: '2', ma_kh: 'KH02' }]);
eq('không cột nào bị bỏ', r1.skipped, []);

section('sql-host — mapNamedRows: khớp theo TÊN, không theo vị trí');

/*
 * resultset THẬT trả nhiều cột hơn lưới cần (`sl_ton`), và ĐẢO thứ tự so với field khai trong
 * lưới (`ma_kh` đứng trước `stt`) — khớp theo vị trí sẽ lấy nhầm cột; khớp theo tên thì không.
 */
const reordered = [
  [SENTINEL],
  ['ma_kh', 'sl_ton', 'stt'],
  ['----', '----', '----'],
  ['KH01', '99', '1'],
];
const r2 = mapNamedRows(reordered, [{ name: 'stt' }, { name: 'ma_kh' }], SENTINEL);
eq('lấy đúng giá trị dù resultset đảo thứ tự cột', r2.rows, [{ stt: '1', ma_kh: 'KH01' }]);
ok('cột thừa của resultset (sl_ton) KHÔNG lọt vào — lưới không khai nó', !('sl_ton' in r2.rows[0]));

/* Khớp không phân biệt hoa/thường, và bỏ khoảng trắng thừa hai đầu tên cột. */
const caseInsensitive = [[SENTINEL], [' MA_KH ', 'Stt'], ['----', '----'], ['KH02', '3']];
const r3 = mapNamedRows(caseInsensitive, [{ name: 'stt' }, { name: 'ma_kh' }], SENTINEL);
eq('khớp không phân biệt hoa/thường', r3.rows, [{ stt: '3', ma_kh: 'KH02' }]);

section('sql-host — mapNamedRows: field không có cột trùng tên thì BỎ, không đoán');

const missing = [[SENTINEL], ['stt'], ['----'], ['1']];
const r4 = mapNamedRows(missing, [{ name: 'stt' }, { name: 'ma_kh', label: 'ma_kh%l' }], SENTINEL);
eq('chỉ giữ cột thật sự có', r4.rows, [{ stt: '1' }]);
/* `label` (nhãn hiển thị, có thể mang %l) — KHÔNG `name` (tên cột dùng để khớp) — vào `skipped`. */
eq('skipped dùng label khi có, không phải name', r4.skipped, ['ma_kh%l']);

section('sql-host — mapNamedRows: không có dòng gạch ngang (một số phiên bản sqlcmd không in)');

const noDash = [[SENTINEL], ['stt', 'ma_kh'], ['1', 'KH01']];
const r5 = mapNamedRows(noDash, [{ name: 'stt' }, { name: 'ma_kh' }], SENTINEL);
ok('không đoán nhầm dòng dữ liệu đầu tiên là gạch ngang',
  r5.rows.length === 1 && r5.rows[0].stt === '1' && r5.rows[0].ma_kh === 'KH01');

section('sql-host — mapNamedRows: NULL và ô trống');

const withNull = [[SENTINEL], ['stt', 'ma_kh'], ['----', '----'], ['1', 'NULL']];
const r6 = mapNamedRows(withNull, [{ name: 'stt' }, { name: 'ma_kh' }], SENTINEL);
eq('NULL của SQL Server thành chuỗi rỗng', r6.rows, [{ stt: '1', ma_kh: '' }]);

section('sql-host — mapNamedRows: không mốc thì đọc từ dòng đầu');

const noSentinel = [['stt', 'ma_kh'], ['----', '----'], ['1', 'KH01']];
const r7 = mapNamedRows(noSentinel, [{ name: 'stt' }, { name: 'ma_kh' }], null);
eq('không mốc: coi dòng đầu là header', r7.rows, [{ stt: '1', ma_kh: 'KH01' }]);
