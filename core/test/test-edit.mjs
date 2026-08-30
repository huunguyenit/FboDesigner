// test-edit.mjs — tầng GHI NGƯỢC. Đây là chỗ nguy hiểm nhất của cả dự án: render sai thì
// người dùng nhìn ra, ghi sai thì file của khách hỏng và có khi vài tuần sau mới lộ.
//
// Bất biến chính, và cũng là thứ mọi test dưới đây quay quanh: **splice chỉ được đổi đúng phần
// nó nhắm tới, mọi byte khác giữ nguyên**. Encoding, CRLF, thụt lề, comment, và entity chưa
// bung đều sống nhờ bất biến đó.

import { ok, eq, section } from './harness.mjs';
import { renderControllerHtml } from '../src/render.mjs';
import {
  planRowEdit, planAddRow, planAddField, canEditRow, planRemoveField,
  planColumnWidth, planRemoveColumn, planInsertColumn, planViewHeight, planFieldRows,
  rowEditTargetFile,
  planRegionMetadata,
  planRemoveControl, planInlineEntity,
} from '../src/edit.mjs';
import { moveCell, swapCells } from '../src/item-value.mjs';
import { FIELD_KINDS, buildField, isValidFieldName } from '../src/field-template.mjs';
import { expandEntities, refResolvedSpan } from '../src/entities.mjs';
import { applySplices } from '../src/spans.mjs';

const NL = '\r\n';
const DOC = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkho">',
  '  <!-- comment phải sống sót qua mọi phép sửa -->',
  '  <fields>',
  '    <field name="ma_kho"><header v="Mã kho" e="Code"/></field>',
  '    <field name="ten_kho"><header v="Tên kho" e="Name"/></field>',
  '    <field name="le_loi"><header v="Lẻ loi" e="Unused"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 90, 150"/>',
  '    <item value="1100: [ma_kho].Label, [ma_kho]"/>',
  '    <item value="11--: [ten_kho].Label, [ten_kho]"/>',
  '  </view>',
  '</dir>',
].join(NL);

/** Dựng model từ văn bản, kèm segments — edit cần `range` nên bắt buộc phải bung entity. */
function build(text, file = 'C:/P/App_Data/Controllers/Dir/Kho.xml') {
  const ex = expandEntities(text, { filePath: file, readFile: () => null });
  const r = renderControllerHtml(ex.clearText, { segments: ex.segments, hostFile: file });
  return { model: r.model, warnings: r.warnings, file };
}

/** Áp splice rồi khẳng định phần NGOÀI splice không đổi một byte nào. */
function applyAndCheck(label, text, splice) {
  const after = applySplices(text, [splice]);
  const headSame = after.slice(0, splice.start) === text.slice(0, splice.start);
  const tailSame = after.slice(splice.start + splice.text.length) === text.slice(splice.end);
  ok(`${label}: phần ngoài splice nguyên vẹn từng byte`, headSame && tailSame);
  return after;
}

const base = build(DOC);
const rowMa = base.model.rows.find((r) => r.row.tokens.some((t) => t.field === 'ma_kho'));
const rowTen = base.model.rows.find((r) => r.row.tokens.some((t) => t.field === 'ten_kho'));

section('range của hàng trỏ đúng vào văn bản nguồn');
// Nếu điều này sai thì mọi splice bên dưới cắt trúng chỗ khác — kiểm trước tất cả.
eq('cắt theo range ra đúng value', DOC.slice(rowMa.range.start, rowMa.range.end), rowMa.item.value);
eq('range của hàng thứ hai cũng đúng', DOC.slice(rowTen.range.start, rowTen.range.end), rowTen.item.value);

section('resize — nở vào cột trống');
const grow = planRowEdit(base.model, { kind: 'resize', item: rowTen.index, cell: 1, span: 2 }, DOC);
ok('lập được kế hoạch', grow.ok);
// Gộp/tách ghi đè ĐÚNG MẤY KÝ TỰ ĐÃ ĐỔI, không phải cả pattern và càng không phải cả hàng.
// Nhờ thế token chứa entity an toàn, mà pattern ghép từ nhiều nguồn cũng sửa được — xem
// mục «pattern lai» phía dưới. `11--` → `110-`: đúng một ký tự ở chỉ số 2 đổi.
eq('splice chỉ gồm ký tự đã đổi', grow.splice.text, '0');
eq('và chỉ trùm lên đúng ký tự cũ', DOC.slice(grow.splice.start, grow.splice.end), '-');
const afterGrow = applyAndCheck('resize', DOC, grow.splice);
ok('comment vẫn còn', afterGrow.includes('<!-- comment phải sống sót qua mọi phép sửa -->'));
ok('CRLF không bị đổi thành LF', !/[^\r]\n/.test(afterGrow));
// Đọc lại: đây là bài kiểm tra thật sự — ghi ra rồi parse lại phải ra đúng thứ vừa định làm.
const reGrow = build(afterGrow);
eq('đọc lại thấy span mới', reGrow.model.rows.find((r) => r.index === rowTen.index).cells[1].span, 2);
eq('không đẻ ra cảnh báo mới', reGrow.warnings.length, base.warnings.length);

section('resize — đụng control thì TỪ CHỐI, không nuốt hộ');
const blocked = planRowEdit(base.model, { kind: 'resize', item: rowMa.index, cell: 0, span: 2 }, DOC);
ok('từ chối', !blocked.ok);
ok('nói rõ vì sao', blocked.reason.includes('đang có control'));

section('remove — bỏ control, các hàng khác không suy suyển');
const rm = planRowEdit(base.model, { kind: 'remove', item: rowMa.index, cell: 0 }, DOC);
ok('lập được kế hoạch', rm.ok);
eq('value mới', rm.splice.text, '-100: [ma_kho]');
const afterRm = applyAndCheck('remove', DOC, rm.splice);
const reRm = build(afterRm);
eq('hàng kia còn nguyên', reRm.model.rows.find((r) => r.index === rowTen.index).item.value,
  '11--: [ten_kho].Label, [ten_kho]');
eq('không đẻ ra cảnh báo mới', reRm.warnings.length, base.warnings.length);

section('insert — thêm control vào ô trống bên phải');
const ins = planRowEdit(base.model,
  { kind: 'insert', item: rowTen.index, cell: 1, side: 'right', token: '[le_loi]' }, DOC);
ok('lập được kế hoạch', ins.ok);
eq('value mới', ins.splice.text, '111-: [ten_kho].Label, [ten_kho], [le_loi]');
const reIns = build(applyAndCheck('insert', DOC, ins.splice));
eq('đọc lại thấy 3 control', reIns.model.rows.find((r) => r.index === rowTen.index)
  .cells.filter((c) => !c.empty).length, 3);
eq('không đẻ ra cảnh báo mới', reIns.warnings.length, base.warnings.length);

section('addRow — chèn thẻ <item> mới, giữ thụt lề và xuống dòng của file');
const below = planAddRow(base.model,
  { kind: 'addRow', item: rowMa.index, side: 'below', token: '[le_loi]' }, DOC, rowMa.itemRange);
ok('lập được kế hoạch', below.ok);
ok('dùng CRLF như file', below.splice.text.startsWith('\r\n'));
ok('thụt lề 4 dấu cách như thẻ cũ', below.splice.text.includes('\r\n    <item '));
const afterAdd = applyAndCheck('addRow', DOC, below.splice);
const reAdd = build(afterAdd);
eq('nhiều hơn đúng một hàng', reAdd.model.rows.length, base.model.rows.length + 1);
eq('không đẻ ra cảnh báo mới', reAdd.warnings.length, base.warnings.length);

const above = planAddRow(base.model,
  { kind: 'addRow', item: rowMa.index, side: 'above', token: '[le_loi]' }, DOC, rowMa.itemRange);
const reAbove = build(applyAndCheck('addRow above', DOC, above.splice));
// Chèn phía trên phải đẩy hàng cũ xuống, không đè lên nó.
eq('hàng mới đứng trước', reAbove.model.rows[reAbove.model.rows.findIndex(
  (r) => r.item.value.includes('[ma_kho]')) - 1].item.value, '1---: [le_loi]');

section('hàng viết bằng entity ĐÃ BUNG — vẫn phải từ chối');
// Đây là ca đã suýt lọt, và là lý do guard không thể chỉ dựa vào `hasEntity`.
//
// Hàng viết `1100: [&k;].Label, [&k;]` với `<!ENTITY k "ma_kho">`. Sau khi bung, giá trị trong
// model là `1100: [ma_kho].Label, [ma_kho]` và `hasEntity` bằng FALSE — không còn dấu `&` nào
// để mà nhận ra. Ghi bản bung đè lên nguồn sẽ thay `&k;` thành `ma_kho`, tham chiếu biến mất,
// và lần sau sửa khai báo entity thì hàng này không đổi theo nữa.
const ENT = DOC.replace('<dir table="dmkho">', '<!DOCTYPE dir [<!ENTITY k "ma_kho">]>\r\n<dir table="dmkho">')
  .replace('1100: [ma_kho].Label, [ma_kho]', '1100: [&k;].Label, [&k;]');
