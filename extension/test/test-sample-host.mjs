// test-sample-host.mjs — lệnh «Xem dữ liệu thật trên lưới», từ lúc bấm phím tới lúc dữ liệu
// nằm trong kho.
//
// Core đã kiểm CÂU LỆNH dựng ra (`core/test/test-grid-sample.mjs`). Cái chưa ai kiểm là LUỒNG:
// nối database trước hay sau, tên database có tới được câu lệnh không, lưới báo cáo có hỏi tham
// số rồi mới chạy không, và người dùng có được hỏi trước khi một stored procedure của khách
// chạy thật không.
//
// Toàn bộ đó không cần một cửa sổ editor nào, mà lại là chỗ dễ sai nhất — và sai ở đây thì mọi
// test khác vẫn xanh.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ok, eq, section } from '../../core/test/harness.mjs';
import * as fakeVscode from './fake-vscode.mjs';

const require_ = createRequire(import.meta.url);
const Module = require_('node:module');

/*
 * `sql-host` bị THAY, không chỉ `vscode`.
 *
 * Đây là file duy nhất của extension chạy SQL trên database của khách; một bộ test gọi tới
 * `sqlcmd` thật là một bộ test không chạy được trên máy không có mạng nội bộ, và tệ hơn: một bộ
 * test có thể đọc dữ liệu thật. Bản giả ghi lại câu lệnh nhận được — đó chính là điểm quan sát
 * duy nhất chứng minh biến `@@…` đã được thay đúng trước khi lệnh chạy.
 */
const sqlHost = {
  ran: [],
  conn: { server: 'S', database: 'fboapp' },
  sysConn: { server: 'S', database: 'fbosys' },
  rows: [],
  reset() {
    sqlHost.ran = [];
    sqlHost.rows = [];
    sqlHost.datasetSkipped = [];
    sqlHost.datasetTableCount = undefined;
    sqlHost.datasetTableIndex = undefined;
    sqlHost.datasetOutOfRange = false;
  },
  async resolveTargetConnection() { return { ok: true, conn: sqlHost.conn }; },
  readConnection(_core, _root, name) { return name === 'sysConnectionString' ? sqlHost.sysConn : sqlHost.conn; },
  async runSampleQuery(conn, sql, labels, opts) {
    sqlHost.ran.push({ sql, labels, opts });
    return { ok: true, rows: sqlHost.rows };
  },
  // Báo cáo không '#$query' — chạy đủ script (không sửa một ký tự nào), tự đếm bảng thật sự trả
  // về rồi cắt đúng bảng `dir@id`, khớp theo tên. Bản giả không thật sự tách theo dash-line (đó
  // là việc của `sql-host.js: splitResultsets`, đã kiểm ở `test-sql-host.mjs`) — nó chỉ echo
  // `sqlHost.rows`, đúng ranh giới trách nhiệm của một test tầng luồng (có chạy đủ câu, có gọi
  // đúng hàm với đúng chỉ số, có nhận đúng cột) so với tầng logic.
  datasetSkipped: [],
  datasetTableCount: undefined,
  datasetTableIndex: undefined,
  datasetOutOfRange: false,
  async runSampleQueryDataset(conn, sql, targetIndex, wanted, opts) {
    sqlHost.ran.push({
      sql, targetIndex, wanted, opts, dataset: true,
    });
    return {
      ok: true,
      rows: sqlHost.rows,
      skipped: sqlHost.datasetSkipped,
      ...(sqlHost.datasetTableCount === undefined ? {} : { tableCount: sqlHost.datasetTableCount }),
      ...(sqlHost.datasetTableIndex === undefined ? {} : { tableIndex: sqlHost.datasetTableIndex }),
      outOfRange: sqlHost.datasetOutOfRange,
    };
  },
};

/*
 * Hộp thoại của extension (`dialog/`) cũng bị THAY. Bản thật gọi `createWebviewPanel` — không có
 * cửa sổ nào ở đây, và điều đáng kiểm cũng không phải HTML nó vẽ ra: là NÓ CÓ ĐƯỢC MỞ KHÔNG, mở
 * với những ô nào, và giá trị người dùng gõ có tới được câu lệnh không.
 */
