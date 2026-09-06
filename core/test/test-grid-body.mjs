// test-grid-body.mjs — thân lưới có hai lối: chỗ giữ chỗ (mặc định) và dữ liệu thật.
//
// Nhóm ĐẦU TIÊN là lý do file này tồn tại: lối cũ phải giữ nguyên TỪNG BYTE.
//
// Bản vẽ mặc định của designer là thứ mọi phép đo đối chiếu với runtime đang dựa vào — thước
// cột, chiều cao khối, ảnh chụp trong tài liệu. Thêm một tính năng mà làm xê dịch nó là âm thầm
// đổi thứ người ta đang tin, và không ai nhận ra cho tới lần đối chiếu tiếp theo.
//
// Nên ở đây có một ẢNH CHỤP nguyên văn. Nó dài và khó đọc — đó là chủ ý: nếu ai đó đổi một dấu
// cách trong `dataCell`, phép kiểm này phải gãy chứ không được im.

import { ok, eq, section } from './harness.mjs';
import { renderControllerHtml } from '../src/render.mjs';
import { renderGrid } from '../src/grid.mjs';
import { scanViews, scanFields, scanRoot } from '../src/spans.mjs';
import { buildSampleSelect } from '../src/grid-sample.mjs';
import { VIEWS_CONFIG } from '../src/msg.mjs';

const NL = '\r\n';

const XML = [
  '<grid table="dmkh" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="ma_kh" width="80"><header v="Ma" e="Code"/></field>',
  '    <field name="co" width="40" type="Boolean"><header v="Co" e="Yes"/></field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="ma_kh"/><field name="co"/></view></views>',
  '</grid>',
].join(NL);

/** Dựng lưới với tuỳ chọn tuỳ ý — đường mà `renderControllerHtml` cũng đi. */
function render(opts = {}) {
  return renderGrid(scanViews(XML), scanFields(XML), { root: scanRoot(XML), ...opts });
}

const rowsOf = (html) => html.split('\n').filter((l) => l.startsWith('<tr class="GridDataRow">'));

/* ═════════════════════════════════════════════════════════════════════════
 * 1. Lối cũ giữ nguyên từng byte
 * ═════════════════════════════════════════════════════════════════════════ */
section('thân lưới — không có dữ liệu thì HTML KHÔNG đổi một byte');

const base = render().html;

// Không truyền gì và truyền `sampleRows: null` phải là MỘT. Đây là phép kiểm rẻ nhất bắt được
// ca «giá trị mặc định của tham số mới lệch khỏi hành vi cũ».
eq('không truyền gì === truyền sampleRows: null', base, render({ sampleRows: null }).html);

eq('số hàng giữ chỗ đúng như cấu hình', rowsOf(base).length, VIEWS_CONFIG.sampleRows);

/*
 * ẢNH CHỤP nguyên văn hàng dữ liệu đầu — hàng DUY NHẤT mang control thật, nên nó gánh gần hết
 * bề mặt có thể xê dịch: thuộc tính của `<td>`, style của container, `id` của control, `title`,
 * và cả `text-align:center` mà cột Boolean nhận được.
 *
 * Gãy phép kiểm này KHÔNG có nghĩa là code sai — có thể bản vẽ vừa được sửa cho đúng runtime
 * hơn. Nhưng nó phải là một quyết định CÓ Ý THỨC, không phải một hệ quả phụ của việc thêm cột
 * dữ liệu vào thân lưới.
 */
const SNAPSHOT = '<tr class="GridDataRow"><td class="IndexCellBody" style="width:24px;">'
  + '<div style="width:24px;height:17px;">1</div></td>'
  + '<td nowrap class="CellDefault" style="overflow:hidden;width:80px;" data-fbo-col="1"'
  + ' data-fbo-span="1" data-fbo-width="80" data-fbo-column="ma_kh">'
  + '<div class="RowCellContainer" style="height:14px;width:80px;vertical-align:middle;">'
  + '<input type="text" id="fbo-field-ma_kh" class="CellInput TextInput" data-field-name="ma_kh"'
  + ' title="ma_kh"></div></td>'
  + '<td nowrap class="CellDefault" style="overflow:hidden;width:40px;" data-fbo-col="2"'
  + ' data-fbo-span="1" data-fbo-width="40" data-fbo-column="co">'
  + '<div class="RowCellContainer" style="height:14px;width:40px;vertical-align:middle;'
  + 'text-align:center;">'
  + '<input type="checkbox" id="fbo-field-co" class="CellInput CheckInput" data-field-name="co"'
  + ' title="co"></div></td></tr>';