const entModel = build(ENT);
const entRow = entModel.model.rows.find((r) => r.row.tokens.some((t) => t.field === 'ma_kho'));
ok('tìm được hàng', entRow !== undefined);
eq('và `hasEntity` KHÔNG bắt được nó', entRow.row.hasEntity, false);
// Thứ bắt được là so nguyên văn: văn bản trong file khác hẳn giá trị đã bung.
ok('văn bản nguồn khác giá trị đã bung',
  ENT.slice(entRow.range.start, entRow.range.end) !== entRow.item.value);
/*
 * THÊM và XOÁ nay LÀM ĐƯỢC trên hàng dùng entity, và `&k;` vẫn sống.
 *
 * Chìa khoá: hai phép này chạy trên bản parse của VĂN BẢN GỐC, không phải bản đã bung. Token
 * không đụng tới đi qua nguyên văn `[&k;]`, `serializeRow` ghi lại đúng chuỗi ấy.
 *
 * Bản trước từ chối cả hai — kể cả khi thêm một control chẳng liên quan gì tới `&k;`.
 */
const entRemove = planRowEdit(entModel.model, { kind: 'remove', item: entRow.index, cell: 0 }, ENT);
ok('xoá control LÀM ĐƯỢC', entRemove.ok);
ok('và `&k;` còn nguyên trong chuỗi ghi lại', entRemove.splice.text.includes('&k;'));
ok('không có chữ đã bung nào lọt vào', !entRemove.splice.text.includes('ma_kho'));

/*
 * Thêm control vào ô trống bên phải: chuỗi cũ giữ nguyên từng ký tự, chỉ mọc thêm token mới.
 *
 * Pattern `110-` chứ không `1100`: hàng gốc chiếm hết 4 cột nên KHÔNG còn ô trống nào để thêm
 * vào, và phép thử sẽ hỏi một câu khác câu cần hỏi.
 */
const ENT_FREE = ENT.replace('1100: [&k;].Label, [&k;]', '110-: [&k;].Label, [&k;]');
const entFreeModel = build(ENT_FREE);
const entFreeRow = entFreeModel.model.rows.find((r) => r.row.tokens.some((t) => t.field === 'ma_kho'));
const entInsert = planRowEdit(entFreeModel.model,
  { kind: 'insert', item: entFreeRow.index, cell: 1, side: 'right', token: '[ghi_chu]' }, ENT_FREE);
ok('thêm control LÀM ĐƯỢC', entInsert.ok);
ok('cả HAI tham chiếu &k; còn nguyên',
  (entInsert.splice.text.match(/&k;/g) || []).length === 2);
ok('token mới có mặt', entInsert.splice.text.includes('[ghi_chu]'));
ok('không có chữ đã bung nào lọt vào', !entInsert.splice.text.includes('ma_kho'));

// `canEditRow` VẪN từ chối — nó là guard của phép ghi ĐÈ CẢ HÀNG (gộp/tách đi đường khác).
// Giữ nguyên để không ai tưởng luật cũ đã bị gỡ bỏ hoàn toàn.
eq('canEditRow vẫn từ chối ghi đè cả hàng', canEditRow(entRow, ENT).ok, false);

section('…nhưng gộp/tách thì VẪN LÀM ĐƯỢC trên hàng dùng entity');
// Gộp/tách chỉ đổi pattern. Bắt cả hàng phải khớp nguyên văn mới cho sửa thì mọi hàng viết
// `[&k;]` vĩnh viễn không gộp/tách được, dù phép sửa chẳng liên quan gì tới `&k;`.
// `1100` cho ô 1 trải sẵn 3 cột; tách bớt về 2 cột.
const entResize = planRowEdit(entModel.model, { kind: 'resize', item: entRow.index, cell: 1, span: 2 }, ENT);
ok('gộp/tách được', entResize.ok);
eq('splice chỉ trùm đúng ký tự cũ', ENT.slice(entResize.splice.start, entResize.splice.end), '0');
eq('ký tự mới', entResize.splice.text, '-');
const afterEnt = applyAndCheck('resize trên hàng entity', ENT, entResize.splice);
ok('tham chiếu &k; còn nguyên', afterEnt.includes('[&k;].Label, [&k;]'));
eq('khai báo entity không bị đụng', (afterEnt.match(/<!ENTITY k "ma_kho">/g) || []).length, 1);
// Đọc lại: span đã đổi thật, và token vẫn bung ra đúng như cũ.
const reEnt = build(afterEnt);
const reEntRow = reEnt.model.rows.find((r) => r.index === entRow.index);
eq('span mới có hiệu lực', reEntRow.cells[1].span, 2);
eq('token vẫn trỏ đúng field', reEntRow.row.tokens.map((t) => t.field), ['ma_kho', 'ma_kho']);

// Không đưa văn bản nguồn vào thì cũng phải từ chối — thà không sửa còn hơn sửa mù.
eq('thiếu văn bản nguồn thì từ chối', canEditRow(rowMa, undefined).ok, false);

section('hàng từ Include dùng chung — sửa được nhưng phải CẢNH BÁO');
// Không chặn: hàng đó sửa được thật. Nhưng sửa là đổi cho mọi controller cùng include, nên
// tầng vỏ phải hỏi người dùng — `warning` là thứ bắt nó phải hỏi.
const clean = canEditRow(rowMa, DOC);
ok('hàng của chính file thì không cảnh báo', clean.ok && clean.warning === null);

section('planRemoveField — còn ai dùng thì KHÔNG xoá');
// Xoá field mà token khác còn trỏ tới thì form vẫn vẽ, chỉ hiện ô đỏ ở một chỗ khác hẳn chỗ
// vừa bấm — người dùng không nối được hai việc đó với nhau.
const used = planRemoveField(base.model, 'ma_kho', { start: 0, end: 10 });
ok('từ chối vì còn hàng dùng', !used.ok);
ok('nói rõ hàng nào', used.usedBy.includes(rowMa.index));
const free = planRemoveField(base.model, 'le_loi', { start: 5, end: 15 });
ok('field không ai dùng thì xoá được', free.ok);
eq('splice là phép xoá', free.splice.text, '');
eq('không tìm thấy khai báo thì từ chối', planRemoveField(base.model, 'le_loi', null).ok, false);

section('sửa xong không được đổi gì ngoài đúng một hàng');
// Bảo hiểm cuối: so từng hàng trước/sau, chỉ đúng hàng bị nhắm được phép khác.
const reAll = build(applySplices(DOC, [grow.splice]));
const changed = reAll.model.rows.filter((r) => {
  const old = base.model.rows.find((b) => b.index === r.index);
  return !old || old.item.value !== r.item.value;
});
eq('đúng một hàng đổi', changed.length, 1);
eq('và là hàng đã nhắm', changed[0].index, rowTen.index);

section('thêm control = tạo field MỚI, không phải chọn field cũ');
// Bảy kiểu đều là "textbox cộng thêm gì đó"; khác nhau ở `type`, `dataFormatString` và
// `<items style>` — ba thứ runtime dùng để chọn control.
eq('đủ bảy kiểu', FIELD_KINDS.map((k) => k.id),
  ['textbox', 'datetime', 'numeric', 'checkbox', 'dropdownlist', 'autocomplete', 'lookup']);

const tb = buildField('textbox', 'ma_kh', 'Mã khách');
ok('textbox dựng được', tb.ok);
eq('khai báo tối giản, không bịa thuộc tính', tb.xml,
  '<field name="ma_kh"><header v="Mã khách" e="Mã khách"/></field>');
// "textbox: có label + input" — một control ra HAI ô.
eq('ra hai token: nhãn rồi ô nhập', tb.tokens, ['[ma_kh].Label', '[ma_kh]']);

// Mẫu lấy từ field THẬT trong Dir/Customer.xml, không phải bịa cho hợp lý.
ok('datetime có type + dataFormatString',
  buildField('datetime', 'ngay_gh', 'Đến ngày').xml.includes('type="DateTime" dataFormatString="@datetimeFormat"'));
const num = buildField('numeric', 't_tien', 'Tiền');
ok('numeric là Decimal', num.xml.includes('type="Decimal"'));
ok('numeric có items style Numeric', num.xml.includes('<items style="Numeric"/>'));
ok('checkbox là Boolean', buildField('checkbox', 'kh_yn', 'Khách').xml.includes('type="Boolean"'));
// Nhãn checkbox nằm BÊN PHẢI hộp tick, nên token đảo thứ tự so với mọi control khác.
eq('checkbox: ô tick trước, nhãn sau', buildField('checkbox', 'kh_yn', 'K').tokens, ['[kh_yn]', '[kh_yn].Label']);
for (const [id, style] of [['dropdownlist', 'Dropdownlist'], ['autocomplete', 'AutoComplete'], ['lookup', 'Lookup']]) {
  ok(`${id} → items style ${style}`, buildField(id, 'x', 'X').xml.includes(`<items style="${style}"/>`));
}