const fakeDialog = {
  shown: [],
  answer: null, // { action, values } — `null` = người dùng huỷ
  reset() { fakeDialog.shown = []; fakeDialog.answer = null; },
  async show(options) {
    fakeDialog.shown.push(options);
    return fakeDialog.answer ?? { action: 'cancel' };
  },
  fields() {
    const body = fakeDialog.shown.at(-1)?.body ?? [];
    return body.filter((b) => b.type === 'field');
  },
};

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'vscode') return fakeVscode;
  if (request === './sql-host') return sqlHost;
  if (request === './dialog/dialog-service') return { dialogs: () => fakeDialog };
  return originalLoad.call(this, request, ...rest);
};

const { previewData, autoLoadSample } = require_('../src/sample-host.js');
const store = require_('../src/sample-store.js');
const core = await import('../../core/src/index.mjs');

/* ── một program thật trên đĩa: `sample-host` suy đường dẫn Filter từ đường dẫn Grid ────────── */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-sample-host-'));
const controllers = path.join(tmp, 'App_Data', 'Controllers');
fs.mkdirSync(path.join(controllers, 'Grid'), { recursive: true });
fs.mkdirSync(path.join(controllers, 'Filter'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'Web.config'), '<configuration/>', 'utf8');

const NL = '\r\n';
const write = (rel, lines) => {
  const file = path.join(controllers, rel);
  fs.writeFileSync(file, lines.join(NL), 'utf8');
  return file;
};

const CATALOG = write('Grid/Customer.xml', [
  '<grid table="dmkh" code="ma_kh" order="ma_kh" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="ma_kh" width="80"><header v="Ma" e="Code"/></field>',
  '    <field name="ten_kh%l" width="200"><header v="Ten" e="Name"/></field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="ma_kh"/><field name="ten_kh%l"/></view></views>',
  '</grid>',
]);

const REPORT = write('Grid/rptStock.xml', [
  '<grid type="Report" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="ma_vt" width="80"><header v="VT" e="Item"/></field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="ma_vt"/></view></views>',
  '</grid>',
]);

write('Filter/rptStock.xml', [
  '<dir id="1" type="Report" xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields>',
  '    <field name="ma_kho"><header v="Mã kho" e="Site"/></field>',
  // Không khai dataFormatString: mặc định dd/MM/yyyy, giống Options.xml của gần hết chương
  // trình FBISP24 khai @datetimeFormat.
  '    <field name="ngay" type="DateTime" clientDefault="2026-09-08"><header v="Ngày" e="Date"/></field>',
  '  </fields>',
  '  <commands><command event="Processing"><text><![CDATA[',
  "exec rs_rptStock @ma_kho, @ngay, @@userID, '@@sysDatabaseName', '#$query'",
  ']]></text></command></commands>',
  '</dir>',
]);

const REPORT_DIRECT = write('Grid/zcrptPurchaseDiscount.xml', [
  '<grid type="Report" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="stt" type="Decimal" width="60"><header v="STT" e="No"/></field>',
  '    <field name="ma_kh" width="100"><header v="KH" e="Customer"/></field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="stt"/><field name="ma_kh"/></view></views>',
  '</grid>',
]);

write('Filter/zcrptPurchaseDiscount.xml', [
  '<dir id="1" type="Report" xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields>',
  '    <field name="tu_ngay" type="DateTime" clientDefault="2026-01-08"><header v="Từ ngày" e="From"/></field>',
  '    <field name="den_ngay" type="DateTime" clientDefault="2026-09-08"><header v="Đến ngày" e="To"/></field>',
  '    <field name="ma_kh"><header v="Khách hàng" e="Customer"/></field>',
  '    <field name="ma_dvcs"><header v="Đơn vị" e="Site"/></field>',
  '  </fields>',
  '  <commands><command event="Processing"><text><![CDATA[',
  'select @tu_ngay as tu_ngay, @den_ngay as den_ngay',
  "exec zc_rptPurchaseDiscount @tu_ngay, @den_ngay, @ma_kh, @ma_dvcs, 1, 1, 1, 'HOATP_FBISP2421_S'",
  ']]></text></command></commands>',
  '</dir>',
]);