eq('hàng giữ chỗ đúng từng byte', rowsOf(base)[0], SNAPSHOT);

// Lối cũ KHÔNG được mang dấu của tính năng mới.
ok('không có dấu data-fbo-nodata', !base.includes('data-fbo-nodata'));

/* ═════════════════════════════════════════════════════════════════════════
 * 2. Lối dữ liệu thật
 * ═════════════════════════════════════════════════════════════════════════ */
section('thân lưới — mỗi dòng dữ liệu là một hàng');

const withData = render({
  sampleRows: [
    { ma_kh: 'KH001', co: '1' },
    { ma_kh: 'KH002', co: '0' },
    { ma_kh: 'KH003', co: '0' },
  ],
}).html;
const dataRows = rowsOf(withData);

eq('ba dòng ra ba hàng, không phải số hàng giữ chỗ', dataRows.length, 3);
ok('giá trị nằm trong control, đúng như runtime', dataRows[0].includes('value="KH001"'));
ok('hàng thứ hai mang giá trị của chính nó', dataRows[1].includes('value="KH002"'));
ok('cột Boolean giá trị 1 thì tick', dataRows[0].includes('type="checkbox"') && dataRows[0].includes(' checked'));
ok('giá trị 0 thì không tick', !dataRows[1].includes(' checked'));

/*
 * `id` phải BIẾN MẤT ở lối dữ liệu. `id` suy từ tên field, nên ba hàng là ba phần tử trùng id —
 * và `document.getElementById` của webview vớ phải hàng đầu tiên cho mọi hàng.
 */
ok('không hàng dữ liệu nào mang id', dataRows.every((r) => !r.includes(' id="fbo-field-')));
// Nhưng `data-fbo-column` thì PHẢI còn: tầng edit tra ngược về `<field>` qua nó.
ok('vẫn giữ data-fbo-column để tra ngược về XML', dataRows[0].includes('data-fbo-column="ma_kh"'));
// Và bề rộng ô không đổi — đó là cả lý do người ta mở phép xem trước này.
ok('bề rộng ô giữ nguyên như bản vẽ', dataRows[0].includes('style="overflow:hidden;width:80px;"'));

section('thân lưới — ô trống, ô NULL, và ô KHÔNG LẤY ĐƯỢC là ba chuyện khác nhau');

const three = rowsOf(render({
  sampleRows: [{ ma_kh: '', co: null }, { ma_kh: 'X' }],
}).html);

/*
 * Chuỗi rỗng là một giá trị THẬT, và nó ra `value=""` TƯỜNG MINH chứ không phải "bỏ thuộc tính
 * value đi". Hai thứ trông giống nhau trên màn hình nhưng khác nhau ở chỗ đáng kể: bỏ thuộc
 * tính là đường mà lối cũ đi khi field không có giá trị mặc định, và trộn hai lối vào một là mất
 * khả năng nhìn HTML mà biết ô này đến từ dữ liệu hay từ chỗ giữ chỗ.
 */
ok('chuỗi rỗng ra value="" tường minh', three[0].includes('class="CellInput TextInput"') && three[0].includes('value=""'));
// `NULL` của SQL cũng ra ô trống — KHÔNG được rơi về giá trị mặc định của field.
ok('NULL không hiện giá trị mặc định', !three[0].includes(' checked'));

/*
 * Cột không có khoá trong dòng dữ liệu = cột đã bị `buildSampleSelect` BỎ khỏi câu lệnh (bảng
 * tạm cục bộ, biểu thức không bóc được…). Khác hẳn một ô rỗng, và người dùng phải phân biệt
 * được — đọc một ô trống thành «dữ liệu rỗng» là kết luận sai từ một chỗ ta biết rõ là thiếu.
 */
ok('cột không lấy được mang dấu riêng', three[1].includes('data-fbo-nodata="1"'));
ok('và không dựng control cho nó', three[1].split('data-fbo-column="co"')[1].includes('></div></td>'));
ok('cột lấy được thì KHÔNG mang dấu ấy', !three[0].includes('data-fbo-nodata'));