section('tên field và nhãn — kiểm trước khi ghi, không ghi rồi mới biết');
ok('tên hợp lệ', isValidFieldName('ma_kh') && isValidFieldName('ten_tk%l'));
ok('tên có dấu cách thì không', !isValidFieldName('ma kh'));
ok('tên bắt đầu bằng số thì không', !isValidFieldName('1ma'));
ok('buildField từ chối tên hỏng', !buildField('textbox', 'ma kh', 'X').ok);
ok('kiểu lạ thì từ chối', !buildField('khong_co', 'ma_kh', 'X').ok);
// Bỏ trống nhãn thì lấy tên field, không để nhãn rỗng.
ok('nhãn rỗng rơi về tên field', buildField('textbox', 'ma_kh', '').xml.includes('v="ma_kh"'));
// Nhãn có ký tự XML phải được thoát, nếu không file thành không đọc được.
ok('nhãn có & và " được thoát',
  buildField('textbox', 'x', 'A & B "c"').xml.includes('v="A &amp; B &quot;c&quot;"'));

section('planAddField — chèn khai báo vào cuối <fields>');
const decl = planAddField(DOC, '<field name="moi"><header v="Mới" e="New"/></field>', 'moi');
ok('lập được kế hoạch', decl.ok);
const afterDecl = applyAndCheck('planAddField', DOC, decl.splice);
ok('nằm TRƯỚC </fields>', afterDecl.indexOf('name="moi"') < afterDecl.indexOf('</fields>'));
ok('sau field cuối cùng đang có', afterDecl.indexOf('name="moi"') > afterDecl.indexOf('name="le_loi"'));
ok('thụt lề bằng field cũ', afterDecl.includes('\r\n    <field name="moi"'));
ok('dùng CRLF như file', !/[^\r]\n/.test(afterDecl));
// Đọc lại: field mới phải thật sự dùng được, không chỉ là chữ trong file.
eq('đọc lại thấy field mới', build(afterDecl).model.fieldByName.has('moi'), true);

// Trùng tên là hỏng im lặng: hai `<field name="x">` thì Map lấy bản sau, và bản trước biến mất.
ok('từ chối khi field đã tồn tại', !planAddField(DOC, '<field name="ma_kho"/>', 'ma_kho').ok);
ok('file không có <fields> thì từ chối', !planAddField('<dir><view/></dir>', '<field/>', 'x').ok);

section('thêm control cần NHIỀU cột trống — thiếu một cột cũng từ chối');
// Textbox chiếm 2 cột (nhãn + ô nhập). Đặt được bao nhiêu hay bấy nhiêu thì ra một control cụt.
const two = planRowEdit(base.model,
  { kind: 'insert', item: rowTen.index, cell: 1, side: 'right', token: ['[moi].Label', '[moi]'] }, DOC);
ok('hai cột trống thì đặt được', two.ok);
eq('cả hai cột thành "1"', two.splice.text, '1111: [ten_kho].Label, [ten_kho], [moi].Label, [moi]');
// rowMa là `1100` — ô 1 trải hết hàng, không còn cột nào bên phải.
const noRoom = planRowEdit(base.model,
  { kind: 'insert', item: rowMa.index, cell: 1, side: 'right', token: ['[moi].Label', '[moi]'] }, DOC);
ok('không đủ cột thì từ chối', !noRoom.ok);
ok('nói rõ còn mấy cột', noRoom.reason.includes('cột trống'));

// ─────────────────────────────────────────────────────────────────────────────
// Cột của lưới. Lưới khai layout bằng THỨ TỰ chứ không bằng pattern, nên ba phép dưới đây
// không dùng chung gì với phép sửa hàng của form — và chúng đụng vào HAI chỗ khác nhau:
// bề rộng nằm ở `<fields>`, còn thứ tự cột nằm ở `<view>`.
const GRID = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<grid table="ct" type="Detail" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="ma_kh" width="0" hidden="true"><header v="" e=""/></field>',
  '    <field name="ma_bp0" width="100"><header v="Đơn vị mua" e="Org"/></field>',
  '    <field name="ten_bp0"><header v="Tên" e="Name"/></field>',
  '    <field name="ghi_chu" width="200"><header v="Ghi chú" e="Note"/></field>',
  '  </fields>',
  '  <views>',
  '    <view id="Grid">',
  '      <field name="ma_kh"/>',
  '      <field name="ma_bp0"/>',
  '      <field name="ten_bp0"/>',
  '    </view>',
  '  </views>',
  '</grid>',
].join(NL);

function buildGrid(text, file = 'C:/P/App_Data/Controllers/Grid/CT.f') {
  const ex = expandEntities(text, { filePath: file, readFile: () => null });
  const r = renderControllerHtml(ex.clearText, { segments: ex.segments, hostFile: file });
  return r.model;
}
const gm = buildGrid(GRID);

section('cột lưới — kéo giãn ghi vào width của KHAI BÁO, không đụng view');
const w = planColumnWidth(gm, 'ma_bp0', 160, GRID);
ok('lập được kế hoạch', w.ok);
eq('ghi đè đúng giá trị cũ', GRID.slice(w.splice.start, w.splice.end), '100');
eq('giá trị mới', w.splice.text, '160');
const afterW = applyAndCheck('columnWidth', GRID, w.splice);
eq('đọc lại thấy bề rộng mới', buildGrid(afterW).columns.find((c) => c.name === 'ma_bp0').width, 160);
// Thứ tự cột là chuyện của view — kéo giãn không được đụng tới nó.
eq('thứ tự cột không đổi', buildGrid(afterW).columns.map((c) => c.name), gm.columns.map((c) => c.name));

// Cột chưa khai `width` thì phải CHÈN thuộc tính, không im lặng bỏ qua.
const wNew = planColumnWidth(gm, 'ten_bp0', 250, GRID);
ok('cột chưa có width thì chèn mới', wNew.ok);
eq('chèn đúng dạng thuộc tính', wNew.splice.text, ' width="250"');
eq('đọc lại thấy 250', buildGrid(applyAndCheck('width mới', GRID, wNew.splice))
  .columns.find((c) => c.name === 'ten_bp0').width, 250);
ok('bề rộng âm thì từ chối', !planColumnWidth(gm, 'ma_bp0', -5, GRID).ok);
ok('cột không có thì từ chối', !planColumnWidth(gm, 'khong_co', 100, GRID).ok);

section('cột lưới — xoá cột bỏ khỏi VIEW nhưng GIỮ khai báo');
// Cùng một `<field>` có thể được view khác dùng; bỏ cột khỏi lưới là chuyện hiển thị.
const rmc = planRemoveColumn(gm, 'ma_bp0', GRID);
ok('lập được kế hoạch', rmc.ok);
const afterRmc = applyAndCheck('removeColumn', GRID, rmc.splice);
eq('cột biến khỏi lưới', buildGrid(afterRmc).columns.map((c) => c.name), ['ma_kh', 'ten_bp0']);
ok('khai báo <field> vẫn còn', afterRmc.includes('<field name="ma_bp0" width="100">'));
ok('không để lại dòng trắng', !/\r\n\s*\r\n\s*<field name="ten_bp0"\/>/.test(afterRmc));

section('cột lưới — chèn cột cạnh cột đang chọn');
const insc = planInsertColumn(gm, 'ma_bp0', 'right', 'ghi_chu', GRID);
ok('lập được kế hoạch', insc.ok);
const afterInsc = applyAndCheck('insertColumn', GRID, insc.splice);
eq('cột mới đứng ngay sau', buildGrid(afterInsc).columns.map((c) => c.name),
  ['ma_kh', 'ma_bp0', 'ghi_chu', 'ten_bp0']);
ok('thụt lề bằng cột cũ', afterInsc.includes('\r\n      <field name="ghi_chu"/>'));
const inscL = planInsertColumn(gm, 'ma_bp0', 'left', 'ghi_chu', GRID);
eq('chèn bên trái thì đứng trước', buildGrid(applyAndCheck('insert trái', GRID, inscL.splice))
  .columns.map((c) => c.name), ['ma_kh', 'ghi_chu', 'ma_bp0', 'ten_bp0']);
ok('trùng tên cột thì từ chối', !planInsertColumn(gm, 'ma_bp0', 'right', 'ten_bp0', GRID).ok);

// Cột trỏ vào field CHƯA KHAI thì lưới không vẽ nó ra — nhưng phải có cảnh báo, không im lặng.
// Đây là lý do tầng vỏ phải ghép `planInsertColumn` với `planAddField` khi tạo cột hoàn toàn mới.
const undeclared = planInsertColumn(gm, 'ma_bp0', 'right', 'chua_khai', GRID);
ok('vẫn chèn được về mặt văn bản', undeclared.ok);
const afterUnd = applySplices(GRID, [undeclared.splice]);
const exUnd = expandEntities(afterUnd, { filePath: 'C:/P/App_Data/Controllers/Grid/CT.f', readFile: () => null });
const rUnd = renderControllerHtml(exUnd.clearText,
  { segments: exUnd.segments, hostFile: 'C:/P/App_Data/Controllers/Grid/CT.f' });