const DETAIL = write('Grid/PN1Detail.xml', [
  '<grid table="d64$000000" code="stt_rec" order="stt_rec, line_nbr" type="Detail" xmlns="urn:schemas-fast-com:data-grid">',
  '  <partition table="c64$000000" prime="d64$" inquiry="i64$" field="ngay_ct" default="000000"/>',
  '  <fields>',
  '    <field name="ma_vt" width="80"><header v="VT" e="Item"/></field>',
  '  </fields>',
  '  <queries><query event="Loading"><text><![CDATA[',
  'select @@fieldExternal from @@prime$partition$current a where @@whereClause order by @@orderByClause',
  ']]></text></query></queries>',
  '  <views><view id="Grid"><field name="ma_vt"/></view></views>',
  '</grid>',
]);

/*
 * Câu Loading đòi thẳng `@stt_rec` — CÙNG tên với `grid@code` — thay vì đi qua `@@whereClause`.
 * Đây là ca "6 lưới chi tiết của FBISP24" mà `askScriptParams` từng phải hỏi tay.
 */
const DETAIL_NEEDS_KEY = write('Grid/PN1SubDetail.xml', [
  '<grid table="d65$000000" code="stt_rec" order="stt_rec" type="Detail" xmlns="urn:schemas-fast-com:data-grid">',
  '  <partition table="c65$000000" prime="d65$" inquiry="i65$" field="ngay_ct" default="000000"/>',
  '  <fields>',
  '    <field name="ma_vt" width="80"><header v="VT" e="Item"/></field>',
  '  </fields>',
  '  <queries><query event="Loading"><text><![CDATA[',
  'select @@fieldExternal from @@prime$partition$current a where a.stt_rec = @stt_rec order by @@orderByClause',
  ']]></text></query></queries>',
  '  <views><view id="Grid"><field name="ma_vt"/></view></views>',
  '</grid>',
]);

function open(file) {
  const text = fs.readFileSync(file, 'utf8');
  fakeVscode.window.activeTextEditor = {
    document: {
      uri: { scheme: 'file', fsPath: file },
      fileName: file,
      languageId: 'xml',
      getText: () => text,
      encoding: 'utf8',
      eol: fakeVscode.EndOfLine.CRLF,
    },
  };
  return file;
}

const output = { lines: [], appendLine(l) { this.lines.push(l); } };
const run = () => previewData(core, output);
function reset() {
  store.clearAll();
  sqlHost.reset();
  fakeVscode.window.reset();
  fakeDialog.reset();
  output.lines = [];
}
const lastSql = () => sqlHost.ran.at(-1)?.sql ?? '';

/* ═════════════════════════════════════════════════════════════════════════
 * DANH MỤC — nhánh chạy thẳng, không hỏi gì
 * ═════════════════════════════════════════════════════════════════════════ */
section('sample-host — lưới danh mục chạy thẳng');

reset();
open(CATALOG);
sqlHost.rows = [{ ma_kh: 'KH01', 'ten_kh%l': 'Công ty A' }, { ma_kh: 'KH02', 'ten_kh%l': 'B' }];
await run();

eq('đã chạy đúng một câu lệnh', sqlHost.ran.length, 1);
ok('câu lệnh đọc đúng bảng', lastSql().includes('from dmkh'));
ok('KHÔNG hỏi gì cả', fakeVscode.window.asked.quickPick.length === 0 && fakeVscode.window.asked.inputBox.length === 0);
ok('cắt kết quả ở mốc', sqlHost.ran[0].opts.sentinel === core.SAMPLE_SENTINEL);

/*
 * Nhãn cột giữ NGUYÊN VĂN tên khai (`ten_kh%l`) dù câu SQL dùng tên đã phân giải (`ten_kh`).
 * `renderGridHtml` tra ô theo `field@name`; đổi nhãn sang tên đã phân giải là cả cột im lặng
 * rỗng — hỏng mà không có lỗi nào để lần ra.
 */
eq('nhãn cột là tên khai', sqlHost.ran[0].labels.map((c) => c.label ?? c), ['ma_kh', 'ten_kh%l']);
ok('cột chữ đi hex', sqlHost.ran[0].opts.textAsHex === true
  && sqlHost.ran[0].labels.every((c) => c.textual === true));

const stored = store.getSample(CATALOG);
ok('dữ liệu vào kho', stored !== null && stored.rows.length === 2);
eq('kiểu lưới ghi lại', stored.kind, 'catalog');
ok('giữ nguyên giá trị SQL (không che)', stored.masked === false && stored.rows[0]['ten_kh%l'] === 'Công ty A');