section('thân lưới — giá trị của khách không phá được HTML');
// Dữ liệu thật đến từ database của khách. Một dấu nháy kép chưa thoát là thoát ra khỏi thuộc
// tính `value` và cả bản vẽ hỏng từ đó trở đi.
const evil = rowsOf(render({
  sampleRows: [{ ma_kh: '"><script>alert(1)</script>', co: '0' }],
}).html)[0];
ok('dấu nháy kép được thoát', !evil.includes('value="">'));
ok('không có thẻ script sống', !evil.includes('<script>'));
ok('nội dung vẫn còn, chỉ là đã thoát', evil.includes('&lt;script&gt;') || evil.includes('&quot;'));

section('thân lưới — không dòng nào thì thân rỗng, không phải hàng giữ chỗ');
// Câu lệnh chạy xong trả về 0 dòng là một câu trả lời THẬT. Rơi về hàng giữ chỗ ở đây là nói dối
// rằng chưa lấy dữ liệu.
eq('mảng rỗng ra 0 hàng', rowsOf(render({ sampleRows: [] }).html).length, 0);

/* ═════════════════════════════════════════════════════════════════════════
 * 3. Khớp khoá với `buildSampleSelect`
 * ═════════════════════════════════════════════════════════════════════════ */
section('thân lưới — nhãn cột của câu SELECT khớp tên cột của model');

/*
 * Đây là mối nối dễ gãy THẦM LẶNG nhất của cả tính năng: `buildSampleSelect` đặt nhãn theo tên
 * FBO nguyên văn (`ten_kh%l`), còn `renderGridHtml` tra dữ liệu theo `model.columns[].name`.
 * Hai bên lệch nhau thì mọi ô đều `data-fbo-nodata` — lưới trông như không có dữ liệu, mà câu
 * lệnh thì đã chạy xong và trả về đủ dòng.
 */
const LOCALE = [
  '<grid table="dmkh" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="ma_kh" width="80"><header v="Ma" e="Code"/></field>',
  '    <field name="ten_kh%l" width="150"><header v="Ten" e="Name"/></field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="ma_kh"/><field name="ten_kh%l"/></view></views>',
  '</grid>',
].join(NL);

const plan = buildSampleSelect(LOCALE);
ok('dựng được câu lệnh', plan.ok);
const model = renderGrid(scanViews(LOCALE), scanFields(LOCALE), { root: scanRoot(LOCALE) }).model;
eq('nhãn của câu SELECT trùng tên cột của model',
  plan.columns.map((c) => c.label), model.columns.map((c) => c.name));

// Và dựng thật một dòng theo đúng nhãn ấy: mọi ô phải có dữ liệu, không ô nào `nodata`.
const row = Object.fromEntries(plan.columns.map((c) => [c.label, `giá trị ${c.label}`]));
const filled = rowsOf(renderGrid(scanViews(LOCALE), scanFields(LOCALE), {
  root: scanRoot(LOCALE), sampleRows: [row],
}).html)[0];
ok('không ô nào rơi vào nhánh không-lấy-được', !filled.includes('data-fbo-nodata'));
ok('cột có hậu tố ngôn ngữ vẫn nhận đúng giá trị', filled.includes('value="giá trị ten_kh%l"'));

section('thân lưới — cột ẩn vẫn dựng, chỉ là không có gì bên trong');
const HIDDEN = XML.replace('<field name="co" width="40" type="Boolean">',
  '<field name="co" width="40" type="Boolean" hidden="true">');
const hid = rowsOf(renderGrid(scanViews(HIDDEN), scanFields(HIDDEN), {
  root: scanRoot(HIDDEN), sampleRows: [{ ma_kh: 'A', co: '1' }],
}).html)[0];
// Bỏ hẳn ô đi là hàng hụt một `<td>` và mọi cột sau lệch — runtime cũng dựng đủ ô rồi mới ẩn.
ok('cột ẩn vẫn có ô', hid.includes('data-fbo-column="co"'));
ok('nhưng không dựng control trong đó', !hid.includes(' checked'));

section('thân lưới — renderControllerHtml truyền sampleRows xuống');
// Tầng vỏ gọi `renderControllerHtml`, không gọi `renderGrid`. Không truyền tiếp thì tính năng
// chạy trong test mà không chạy trong extension — đúng kiểu hỏng chỉ lộ ra khi bấm nút thật.
const viaController = renderControllerHtml(XML, { sampleRows: [{ ma_kh: 'QUA_CONTROLLER', co: '0' }] });
ok('đi qua renderControllerHtml vẫn tới nơi', viaController.html.includes('value="QUA_CONTROLLER"'));