ok('nhưng có cảnh báo nêu đúng tên', rUnd.warnings.some((x) => x.message.includes('chua_khai')));
ok('và cột đó không được vẽ', !rUnd.model.columns.some((c) => c.name === 'chua_khai'));

// ─────────────────────────────────────────────────────────────────────────────
// Chiều cao. Hai con số ở hai chỗ, và chọn nhầm là kéo vùng này nhưng vùng kia co lại.
const TALL = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkh">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã" e="Code"/></field>',
  '    <field name="ct" categoryIndex="1" rows="242">',
  '      <header v="Chi tiết" e="Detail"/><items style="Grid" controller="CT"/>',
  '    </field>',
  '    <field name="ghi_chu" categoryIndex="2"><header v="Ghi chú" e="Note"/></field>',
  '  </fields>',
  '  <view id="Dir" height="300">',
  '    <item value="100, 200"/>',
  '    <item value="11: [ma_kh].Label, [ma_kh]"/>',
  '    <item value="10: [ct]"/>',
  '    <item value="11: [ghi_chu].Label, [ghi_chu]"/>',
  '    <categories>',
  '      <category index="1" columns="300"><header v="Chi tiết" e="Detail"/></category>',
  '      <category index="2" columns="300"><header v="Ghi chú" e="Note"/></category>',
  '    </categories>',
  '  </view>',
  '</dir>',
].join(NL);
const tm = build(TALL).model;

section('chiều cao vùng main — view@height');
eq('đọc được chiều cao đang khai', tm.mainHeight, 300);
const vh = planViewHeight(tm, 420, TALL);
ok('lập được kế hoạch', vh.ok);
eq('ghi đè đúng giá trị cũ', TALL.slice(vh.splice.start, vh.splice.end), '300');
eq('giá trị mới', vh.splice.text, '420');
eq('đọc lại thấy 420', build(applyAndCheck('viewHeight', TALL, vh.splice)).model.mainHeight, 420);
ok('kéo về đúng số cũ thì không ghi gì', !planViewHeight(tm, 300, TALL).ok);
ok('số âm thì từ chối', !planViewHeight(tm, -10, TALL).ok);

// View chưa khai `height` thì phải CHÈN thuộc tính, không im lặng bỏ qua.
const NOH = TALL.replace('<view id="Dir" height="300">', '<view id="Dir">');
const vhNew = planViewHeight(build(NOH).model, 350, NOH);
ok('view chưa có height thì chèn mới', vhNew.ok);
eq('chèn đúng dạng thuộc tính', vhNew.splice.text, ' height="350"');
eq('đọc lại thấy 350', build(applyAndCheck('height mới', NOH, vhNew.splice)).model.mainHeight, 350);

section('chiều cao một tab có lưới — field@rows, KHÔNG phải view@height');
// Tab chứa lưới cao theo `rows` của chính field mang lưới; tab thường mới dùng view@height.
// Nhầm hai cái này là kéo tab «Chi tiết» nhưng mọi tab khác cùng co lại.
const fr = planFieldRows(tm, 'ct', 300, TALL);
ok('lập được kế hoạch', fr.ok);
eq('ghi đè đúng rows cũ', TALL.slice(fr.splice.start, fr.splice.end), '242');
const afterFr = applyAndCheck('fieldRows', TALL, fr.splice);
ok('view@height KHÔNG bị đụng', afterFr.includes('<view id="Dir" height="300">'));
ok('rows đã đổi', afterFr.includes('rows="300"'));

// Field thường chưa có `rows` thì chèn mới.
const frNew = planFieldRows(tm, 'ghi_chu', 180, TALL);
ok('field chưa có rows thì chèn mới', frNew.ok);
eq('chèn đúng dạng thuộc tính', frNew.splice.text, ' rows="180"');
ok('field không tồn tại thì từ chối', !planFieldRows(tm, 'khong_co', 100, TALL).ok);

section('anchor / split — ghi vào ĐÚNG thẻ đã khai vùng đó');
/*
 * Chỗ dễ sai nhất: dải header lấy hai con số từ `<view>`, còn mỗi tab lấy từ
 * `<category index="n">` của chính nó. Ghi nhầm sang `<view>` khi người dùng kéo marker trong
 * một tab là đổi anchor của cả form — mọi tab khác lệch theo mà không ai chạm vào chúng.
 */
const META = [
  '<dir table="t">',
  '  <fields>',
  '    <field name="a"><header v="A" e="A"/></field>',
  '    <field name="b" categoryIndex="2"><header v="B" e="B"/></field>',
  '  </fields>',
  '  <view id="Dir" anchor="2" split="3">',
  '    <item value="100, 80, 60, 40"/>',
  '    <item value="1100: [a].Label, [a]"/>',
  '    <item value="1100: [b].Label, [b]"/>',
  '    <categories>',
  '      <category index="2" columns="100, 80, 60, 40"><header v="Tab" e="Tab"/></category>',
  '    </categories>',
  '  </view>',
  '</dir>',
].join('\r\n');

const metaBuilt = build(META);

// Ghi đè giá trị đã khai trên `<view>`.
const anchorPlan = planRegionMetadata(metaBuilt.model, 'header', 'anchor', 3, META);
ok('lập được kế hoạch cho vùng header', anchorPlan.ok);
eq('ghi đè đúng giá trị cũ của view@anchor', META.slice(anchorPlan.splice.start, anchorPlan.splice.end), '2');
eq('giá trị mới', anchorPlan.splice.text, '3');
ok('splice nằm trong thẻ <view>, không phải <category>',
  META.slice(0, anchorPlan.splice.start).lastIndexOf('<view') > META.slice(0, anchorPlan.splice.start).lastIndexOf('<category'));

// Tab chưa khai `anchor` → chèn mới vào `<category>`, KHÔNG đụng `<view>`.
const catPlan = planRegionMetadata(metaBuilt.model, 'cat:2', 'anchor', 1, META);
ok('lập được kế hoạch cho một tab', catPlan.ok);
eq('chèn mới, không ghi đè', catPlan.splice.start, catPlan.splice.end);
eq('chèn đúng dạng thuộc tính', catPlan.splice.text, ' anchor="1"');
ok('chèn vào thẻ <category>, không phải <view>',
  META.slice(catPlan.splice.start - 20, catPlan.splice.start).includes('<category'));
// Áp thật rồi đọc lại: `<view anchor>` phải nguyên vẹn.
const afterCat = applySplices(META, [catPlan.splice]);
ok('view@anchor KHÔNG bị đụng', afterCat.includes('<view id="Dir" anchor="2" split="3">'));
ok('category nhận anchor mới', /<category anchor="1" index="2"|<category index="2" anchor="1"/.test(afterCat));

// `0` hợp lệ và có nghĩa «không neo» — runtime coi 0 như chưa khai.
ok('0 là giá trị hợp lệ', planRegionMetadata(metaBuilt.model, 'header', 'split', 0, META).ok);
// Ngoài dải cột thì từ chối: marker nằm ngoài bảng thì không vẽ ra và cũng không kéo lại được.
ok('vượt số cột thì từ chối', !planRegionMetadata(metaBuilt.model, 'header', 'anchor', 99, META).ok);
ok('số âm thì từ chối', !planRegionMetadata(metaBuilt.model, 'header', 'anchor', -1, META).ok);
ok('thuộc tính lạ thì từ chối', !planRegionMetadata(metaBuilt.model, 'header', 'height', 1, META).ok);
ok('vùng không tồn tại thì từ chối', !planRegionMetadata(metaBuilt.model, 'cat:99', 'anchor', 1, META).ok);
// Kéo về đúng chỗ cũ thì không có gì để ghi.
ok('không đổi thì không ghi', !planRegionMetadata(metaBuilt.model, 'header', 'anchor', 2, META).ok);


section('pattern LAI — entity nằm giữa pattern, sửa đúng vào vùng đó');
/*
 * Ca thật, rút gọn từ một controller có `&ExtraFields.Master.View.Split;`:
 *
 *   <item value="110&Split;-: [a].Label, [a], [b]"/>   với  <!ENTITY Split "10">
 *
 * Bung ra: pattern `11010-`. Ba ký tự đầu nằm trong controller, hai ký tự `10` đến từ khai báo
 * entity, ký tự cuối lại thuộc controller. Luật cũ («cả hàng phải khớp nguyên văn», rồi «pattern
 * phải khớp nguyên văn») chặn sạch mọi hàng như thế, dù phép sửa chỉ đổi MỘT ký tự.
 *
 * Ô thứ hai bắt đầu ở cột 3, span 2 — đuôi của nó là ký tự `0` NẰM TRONG entity. Tách nó về
 * span 1 thì phải ghi vào CHÍNH KHAI BÁO ENTITY, không phải vào thẻ <item>.
 */