// Bấm lần thứ hai là TẮT. Một phím tắt bật/tắt dễ nhớ hơn hai lệnh.
await run();
eq('lần hai: không chạy thêm câu lệnh nào', sqlHost.ran.length, 1);
eq('lần hai: kho rỗng lại', store.getSample(CATALOG), null);

section('sample-host — tên database tới được câu lệnh');

reset();
open(CATALOG);
sqlHost.rows = [{ ma_kh: 'KH01' }];
await run();
/*
 * `@@sysDatabaseName`/`@@appDatabaseName` là hai biến chỉ KẾT NỐI mới biết, và chúng có mặt
 * trong câu query của rất nhiều controller. Nối database phải xảy ra TRƯỚC khi dựng câu lệnh;
 * dựng trước rồi mới nối là dựng ra một câu còn nguyên hai biến ấy, tức một câu chắc chắn hỏng.
 */
ok('đã nối database trước khi dựng', sqlHost.ran.length === 1);

/* ═════════════════════════════════════════════════════════════════════════
 * CHI TIẾT — dò trước, đọc sau
 * ═════════════════════════════════════════════════════════════════════════ */
section('sample-host — lưới chi tiết chạy HAI câu: dò rồi mới đọc');

reset();
open(DETAIL);
/*
 * Bản giả trả CÙNG một bộ dòng cho mọi lượt chạy, nên bộ ấy phải mang cả cột của câu dò
 * (`period`, `key`) lẫn cột của câu đọc (`ma_vt`).
 */
sqlHost.rows = [{ period: '202607', key: 'PN1000000000123', ma_vt: 'VT01' }];
await run();

eq('chạy đúng hai câu', sqlHost.ran.length, 2);
ok('câu ĐẦU là câu dò, trên bảng chứng từ',
  sqlHost.ran[0].sql.includes("select top 1 convert(char(6), ngay_ct, 112) as partition, stt_rec from c64$000000 where status not in ('*', 'L')"));
/*
 * Đây là cả lý do phải chạy hai câu: kỳ của bảng chi tiết là kỳ của CHỨNG TỪ đã dò (`202607`),
 * không phải tháng người ta đang ngồi xem. Đọc bảng tháng này trong khi chứng từ nằm ở tháng
 * trước là đọc một bảng không có dòng nào của nó.
 */
ok('câu SAU đọc bảng theo kỳ VỪA DÒ ĐƯỢC', sqlHost.ran[1].sql.includes('from d64$202607 a'));
ok('và lọc theo khoá VỪA DÒ ĐƯỢC', sqlHost.ran[1].sql.includes("where stt_rec = 'PN1000000000123'"));
ok('câu dò KHÔNG hex (khoá là mã ASCII)', sqlHost.ran[0].opts.textAsHex === false);
ok('KHÔNG hỏi người dùng gì cả', fakeDialog.shown.length === 0);
ok('dữ liệu vào kho', store.getSample(DETAIL) !== null);

/* Câu dò về tay không → vẫn đọc được, chỉ là bản xem trước kém hơn. Không dừng cả lệnh. */
reset();
open(DETAIL);
sqlHost.rows = [];
await run();
eq('dò rỗng: vẫn chạy câu đọc', sqlHost.ran.length, 2);
ok('quay về 1 = 1', sqlHost.ran[1].sql.includes('where 1 = 1'));
ok('và kỳ về tháng hiện tại', /from d64\$\d{6} a/.test(sqlHost.ran[1].sql));

/*
 * Câu đọc của lưới chi tiết KHÔNG còn giới hạn số dòng ở SQL (SET ROWCOUNT từng chặn nhầm cả
 * câu insert bảng tạm ở giữa script — bỏ). Tầng vỏ tự cắt còn đúng `fboDesigner.sampleRowCount`
 * SAU khi đọc xong, không phải trước.
 */
reset();
fakeVscode.workspace.settings['fboDesigner.sampleRowCount'] = 2;
open(DETAIL);
sqlHost.rows = [
  { period: '202607', key: 'PN1000000000123', ma_vt: 'VT01' },
  { period: '202607', key: 'PN1000000000123', ma_vt: 'VT02' },
  { period: '202607', key: 'PN1000000000123', ma_vt: 'VT03' },
];
await run();
ok('câu đọc KHÔNG còn SET ROWCOUNT', !sqlHost.ran[1].sql.includes('SET ROWCOUNT'));
eq('kho chỉ giữ đúng số dòng cấu hình, dù sqlcmd trả về nhiều hơn', store.getSample(DETAIL).rows.length, 2);
ok('có ghi lý do đã cắt bớt ra Output', output.lines.some((l) => l.includes('chỉ hiện 2 dòng đầu')));
fakeVscode.workspace.settings['fboDesigner.sampleRowCount'] = undefined;