const HYBRID = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [',
  '  <!ENTITY Split "10">',
  ']>',
  '<dir table="t">',
  '  <fields>',
  '    <field name="a"><header v="A" e="A"/></field>',
  '    <field name="b"><header v="B" e="B"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 90, 150, 80, 70"/>',
  '    <item value="110&Split;-: [a].Label, [a], [b]"/>',
  '  </view>',
  '</dir>',
].join(NL);

const hybrid = build(HYBRID);
const hRow = hybrid.model.rows.find((r) => r.index === 1);
eq('pattern bung ra từ hai nguồn', hRow.row.pattern, '11010-');
// Pattern `11010-` → ô0 ở cột 0, ô1 ở cột 1-2, ô2 ở cột 3-4, ô3 trống ở cột 5.
// Ô2 mới là ô có ĐUÔI nằm trong entity: `Split = "10"` chiếm đúng vị trí 3 và 4 của pattern.
eq('ô cần sửa đang span 2', hRow.cells[2].span, 2);
eq('và bắt đầu ở cột 3', hRow.cells[2].col, 3);

// Lấy đúng cái mà tầng vỏ sẽ lấy: file nào phải đọc để lập kế hoạch.
const splitOp = { kind: 'resize', item: 1, cell: 2, span: 1 };
eq('entity khai ở internal subset nên vẫn là file này',
  rowEditTargetFile(hybrid.model, splitOp), hybrid.file);

const hPlan = planRowEdit(hybrid.model, splitOp, HYBRID);
ok('tách được dù pattern có entity', hPlan.ok);
// Thứ quan trọng nhất: splice rơi vào KHAI BÁO ENTITY, không vào thẻ <item>.
ok('splice nằm trong <!ENTITY Split …>',
  HYBRID.lastIndexOf('<!ENTITY Split') < hPlan.splice.start
  && hPlan.splice.end < HYBRID.indexOf('<item value="110&Split;'));
eq('ghi đè đúng ký tự cũ', HYBRID.slice(hPlan.splice.start, hPlan.splice.end), '0');
eq('ký tự mới', hPlan.splice.text, '-');

const afterHybrid = applyAndCheck('tách ô trên pattern lai', HYBRID, hPlan.splice);
ok('khai báo entity đổi', afterHybrid.includes('<!ENTITY Split "1-">'));
// Tham chiếu `&Split;` còn nguyên, và ba ký tự `110` của controller cũng còn nguyên.
ok('thẻ <item> còn nguyên văn', afterHybrid.includes('<item value="110&Split;-: [a].Label, [a], [b]"/>'));
eq('đọc lại ra pattern đã tách',
  build(afterHybrid).model.rows.find((r) => r.index === 1).row.pattern, '1101--');

// GỘP thì ngược lại: ký tự `-` ở cuối thuộc CONTROLLER, nên splice rơi vào <item>.
const mergeOp = { kind: 'resize', item: 1, cell: 2, span: 3 };
const mPlan = planRowEdit(hybrid.model, mergeOp, HYBRID);
ok('gộp được', mPlan.ok);
ok('lần này splice rơi vào thẻ <item>', mPlan.splice.start > HYBRID.indexOf('<item value="110&Split;'));
const afterMerge = applyAndCheck('gộp ô trên pattern lai', HYBRID, mPlan.splice);
ok('khai báo entity KHÔNG bị đụng', afterMerge.includes('<!ENTITY Split "10">'));
eq('đọc lại ra pattern đã gộp',
  build(afterMerge).model.rows.find((r) => r.index === 1).row.pattern, '110100');

section('pattern lai — đoạn đổi vắt qua ranh giới entity thì TỪ CHỐI');
// Hai splice ở hai chỗ trong cùng một lần hoàn tác là thứ tầng vỏ chưa làm được. Ghi một nửa
// còn tệ hơn không ghi — nên nói thẳng ra thay vì ghi bừa.
/*
 * `10&Split;-` với `Split = "0-"` → pattern `10 0- -`, tức:
 *   vị trí 0,1 thuộc controller · 2,3 thuộc entity · 4 thuộc controller
 * Ô duy nhất bắt đầu ở cột 0 và trải 3 cột (cột 1 và 2 đều là `0`). Tách nó về 1 cột thì phải
 * đổi CẢ vị trí 1 (controller) LẪN vị trí 2 (entity) — một đoạn, hai file nguồn.
 */
const CROSS = HYBRID.replace('<!ENTITY Split "10">', '<!ENTITY Split "0-">')
  .replace('<item value="110&Split;-: [a].Label, [a], [b]"/>', '<item value="10&Split;-: [a]"/>');
const cross = build(CROSS);
eq('dựng đúng pattern lai để thử', cross.model.rows.find((r) => r.index === 1).row.pattern, '100--');
const crossPlan = planRowEdit(cross.model, { kind: 'resize', item: 1, cell: 0, span: 1 }, CROSS);
ok('từ chối, không ghi bừa', !crossPlan.ok);
ok('nói rõ vì sao', /ranh giới entity/.test(crossPlan.reason));

section('kéo cạnh TRÁI — ô nở sang trái, ký tự "1" dời chỗ');
// Không quy được về "kéo cạnh phải của ô liền trước": ô liền trước thường là ô TRỐNG, mà ô trống
// thì không có span để đổi — đúng ca thường gặp nhất khi túm cạnh trái.
const LEFT = [
  '<dir table="t">',
  '  <fields><field name="a"><header v="A" e="A"/></field></fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 90, 150"/>',
  '    <item value="--1-: [a]"/>',
  '  </view>',
  '</dir>',
].join(NL);
const left = build(LEFT);
const leftRow = left.model.rows.find((r) => r.index === 1);
const leftCell = leftRow.cells.findIndex((c) => !c.empty);
eq('ô đang bắt đầu ở cột 2', leftRow.cells[leftCell].col, 2);

const grew = planRowEdit(left.model, { kind: 'resize', item: 1, cell: leftCell, col: 0, side: 'left' }, LEFT);
ok('nở sang trái được', grew.ok);
eq('đọc lại: "1" đã dời về cột 0',
  build(applyAndCheck('nở sang trái', LEFT, grew.splice)).model.rows.find((r) => r.index === 1).row.pattern, '100-');

// Co từ trái: cạnh phải đứng yên, "1" dời sang phải, chỗ bỏ lại thành ô trống.
const WIDE = LEFT.replace('"--1-:', '"1000:');
const wide = build(WIDE);
const shrank = planRowEdit(wide.model, { kind: 'resize', item: 1, cell: 0, col: 2, side: 'left' }, WIDE);
ok('co từ trái được', shrank.ok);
eq('đọc lại: hai cột đầu thành trống',
  build(applyAndCheck('co từ trái', WIDE, shrank.splice)).model.rows.find((r) => r.index === 1).row.pattern, '--10');

// Nở vào ô đang có control thì TỪ CHỐI — cùng một luật với setSpan, không nuốt hộ.
const TWO = [
  '<dir table="t">',
  '  <fields><field name="a"><header v="A" e="A"/></field><field name="b"><header v="B" e="B"/></field></fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 90, 150"/>',
  '    <item value="1-1-: [a], [b]"/>',
  '  </view>',
  '</dir>',
].join(NL);
const twoBuilt = build(TWO);
const twoRow = twoBuilt.model.rows.find((r) => r.index === 1);
const secondCell = twoRow.cells.findIndex((c, i) => !c.empty && i > 0);
const blockedLeft = planRowEdit(twoBuilt.model, { kind: 'resize', item: 1, cell: secondCell, col: 0, side: 'left' }, TWO);
ok('không nuốt ô có control', !blockedLeft.ok);

/* ══════════════════════════════════════════════════════════════════════════
 * Thêm control cạnh một ô viết bằng entity — ca của chủ hệ thống, nguyên văn:
 *
 *   1111-: [&k;].Label, [&k;], [ma_kh_ref].Label, [ma_kh_ref]
 *
 * «Thêm control hoàn toàn không ảnh hưởng tới entity.» Đây là chỗ chốt điều đó bằng byte.
 * ══════════════════════════════════════════════════════════════════════════ */

section('thêm control — entity trong hàng phải sống sót từng ký tự');
const REF = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [<!ENTITY k "ma_kh">]>',
  '<dir table="dmkh" xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã khách" e="Code"/></field>',
  '    <field name="ma_kh_ref"><header v="Mã tham chiếu" e="Ref"/></field>',
  '    <field name="ghi_chu"><header v="Ghi chú" e="Note"/></field>',
  '  </fields>',
  '  <views><view id="Dir" columns="120,100,120,100,150">',
  '    <item value="120, 100, 120, 100, 150"/>',
  '    <item value="1111-: [&k;].Label, [&k;], [ma_kh_ref].Label, [ma_kh_ref]"/>',
  '  </view></views>',
  '</dir>',
].join('\r\n');
const refModel = build(REF);
const refRow = refModel.model.rows.find((r) => r.row.tokens.length > 2);