/*
 * Câu query đòi `@stt_rec` THẲNG, không qua `@@whereClause` — khoá ấy đã dò được ở bước 1, nên
 * không có gì để hỏi: điền thẳng, không mở dialog nào.
 */
reset();
open(DETAIL_NEEDS_KEY);
sqlHost.rows = [{ period: '202608', key: 'PN2000000000456', ma_vt: 'VT02' }];
await run();

eq('vẫn chạy đúng hai câu (dò rồi đọc)', sqlHost.ran.length, 2);
ok('KHÔNG mở dialog nào để hỏi @stt_rec', fakeDialog.shown.length === 0);
ok('giá trị vừa dò được điền THẲNG vào declare', sqlHost.ran[1].sql.includes("set @stt_rec = N'PN2000000000456';"));
ok('dữ liệu vẫn vào kho', store.getSample(DETAIL_NEEDS_KEY) !== null);
ok('và có ghi lý do ra Output — không tự dưng có giá trị', output.lines.some((l) => l.includes('điền @stt_rec')));

/* ═════════════════════════════════════════════════════════════════════════
 * BÁO CÁO — MỘT form, và form ấy cũng là chỗ xác nhận
 * ═════════════════════════════════════════════════════════════════════════ */
section('sample-host — lưới báo cáo hỏi bằng form');

reset();
open(REPORT);
sqlHost.rows = [{ ma_vt: 'VT01' }];
fakeDialog.answer = { action: 'confirm', values: { ma_kho: 'KHO01', ngay: '08/09/2026' } };
await run();

eq('có mở form', fakeDialog.shown.length, 1);
eq('hỏi ĐÚNG tham số script cần', fakeDialog.fields().map((f) => f.name), ['ma_kho', 'ngay']);
/*
 * Nhãn lấy từ `<field>` của file FILTER, không phải từ tên biến SQL: người dùng nhìn thấy đúng
 * chữ họ nhìn thấy trên màn hình lọc thật.
 */
ok('nhãn lấy từ <field> của Filter', fakeDialog.fields()[0].label.includes('Mã kho'));
ok('KHÔNG hỏi biến @@ (đó là việc của bản khai mặc định)',
  fakeDialog.fields().every((f) => !String(f.name).startsWith('@')));
/*
 * Cột NGÀY hiện theo `dd/MM/yyyy` (mặc định — field không khai `dataFormatString`), KHÔNG hiện
 * chuỗi SQL trần `2026-09-08` của `clientDefault`.
 */
const ngayField = fakeDialog.fields().find((f) => f.name === 'ngay');
eq('ô ngày HIỆN theo mặt nạ, không phải chuỗi SQL trần', ngayField.value, '08/09/2026');
ok('gợi ý cũng nói ra mặt nạ đang dùng', ngayField.hint.includes('dd/MM/yyyy'));
/*
 * Form NÀY cũng là chỗ xác nhận «có chạy proc của khách không» — nút chính mang chữ ấy, và
 * không còn hộp cảnh báo thứ hai. Hỏi hai lần cho cùng một quyết định dạy người ta bấm cho xong.
 */
ok('form mang cả lời cảnh báo chạy proc',
  (fakeDialog.shown[0].body ?? []).some((b) => b.type === 'highlight' && String(b.content).includes('stored procedure')));
ok('và KHÔNG hỏi lại bằng hộp thoại thứ hai', fakeVscode.window.asked.warning.length === 0);
eq('đã chạy', sqlHost.ran.length, 1);
ok('giá trị người dùng gõ vào câu lệnh', lastSql().includes("set @ma_kho = N'KHO01';"));
/*
 * Người dùng gõ `08/09/2026` (đúng mặt nạ hiện trên ô) — câu lệnh phải mang lại giá trị SQL đọc
 * được (`2026-09-08`), KHÔNG phải nguyên văn chuỗi đã gõ.
 */
ok('ngày gõ theo mặt nạ được đọc lại đúng thành SQL', lastSql().includes("set @ngay = '2026-09-08';"));
ok('tên database sys ghép vào', lastSql().includes("'fbosys'"));
ok("'#$query' thành bảng tạm của công cụ", lastSql().includes('##fbo$sample'));
ok('hạn giờ nới cho nhánh báo cáo', sqlHost.ran[0].opts.timeoutMs > 10000);

/* Không đụng vào ô ngày (giữ mặc định) thì vẫn phải đọc lại đúng — không phải chỉ khi gõ tay. */
reset();
open(REPORT);
sqlHost.rows = [{ ma_vt: 'VT01' }];
fakeDialog.answer = { action: 'confirm', values: { ma_kho: 'KHO02' } };
await run();
ok('không đụng ô ngày vẫn ra đúng giá trị SQL', lastSql().includes("set @ngay = '2026-09-08';"));

/* ═════════════════════════════════════════════════════════════════════════
 * BÁO CÁO KHÔNG '#$query' — chạy đủ script, KHÔNG SỬA GÌ, tự đếm bảng SAU KHI CHẠY
 * ═════════════════════════════════════════════════════════════════════════ */
section("sample-host — báo cáo tự in kết quả (không '#$query'): chạy đủ script, cắt đúng bảng");

reset();
open(REPORT_DIRECT);
/*
 * Resultset THẬT của exec có nhiều cột hơn lưới cần (`sl_ton`), và KHÔNG cùng thứ tự với field
 * khai trong lưới (`ma_kh` đứng trước `stt`) — bản giả không quan tâm chuyện lọc/khớp (đã kiểm
 * ở `test-sql-host.mjs: mapNamedRows`/`splitResultsets`), chỉ cần echo đúng field lưới cần.
 */
sqlHost.rows = [{ stt: '1', ma_kh: 'KH01' }];
sqlHost.datasetTableCount = 2;
sqlHost.datasetTableIndex = 1;
fakeDialog.answer = { action: 'confirm', values: {} };
await run();

eq('có mở form xác nhận', fakeDialog.shown.length, 1);
eq('chạy ĐÚNG MỘT câu — không còn bước dò schema riêng nào nữa', sqlHost.ran.length, 1);
ok('gọi runSampleQueryDataset (chạy đủ script, tự đếm bảng, khớp theo tên)',
  sqlHost.ran[0].dataset === true);
/*
 * `dir id="1"` truyền THẲNG xuống làm `targetIndex` — core không hề đoán hay cắt bớt script;
 * việc "script này thật sự sinh mấy bảng" chỉ `sql-host.js: splitResultsets` biết được, SAU KHI
 * đã chạy xong (xem `sample-host.js` gọi `runSampleQueryDataset`).
 */
eq('chỉ số bảng cần đọc đúng dir@id="1", TRUYỀN THẲNG không qua trung gian nào', sqlHost.ran[0].targetIndex, 1);
eq('cột cần tìm là field@name đã phân giải, không phải nhãn hiển thị',
  sqlHost.ran[0].wanted.map((w) => w.name), ['stt', 'ma_kh']);
ok('KHÔNG chèn mốc nào vào script (chạy nguyên văn, không sửa một ký tự nào)',
  !sqlHost.ran[0].sql.includes('~fbo-dataset'));
ok('câu debug lẫn câu exec đều còn NGUYÊN VĂN, đúng thứ tự gốc trong file — CHẠY ĐỦ SCRIPT',
  sqlHost.ran[0].sql.indexOf('select @tu_ngay as tu_ngay') < sqlHost.ran[0].sql.indexOf('exec zc_rptPurchaseDiscount'));
ok('KHÔNG hex-hoá (đường sqlcmd -i/-o/-f 65001 mới đã ra đúng dấu, không cần hex)',
  sqlHost.ran[0].opts.textAsHex === undefined);
ok('KHÔNG có ##fbo$sample, không insert/create table nào',
  !sqlHost.ran[0].sql.includes('##fbo$sample') && !sqlHost.ran[0].sql.includes('create table'));
ok('dữ liệu vào kho', store.getSample(REPORT_DIRECT) !== null);
eq('cột trả về đúng field lưới', store.getSample(REPORT_DIRECT).columns.map((c) => c.name).join(','), 'stt,ma_kh');
/*
 * `result.tableCount`/`tableIndex` chỉ `runSampleQueryDataset` trả về — số bảng script THẬT SỰ
 * sinh ra, biết được SAU KHI CHẠY. Ghi ra Output để chẩn đoán khi `dir@id` sai mà không ai biết.
 */