// Điều kiện của phép thử: trong file là `&k;`, bản đã bung là `ma_kh` — hai chuỗi KHÁC nhau.
ok('file và bản đã bung khác nhau thật',
  REF.slice(refRow.range.start, refRow.range.end) !== refRow.item.value);
ok('trong file vẫn là &k;', REF.slice(refRow.range.start, refRow.range.end).includes('[&k;]'));

const added = planRowEdit(refModel.model,
  { kind: 'insert', item: refRow.index, cell: 3, side: 'right', token: '[ghi_chu]' }, REF);
ok('thêm được, không còn bị khoá vì entity', added.ok);
eq('chuỗi ghi lại: pattern mở thêm một cột, token mới nối vào cuối',
  added.splice.text, '11111: [&k;].Label, [&k;], [ma_kh_ref].Label, [ma_kh_ref], [ghi_chu]');

// Đối chiếu trên VĂN BẢN SAU KHI ÁP, không chỉ trên chuỗi splice — đó mới là thứ nằm trên đĩa.
const afterAddRef = REF.slice(0, added.splice.start) + added.splice.text + REF.slice(added.splice.end);
eq('cả hai `&k;` còn nguyên', (afterAddRef.match(/&k;/g) || []).length, 2);
ok("khai báo entity không bị đụng", afterAddRef.includes('<!ENTITY k "ma_kh">'));
ok('không có `[ma_kh]` trần nào bị bung vào file', !afterAddRef.includes('[ma_kh]'));
ok('token không đụng tới giữ nguyên', afterAddRef.includes('[ma_kh_ref].Label, [ma_kh_ref]'));

section('thêm control — pattern viết bằng entity thì VẪN từ chối');
/*
 * Phép thêm GHI LẠI pattern (`-` thành `1`). Pattern viết bằng entity thì ghi lại là bung nó
 * thành chữ — đúng thứ tổn thất mà cả tầng này sinh ra để chặn. Token có entity thì không sao;
 * pattern có thì phải từ chối, và nói rõ chỗ phải sửa.
 */
const PAT = REF.replace('<!ENTITY k "ma_kh">', '<!ENTITY k "ma_kh"><!ENTITY P "1111-">')
  .replace('value="1111-:', 'value="&P;:');
const patModel = build(PAT);
const patRow = patModel.model.rows.find((r) => r.row.tokens.length > 2);
const patAdd = planRowEdit(patModel.model,
  { kind: 'insert', item: patRow.index, cell: 3, side: 'right', token: '[ghi_chu]' }, PAT);
ok('từ chối', !patAdd.ok);
ok('nói rõ vì sao là pattern chứ không phải token', patAdd.reason.includes('pattern'));

section('thêm HÀNG dưới một hàng dùng entity — cũng không bị khoá');
// Chèn hẳn một thẻ `<item>` mới thì không ghi đè ký tự nào của hàng cũ. Bắt hàng cũ phải khớp
// nguyên văn là khoá luôn cả thao tác chẳng liên quan gì tới `&k;`.
const rowAdd = planAddRow(refModel.model,
  { kind: 'addRow', item: refRow.index, side: 'below', token: '[ghi_chu]' }, REF, refRow.itemRange);
ok('thêm hàng được', rowAdd.ok);
ok('là phép CHÈN, không ghi đè', rowAdd.splice.start === rowAdd.splice.end);
ok('hàng cũ không bị đụng', rowAdd.splice.text.includes('[ghi_chu]') && !rowAdd.splice.text.includes('&k;'));

/* ══════════════════════════════════════════════════════════════════════════
 * DỜI control sang slot khác — kéo thả.
 * ══════════════════════════════════════════════════════════════════════════ */

section('dời control — span đi theo, token đi nguyên xi');
const MOVE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [<!ENTITY k "ma_kh">]>',
  '<dir table="dmkh" xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã khách" e="Code"/></field>',
  '    <field name="ten_kh"><header v="Tên khách" e="Name"/></field>',
  '  </fields>',
  '  <views><view id="Dir" columns="100,100,100,100,100">',
  '    <item value="100, 100, 100, 100, 100"/>',
  '    <item value="10--1: [&k;].Label, [ten_kh]"/>',
  '  </view></views>',
  '</dir>',
].join('\r\n');
const moveModel = build(MOVE);
const moveRow = moveModel.model.rows.find((r) => r.row.tokens.length === 2);
eq('bố cục ban đầu', moveRow.row.pattern, '10--1');

// Ô 0 trải 2 cột (`10`). Dời sang cột 2 → `--10 1`… tức `--101` sau khi ghép.
const moved = planRowEdit(moveModel.model, { kind: 'move', item: moveRow.index, cell: 0, col: 2 }, MOVE);
ok('dời được', moved.ok);
eq('pattern: nguồn thành trống, đích mở `10`', moved.splice.text.split(':')[0], '--101');
ok('token giữ nguyên văn entity', moved.splice.text.includes('[&k;].Label'));
ok('không bung entity ra chữ', !moved.splice.text.includes('[ma_kh]'));
// Thứ tự token phải theo thứ tự CỘT: `ten_kh` ở cột 4 nay đứng sau `&k;` ở cột 2.
eq('thứ tự token khớp thứ tự cột', moved.splice.text, '--101: [&k;].Label, [ten_kh]');

section('dời control — ô đích đang có control thì TỪ CHỐI');
/*
 * Bố cục `10--1`: ô 0 ở cột 0 trải 2, hai ô trống ở cột 2 và 3, ô 3 ở cột 4 trải 1.
 * Chỉ số Ô khác chỉ số CỘT — ô trống cũng được đánh số, nên `cell 2` là ô trống ở cột 3.
 */
const onEmpty = planRowEdit(moveModel.model, { kind: 'move', item: moveRow.index, cell: 2, col: 2 }, MOVE);
ok('ô trống thì không có gì để dời', !onEmpty.ok);
ok('nói rõ lý do', onEmpty.reason.includes('không có gì để dời'));

// Dời `ten_kh` (ô 3, cột 4, span 1) về cột 2 — chỗ trống, đi được.
const back = planRowEdit(moveModel.model, { kind: 'move', item: moveRow.index, cell: 3, col: 2 }, MOVE);
ok('dời được', back.ok);
// Thứ tự token vẫn theo thứ tự CỘT: `&k;` ở cột 0 đứng trước `ten_kh` ở cột 2.
eq('token đúng thứ tự cột', back.splice.text, '101--: [&k;].Label, [ten_kh]');
ok('entity vẫn nguyên văn', back.splice.text.includes('[&k;]'));

section('dời control — vượt khỏi hàng thì TỪ CHỐI, không tự co span');
/*
 * Ô 0 trải 2 cột. Dời nó tới cột cuối (index 4) thì cần cột 4 và 5, mà hàng chỉ có 5 cột.
 * TỪ CHỐI chứ không bóp về span 1: người dùng kéo một control, họ không ngầm yêu cầu thu nhỏ nó.
 */
const over = planRowEdit(moveModel.model, { kind: 'move', item: moveRow.index, cell: 0, col: 4 }, MOVE);
ok('từ chối', !over.ok);
ok('nói rõ là vượt hàng, kèm span', over.reason.includes('trải 2 cột vượt khỏi hàng'));

// Dời về đúng chỗ cũ không phải một thay đổi.
const same = moveCell(moveRow.row, moveRow.widths, 0, 0, { allowEntity: true });
ok('dời về chính chỗ cũ → không có gì thay đổi', !same.ok && same.reason.includes('không có gì thay đổi'));

// Vùng đích CHỒNG vùng nguồn (dời một nấc) phải đi được — nếu kiểm trên pattern chưa xoá nguồn
// thì mọi cú dời một nấc đều tự đụng vào chính mình rồi bị từ chối.
const nudge = moveCell(moveRow.row, moveRow.widths, 0, 1, { allowEntity: true });
ok('dời một nấc sang phải được', nudge.ok);
// Ô 0 (`10` ở cột 0-1) trượt sang cột 1-2; ô ở cột 4 đứng yên → `-10-1`.
eq('pattern trượt đúng một cột', nudge.row.pattern, '-10-1');

section('dời control — phần ngoài splice không đổi một byte');
applyAndCheck('move', MOVE, moved.splice);

/* ══════════════════════════════════════════════════════════════════════════
 * ĐỔI CHỖ hai control — hoán vị; cùng span thì pattern đứng yên, khác span thì
 * mỗi token giữ span gốc (thu về min với slot đích).
 * ══════════════════════════════════════════════════════════════════════════ */

section('đổi chỗ — hai ô cùng span thì token hoán vị, pattern không đổi một ký tự');
const SWAP = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [<!ENTITY k "ma_kh">]>',
  '<dir table="dmkh" xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã khách" e="Code"/></field>',
  '    <field name="ten_kh"><header v="Tên khách" e="Name"/></field>',
  '    <field name="ngay_ct"><header v="Ngày" e="Date"/></field>',
  '  </fields>',
  '  <views><view id="Dir" columns="100,100,100,100,100">',
  '    <item value="100, 100, 100, 100, 100"/>',
  '    <item value="1-1-1: [&k;], [ten_kh], [ngay_ct]"/>',
  '  </view></views>',
  '</dir>',
].join('\r\n');
const swapModel = build(SWAP);
const swapRow = swapModel.model.rows.find((r) => r.row.tokens.length === 3);
eq('bố cục ban đầu', swapRow.row.pattern, '1-1-1');