ok('ghi ra Output số bảng thật sự trả về và bảng đã đọc', output.lines.some((l) => l.includes('2 bảng') && l.includes('đọc bảng 1')));

/* `dir@id` vượt quá số bảng thật có — rơi về bảng CUỐI, và phải NÓI RÕ vì sao, không âm thầm. */
reset();
open(REPORT_DIRECT);
sqlHost.rows = [{ stt: '1', ma_kh: 'KH01' }];
sqlHost.datasetTableCount = 1;
sqlHost.datasetTableIndex = 0;
sqlHost.datasetOutOfRange = true;
fakeDialog.answer = { action: 'confirm', values: {} };
await run();
ok('vẫn nạp được dữ liệu dù dir@id vượt quá', store.getSample(REPORT_DIRECT) !== null);
ok('có ghi rõ dir@id đã vượt quá số bảng thật', output.lines.some((l) => l.includes('vượt quá')));

/* Field lưới khai mà bảng thật không có cột trùng tên — bỏ, ghi lý do, KHÔNG đoán bừa. */
reset();
open(REPORT_DIRECT);
sqlHost.rows = [{ stt: '1' }]; // thiếu hẳn ma_kh
sqlHost.datasetSkipped = ['ma_kh'];
fakeDialog.answer = { action: 'confirm', values: {} };
await run();
ok('vẫn nạp được dữ liệu dù thiếu một cột', store.getSample(REPORT_DIRECT) !== null);
ok('có ghi lý do cột nào bị bỏ và vì sao', output.lines.some((l) => l.includes('ma_kh') && l.includes('resultset thật')));

section('sample-host — huỷ form là KHÔNG chạy gì');


reset();
open(REPORT);
fakeDialog.answer = null; // Esc / bấm Huỷ
await run();
eq('huỷ: không chạy', sqlHost.ran.length, 0);
eq('và không có gì vào kho', store.getSample(REPORT), null);

section('sample-host — file không phải lưới thì nói thẳng');

reset();
const DIR = write('Filter/Plain.xml', ['<dir xmlns="urn:schemas-fast-com:data-dir"><fields/></dir>']);
open(DIR);
await run();
eq('không chạy câu lệnh nào', sqlHost.ran.length, 0);
ok('và có nói ra', fakeVscode.window.asked.warning.length === 1);

/* ═════════════════════════════════════════════════════════════════════════
 * TỰ NẠP khi mở giao diện giả lập
 * ═════════════════════════════════════════════════════════════════════════ */
section('sample-host — tự nạp lúc mở giao diện');

const autoRun = (file) => autoLoadSample(core, output, {
  uri: { scheme: 'file', fsPath: file },
  fileName: file,
  languageId: 'xml',
  getText: () => fs.readFileSync(file, 'utf8'),
  encoding: 'utf8',
  eol: fakeVscode.EndOfLine.CRLF,
});

reset();
sqlHost.rows = [{ ma_kh: 'KH01' }];
await autoRun(CATALOG);
eq('mặc định BẬT: lưới danh mục tự nạp', sqlHost.ran.length, 1);
ok('dữ liệu vào kho', store.getSample(CATALOG) !== null);
/*
 * Lượt tự nạp KHÔNG bật một thông báo nào. Một hộp thoại tự hiện lên vì người ta vừa MỞ một file
 * là thứ dạy người ta tắt tuỳ chọn — mà tuỳ chọn ấy vừa được bật mặc định.
 */
ok('và im lặng: không toast, không hộp thoại',
  fakeVscode.window.asked.info.length === 0
  && fakeVscode.window.asked.warning.length === 0
  && fakeVscode.window.asked.quickPick.length === 0
  && fakeDialog.shown.length === 0);

// Gọi lại cho cùng file: đã có dữ liệu rồi thì không chạy thêm lượt sqlcmd nào.
await autoRun(CATALOG);
eq('đã có dữ liệu thì không nạp lại', sqlHost.ran.length, 1);

reset();
fakeVscode.workspace.settings['fboDesigner.autoLoadSampleData'] = false;
await autoRun(CATALOG);
eq('tắt tuỳ chọn thì không tự nạp', sqlHost.ran.length, 0);

/*
 * Lưới báo cáo LUÔN cần hộp thoại (tham số + xác nhận), nên nó không bao giờ tự nạp — kể cả khi
 * tuỳ chọn bật.
 */
reset();
await autoRun(REPORT);
eq('lưới báo cáo không tự nạp', sqlHost.ran.length, 0);
ok('và không mở form nào', fakeDialog.shown.length === 0);

section('sample-host — TẮT TAY thắng tuỳ chọn tự nạp');

/*
 * Không có luật này thì bấm `Ctrl+Alt+D` để tắt xong, nhảy sang file khác rồi quay lại là dữ
 * liệu tự về — người dùng vừa bảo "đừng hiện nữa" và công cụ hiện lại ngay.
 */
reset();
open(CATALOG);
sqlHost.rows = [{ ma_kh: 'KH01' }];
await run();                       // bấm phím tắt: nạp
await run();                       // bấm lần nữa: tắt
eq('đã tắt', store.getSample(CATALOG), null);
await autoRun(CATALOG);
eq('tự nạp KHÔNG cãi lời người dùng', sqlHost.ran.length, 1);

// Nhưng tự bấm nạp lại thì được, và sau đó tự nạp lại có hiệu lực trở lại.
await run();
eq('bấm tay vẫn nạp được sau khi đã tắt', sqlHost.ran.length, 2);
store.clearSample(CATALOG);
await autoRun(CATALOG);
eq('và lệnh tắt cũ không còn chặn nữa', sqlHost.ran.length, 3);

section('sample-host — lượt tự nạp không bao giờ ném ra ngoài');

/*
 * Bản xem trước phải vẽ được BỐ CỤC dù không nối được database — đó mới là thứ designer sinh ra
 * để làm. Một lượt tự nạp ném ra là cả `track()` của panel chết theo.
 */
reset();
const boom = sqlHost.resolveTargetConnection;
sqlHost.resolveTargetConnection = async () => { throw new Error('mạng chết'); };
let threw = false;
try { await autoRun(CATALOG); } catch { threw = true; }
sqlHost.resolveTargetConnection = boom;
ok('không ném', !threw);
ok('nhưng có ghi lý do ra Output', output.lines.some((l) => l.includes('mạng chết')));

section('sample-host — cột Initialize (status) vào câu lệnh danh mục');

/*
 * Preview đã merge `Grid/Config/Initialize` (group 101 → status). SELECT mẫu phải cùng danh
 * sách — thiếu status trong khi lưới đã hiện cột là xem trước nói dối.
 */
fs.mkdirSync(path.join(controllers, 'Grid', 'Config'), { recursive: true });
write('Grid/Config/Initialize.xml', [
  '<initialize xmlns="urn:schemas-fast-com:grid-initialize">',
  '  <controllers>',
  '    <controller name="Customer" group="101" description="Customer List"/>',
  '  </controllers>',
  '  <groups>',
  '    <group id="101">',
  '      <fields>',
  '        <field name="status" width="80" readOnly="true"><header v="Trang thai" e="Status"/></field>',
  '        <field name="u1" external="true" defaultValue="rtrim(u1.u_name)" width="100" readOnly="true"><header v="Nguoi tao" e="Created By"/></field>',
  '      </fields>',
  '      <views><view id="Grid"><field name="status"/><field name="u1"/></view></views>',
  '    </group>',
  '  </groups>',
  '</initialize>',
]);

reset();
open(CATALOG);
sqlHost.rows = [{ ma_kh: 'KH01', 'ten_kh%l': 'A', status: '1' }];
await run();

eq('đã chạy', sqlHost.ran.length, 1);
ok('nhãn có status', sqlHost.ran[0].labels.some((c) => (c.label ?? c) === 'status'));
ok('câu lệnh có status', /\bstatus\b/i.test(lastSql()));
ok('u1 không vào nhãn (biểu thức Initialize bị bỏ)', !sqlHost.ran[0].labels.some((c) => (c.label ?? c) === 'u1'));
ok('dữ liệu status vào kho', store.getSample(CATALOG)?.rows?.[0] && 'status' in store.getSample(CATALOG).rows[0]);

Module._load = originalLoad;
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* thư mục tạm, dọn được thì dọn */ }