// Ô 0 (cột 0) và ô 2 (cột 2) — chỉ số Ô đếm cả ô trống, nên ô 1 là ô trống ở cột 1.
const swapped = planRowEdit(swapModel.model, { kind: 'swap', item: swapRow.index, cell: 0, other: 2 }, SWAP);
ok('đổi chỗ được', swapped.ok);
eq('PATTERN không đổi', swapped.splice.text.split(':')[0], '1-1-1');
eq('đúng hai token hoán vị, token thứ ba đứng yên', swapped.splice.text, '1-1-1: [ten_kh], [&k;], [ngay_ct]');
ok('token giữ nguyên văn entity', swapped.splice.text.includes('[&k;]'));
ok('không bung entity ra chữ', !swapped.splice.text.includes('[ma_kh]'));

// Đổi chỗ hai ô KHÔNG kề nhau cũng đi được — «gần nhau» là chuyện của thanh lệnh, không phải
// của phép sửa.
const farSwap = planRowEdit(swapModel.model, { kind: 'swap', item: swapRow.index, cell: 0, other: 4 }, SWAP);
ok('đổi chỗ ô đầu với ô cuối được', farSwap.ok);
eq('token đầu và cuối hoán vị', farSwap.splice.text, '1-1-1: [ngay_ct], [ten_kh], [&k;]');

section('đổi chỗ — khác span: giữ span gốc của token, thu về min(slot đích)');
/*
 * `10--1`: ô 0 trải 2 cột, ô 3 (cột 4) trải 1.
 * Token span-2 sang slot 1 → thu về 1; token span-1 sang slot 2 → giữ 1; phần dư thành trống.
 * Pattern: `10--1` → `1---1`.
 */
const diffSpan = planRowEdit(moveModel.model, { kind: 'swap', item: moveRow.index, cell: 0, other: 3 }, MOVE);
ok('đổi chỗ khác span được', diffSpan.ok, diffSpan.reason);
eq('pattern thu về min span', diffSpan.ok ? diffSpan.splice.text.split(':')[0] : null, '1---1');
eq('hai token hoán vị, mỗi bên giữ/thu đúng span', diffSpan.ok ? diffSpan.splice.text : null,
  '1---1: [ten_kh], [&k;].Label');

section('đổi chỗ — ma_kh@2 ↔ dien_giai@9 → cả hai về 2, phần dư thành trống');
const WIDE_SWAP = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkh" xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã" e="Code"/></field>',
  '    <field name="dien_giai"><header v="Diễn giải" e="Desc"/></field>',
  '  </fields>',
  '  <views><view id="Dir">',
  '    <item value="100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100"/>',
  '    <item value="10100000000: [ma_kh], [dien_giai]"/>',
  '  </view></views>',
  '</dir>',
].join('\r\n');
const wideSwapModel = build(WIDE_SWAP);
const wideSwapRow = wideSwapModel.model.rows.find((r) => r.row.tokens.length === 2);
eq('bố cục ma_kh@2 + dien_giai@9', wideSwapRow.row.pattern, '10100000000');
const wideSwapped = planRowEdit(
  wideSwapModel.model,
  { kind: 'swap', item: wideSwapRow.index, cell: 0, other: 1 },
  WIDE_SWAP,
);
ok('đổi chỗ được', wideSwapped.ok, wideSwapped.reason);
eq('cả hai về span 2, dư thành trống', wideSwapped.ok ? wideSwapped.splice.text : null,
  '1010-------: [dien_giai], [ma_kh]');

section('đổi chỗ — ô trống và chính nó thì TỪ CHỐI');
const swapEmpty = swapCells(swapRow.row, swapRow.widths, 0, 1, { allowEntity: true });
ok('ô trống không có control để đổi chỗ', !swapEmpty.ok && swapEmpty.reason.includes('ô trống'));
const swapSelf = swapCells(swapRow.row, swapRow.widths, 0, 0, { allowEntity: true });
ok('đổi chỗ với chính mình → không có gì thay đổi', !swapSelf.ok && swapSelf.reason.includes('không có gì thay đổi'));
const swapGone = swapCells(swapRow.row, swapRow.widths, 0, 99, { allowEntity: true });
ok('ô không tồn tại thì nói rõ', !swapGone.ok && swapGone.reason.includes('không có ô thứ 99'));

section('đổi chỗ — phần ngoài splice không đổi một byte');
applyAndCheck('swap', SWAP, swapped.splice);

// ─────────────────────────────────────────────────────────────────────────────
// Hàng rỗng · xoá cả cụm control · phân giải entity vào file thiết kế
// ─────────────────────────────────────────────────────────────────────────────

section('xoá control cuối cùng của hàng thì bỏ luôn thẻ <item>');
// Một `<item value="----: "/>` không token nào vẫn chiếm một hàng trên form — người dùng nhìn
// thấy khoảng trắng không giải thích được. Xoá hàng là thứ họ đang yêu cầu, chỉ chưa nói ra.
const dropDoc = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kho"><header v="Mã kho" e="Code"/></field>',
  '    <field name="ten_kho"><header v="Tên kho" e="Name"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 90, 150"/>',
  '    <item value="1---: [ma_kho]"/>',
  '    <item value="11--: [ten_kho].Label, [ten_kho]"/>',
  '  </view>',
  '</dir>',
].join(NL);
const dropBase = build(dropDoc);
const lonely = dropBase.model.rows.find((r) => r.row.tokens.length === 1);
const dropPlan = planRowEdit(dropBase.model, { kind: 'remove', item: lonely.index, cell: 0 }, dropDoc);
ok('lập được kế hoạch', dropPlan.ok);
ok('báo cho tầng vỏ biết là hàng đã đi', dropPlan.rowRemoved === true);
const afterDrop = applyAndCheck('xoá hàng rỗng', dropDoc, dropPlan.splice);
ok('thẻ <item> của hàng đó biến mất', !afterDrop.includes('[ma_kho]'));
ok('không để lại dòng trắng', !/\r\n\s*\r\n\s*<item value="11--/.test(afterDrop));
eq('view còn đúng một hàng control', build(afterDrop).model.rows.length, 1);
ok('hàng còn lại nguyên vẹn', afterDrop.includes('<item value="11--: [ten_kho].Label, [ten_kho]"/>'));

// Ngược lại: hàng còn token khác thì CHỈ ghi lại value, thẻ giữ nguyên.
const keepPlan = planRowEdit(dropBase.model,
  { kind: 'remove', item: dropBase.model.rows[1].index, cell: 0 }, dropDoc);
ok('hàng còn token thì không bỏ thẻ', keepPlan.ok && keepPlan.rowRemoved !== true);
ok('và splice nhắm vào value chứ không vào cả thẻ',
  dropDoc.slice(keepPlan.splice.start, keepPlan.splice.end).startsWith('11--'));

section('Shift+Delete — control đi cùng Label, Footer, Description của nó');
// Ba kind ấy chỉ tô điểm cho ô Input; để chúng ở lại là để lại nhãn trỏ vào hư không.
const clusterDoc = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kho"><header v="Mã kho" e="Code"/></field>',
  '    <field name="ten_kho"><header v="Tên kho" e="Name"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 90, 150"/>',
  '    <item value="1100: [ma_kho].Label, [ma_kho]"/>',
  '    <item value="-1--: [ma_kho].Description"/>',
  '    <item value="11--: [ten_kho].Label, [ten_kho]"/>',
  '    <item value="1---: [ma_kho].Footer"/>',
  '  </view>',
  '</dir>',
].join(NL);
const cluster = build(clusterDoc);
const inputRow = cluster.model.rows.find((r) => r.row.tokens.some((t) => t.field === 'ma_kho' && t.kind === 'input'));
const inputCell = inputRow.cells.findIndex((c) => c.token?.field === 'ma_kho' && c.token.kind === 'input');

const solo = planRemoveControl(cluster.model, { item: inputRow.index, cell: inputCell }, () => clusterDoc);
ok('không giữ Shift thì chỉ một hàng bị đụng', solo.ok && solo.edits.length === 1);

const whole = planRemoveControl(cluster.model,
  { item: inputRow.index, cell: inputCell, companions: true }, () => clusterDoc);
ok('giữ Shift thì lập được kế hoạch', whole.ok);
eq('đụng đúng ba hàng: ô nhập, Description, Footer', whole.edits.length, 3);
eq('nói ra field đang xoá', whole.fieldName, 'ma_kho');
const afterCluster = applySplices(clusterDoc, whole.edits);
ok('mọi token của ma_kho biến mất', !afterCluster.includes('[ma_kho]'));
ok('Description đi theo', !afterCluster.includes('.Description'));
ok('Footer đi theo', !afterCluster.includes('.Footer'));
ok('hàng chỉ có Description bị bỏ hẳn thẻ', !/-1--/.test(afterCluster));
ok('hàng của ten_kho không bị đụng', afterCluster.includes('<item value="11--: [ten_kho].Label, [ten_kho]"/>'));
// `.Label` cùng hàng với ô nhập → hàng ấy rỗng, thẻ phải đi luôn.
eq('view chỉ còn hàng ten_kho', build(afterCluster).model.rows.length, 1);

// Bấm Shift trên chính ô `.Label` thì KHÔNG kéo theo cả cụm — người dùng nhắm vào cái nhãn.
const labelCell = inputRow.cells.findIndex((c) => c.token?.kind === 'label');
const onLabel = planRemoveControl(cluster.model,
  { item: inputRow.index, cell: labelCell, companions: true }, () => clusterDoc);
ok('Shift trên .Label chỉ xoá đúng nó', onLabel.ok && onLabel.edits.length === 1);
const afterLabel = applySplices(clusterDoc, onLabel.edits);
ok('ô nhập vẫn còn', /<item value="-1--: \[ma_kho\]"\/>|\[ma_kho\]/.test(afterLabel));

section('planInlineEntity — comment dòng &Name;, chèn bản đã bung ngay dưới');
// Đây là lối thoát cho «tôi muốn sửa hàng này, nhưng nó khai ở Include dùng chung»: chỉ
// controller NÀY đổi, Include giữ nguyên cho mọi controller khác.
const hostText = [
  '<dir>',
  '  <view id="Dir">',
  '    <item value="100, 60"/>',
  '    &Rows.Extra;',
  '    <item value="1-: [x]"/>',
  '  </view>',
  '</dir>',
].join(NL);
const refAt = hostText.indexOf('&Rows.Extra;');
const inline = planInlineEntity(hostText, { start: refAt, end: refAt + '&Rows.Extra;'.length },
  '    <item value="11: [a].Label, [a]"/>');
ok('lập được kế hoạch', inline.ok);
const afterInline = applyAndCheck('planInlineEntity', hostText, inline.splice);
ok('tham chiếu cũ được COMMENT, không xoá', afterInline.includes('<!-- &Rows.Extra; -->'));
ok('bản đã bung nằm ngay dưới', afterInline.includes(`<!-- &Rows.Extra; -->${NL}    <item value="11: [a].Label, [a]"/>`));
ok('giữ CRLF của file', !/[^\r]\n/.test(afterInline));
ok('thụt lề của dòng comment bằng dòng cũ', afterInline.includes(`${NL}    <!-- &Rows.Extra; -->`));
ok('hàng phía sau không bị đụng', afterInline.includes('<item value="1-: [x]"/>'));

// Dòng còn nội dung khác thì TỪ CHỐI: comment cả dòng là tắt luôn phần kia, hỏng im lặng.
const mixed = '<view>\r\n    <item value="1"/>&K;\r\n</view>';
const mixedAt = mixed.indexOf('&K;');
ok('dòng lẫn nội dung khác thì từ chối',
  !planInlineEntity(mixed, { start: mixedAt, end: mixedAt + 3 }, '<item/>').ok);
// Offset lệch (file đã đổi) thì cũng từ chối, không ghi bừa.
ok('dải không phải &…; thì từ chối', !planInlineEntity(hostText, { start: 0, end: 5 }, '<item/>').ok);
ok('bung ra rỗng thì từ chối',
  !planInlineEntity(hostText, { start: refAt, end: refAt + '&Rows.Extra;'.length }, '   \r\n  ').ok);

section('refResolvedSpan — dải clearText mà MỘT tham chiếu &Name; đẻ ra');
// Không có nó thì «phân giải vào file thiết kế» phải đoán xem chèn cái gì.
const INC = 'C:/P/App_Data/Controllers/Include/Extra.ent';
const withEnt = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [',
  `<!ENTITY Rows.Extra SYSTEM "../Include/Extra.ent">`,
  ']>',
  '<dir>',
  '  <fields>',
  '    <field name="a"><header v="A" e="A"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60"/>',
  '    &Rows.Extra;',
  '  </view>',
  '</dir>',
].join(NL);
const INC_TEXT = '<item value="11: [a].Label, [a]"/>';
const exWith = expandEntities(withEnt, {
  filePath: 'C:/P/App_Data/Controllers/Dir/Kho.xml',
  readFile: (abs) => (abs.replace(/\\/g, '/').toLowerCase() === INC.toLowerCase() ? INC_TEXT : null),
});
const atInc = exWith.clearText.indexOf('[a].Label');
const span = refResolvedSpan(exWith.segments, atInc);
ok('tìm được tham chiếu đã sinh ra đoạn này', span !== null);
eq('bản bung đúng bằng nội dung file Include', exWith.clearText.slice(span.start, span.end), INC_TEXT);
eq('ref trỏ về đúng dòng &Name; trong controller',
  withEnt.slice(span.ref.start, span.ref.end), '&Rows.Extra;');
// Đoạn thuộc chính controller thì không có tham chiếu nào — đừng bịa ra một cái.
eq('đoạn của chính file chủ không có ref',
  refResolvedSpan(exWith.segments, exWith.clearText.indexOf('<fields>')), null);

section('khai báo <field> nhiều thẻ con thì xuống dòng, đúng như corpus viết');
// Field chỉ có `<header>` luôn nằm gọn một dòng; có thêm `<items>` thì luôn tách dòng. Sinh ra
// một dòng dài `<field …><header …/><items …/></field>` là thứ không giống dòng nào quanh nó.
const oneChild = buildField('textbox', 'ma_kh', 'Mã khách');
ok('một thẻ con → một dòng', !oneChild.xml.includes('\n'));
const manyChild = buildField('numeric', 't_tien', 'Tiền');
ok('nhiều thẻ con → nhiều dòng', manyChild.xml.includes('\n'));
eq('bố cục đúng ba tầng', manyChild.xml.split('\n').length, 4);
ok('thẻ con thụt vào', manyChild.xml.includes('\n  <items style="Numeric"/>'));

const declMulti = planAddField(DOC, manyChild.xml, 't_tien');
ok('planAddField nhận được XML nhiều dòng', declMulti.ok);
const afterMulti = applyAndCheck('planAddField nhiều dòng', DOC, declMulti.splice);
ok('mọi dòng đều kê theo thụt lề của file', afterMulti.includes(`${NL}    <field name="t_tien"`)
  && afterMulti.includes(`${NL}      <items style="Numeric"/>`)
  && afterMulti.includes(`${NL}    </field>`));
ok('vẫn dùng CRLF như file', !/[^\r]\n/.test(afterMulti));
eq('đọc lại thấy field mới', build(afterMulti).model.fieldByName.has('t_tien'), true);

section('cột lưới khai `width`, ô của form thì KHÔNG');
/*
 * Hai định dạng khác nhau ở đúng chỗ này. Cột lưới có bề rộng RIÊNG ở `<field width="N">`; không
 * khai thì runtime tự cho 100px — con số vẫn tồn tại, chỉ nằm ở chỗ không ai đọc được. Ô của
 * form thì lấy px từ list cột của vùng (`<item value="100, 60, …">`), nên sinh `width` cho nó là
 * khai một con số runtime bỏ qua, mà người đọc file sau này lại tin.
 */
const formField = buildField('textbox', 'ma_vt', 'Mã vật tư');
ok('form: không có width', !formField.xml.includes('width='));

const gridField = buildField('textbox', 'ma_vt', 'Mã vật tư', null, { width: 100 });
eq('lưới: width đứng ngay sau name, đúng chỗ corpus đặt', gridField.xml,
  '<field name="ma_vt" width="100"><header v="Mã vật tư" e="Mã vật tư"/></field>');

// Kiểu có `<items>` vẫn xuống dòng như thường — `width` không đổi cách trình bày.
const gridNum = buildField('numeric', 'so_luong', 'Số lượng', null, { width: 80 });
ok('lưới + items: width vẫn ở thẻ mở', gridNum.xml.startsWith('<field name="so_luong" width="80" type="Decimal"'));
ok('và vẫn xuống dòng', gridNum.xml.includes('\n  <items style="Numeric"/>'));

eq('width 0 là hợp lệ — cột khoá kỹ thuật khai đúng như vậy',
  buildField('textbox', 'stt_rec', '', null, { width: 0 }).xml,
  '<field name="stt_rec" width="0"><header v="stt_rec" e="stt_rec"/></field>');
// Giá trị hỏng thì BỎ QUA chứ không ghi ra `width="NaN"` — thà thiếu còn hơn sai.
ok('width không phải số thì bỏ qua', !buildField('textbox', 'x', 'X', null, { width: 'to' }).xml.includes('width='));
ok('width âm cũng bỏ qua', !buildField('textbox', 'x', 'X', null, { width: -5 }).xml.includes('width='));
