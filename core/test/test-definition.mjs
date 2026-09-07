// test-definition.mjs — «con trỏ đang đứng trên cái gì» (nửa thuần của F12).
//
// Nửa này chỉ nhìn văn bản thô tại một offset, nên nó test được với hàng chục ca BIÊN — và ca
// biên mới là chỗ một provider «đi tới định nghĩa» sống hay chết. Nhận quá rộng thì F12 nhảy
// lung tung ở những chỗ không nên nhảy; nhận quá hẹp thì người dùng bấm đúng chỗ mà không có
// gì xảy ra, và không có thông báo nào để hiểu vì sao.
//
// Quy ước xuyên suốt: đứng trên chính ĐỊNH NGHĨA thì trả `null`. Nhảy từ một định nghĩa tới
// chính nó là một cú nhảy không đi đâu cả.

import { ok, eq, section } from './harness.mjs';
import { definitionTargetAt, fieldDeclarationSpan, completionContextAt } from '../src/definition.mjs';

const NL = '\r\n';
const XML = [
  '<?xml version="1.0"?>',
  '<!DOCTYPE dir [',
  '  <!ENTITY Rows SYSTEM "../Include/R.ent">',
  '  <!ENTITY Nhan "Mã khách">',
  ']>',
  '<dir table="dmkh">',
  '  <fields>',
  '    <field name="ma_kh"><header v="&Nhan;" e="Code"/></field>',
  '    <field name="ten_kh"><header v="Tên" e="Name"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 90"/>',
  '    <item value="110: [ma_kh].Label, [ma_kh]"/>',
  '    &Rows;',
  '  </view>',
  '</dir>',
].join(NL);

/** Nhắm vào offset thứ `off` KỂ TỪ lần xuất hiện thứ `nth` của `needle`. */
function at(needle, off = 0, nth = 0) {
  let i = -1;
  for (let k = 0; k <= nth; k++) i = XML.indexOf(needle, i + 1);
  return definitionTargetAt(XML, i + off);
}
const cut = (r) => (r ? XML.slice(r.start, r.end) : null);

section('definition — &Name; tham chiếu');
const ref = at('&Rows;', 2);
eq('loại', ref.kind, 'entity');
eq('tên', ref.name, 'Rows');
eq('dải trùm cả tham chiếu', cut(ref), '&Rows;');
// Đứng ở MỌI vị trí trong tham chiếu đều phải nhận ra — người dùng không nhắm vào giữa chữ.
for (let k = 0; k <= '&Rows;'.length; k++) {
  ok(`vị trí ${k} trong &Rows; đều nhận`, at('&Rows;', k)?.kind === 'entity');
}
/*
 * `&Nhan;` nằm trong một THUỘC TÍNH (`<header v="&Nhan;">`), không phải ở chỗ kéo hàng vào —
 * vẫn là tham chiếu, vẫn phải nhảy được. Đây là ca hay gặp thật: nhãn dùng chung khai một lần
 * ở Include rồi mọi controller tham chiếu tới.
 *
 * Nó xuất hiện đúng MỘT lần trong fixture — khai báo là `<!ENTITY Nhan …>`, không có dấu `&`.
 */
eq('tham chiếu trong thuộc tính cũng nhảy được', at('&Nhan;', 2)?.name, 'Nhan');

section('definition — đường dẫn SYSTEM trong khai báo');
const sys = at('../Include/R.ent', 4);
eq('loại', sys.kind, 'system');
eq('đường dẫn', sys.path, '../Include/R.ent');
eq('dải là đường dẫn sạch, không gồm dấu nháy', cut(sys), '../Include/R.ent');
/*
 * Chỉ trong INTERNAL SUBSET. Ngoài đó `SYSTEM "…"` chỉ là văn bản bình thường, và biến một
 * chuỗi bất kỳ thành cú nhảy tới file là mời người ta bấm F12 vào hư không.
 */
const OUTSIDE = '<dir><item value="SYSTEM &quot;../x.ent&quot;"/></dir>';
eq('ngoài subset thì không nhận', definitionTargetAt(OUTSIDE, OUTSIDE.indexOf('../x.ent') + 2), null);

section('definition — token [field] trong item value');
const tok = at('[ma_kh].Label', 3);
eq('loại', tok.kind, 'field');
eq('tên field', tok.name, 'ma_kh');
eq('dải trùm cả token', cut(tok), '[ma_kh].Label');
// Đứng trên phần hậu tố `.Label` vẫn là đứng trên token ấy.
eq('trên .Label vẫn ra field', at('[ma_kh].Label', 9)?.name, 'ma_kh');
// Token thứ hai của cùng một hàng phải ra CHÍNH nó, không phải token đầu — đây là chỗ `at`/`len`
// của `parseRow` chứng minh giá trị: dò lại bằng tay thì hai token trùng văn bản cho cùng kết quả.
const second = definitionTargetAt(XML, XML.indexOf('[ma_kh]', XML.indexOf('[ma_kh].Label') + 5) + 3);
eq('token thứ hai nhận đúng chính nó', cut(second), '[ma_kh]');
ok('và là một dải KHÁC token đầu', second.start !== tok.start);

section('definition — nơi KHÔNG có gì để nhảy tới');
// Đứng trên chính khai báo: đó ĐÃ LÀ định nghĩa.
eq('trên <field name="ma_kh"> trả null', at('<field name="ma_kh"', 14), null);
// Khai báo entity: tên `Rows` trong `<!ENTITY Rows` không phải tham chiếu.
eq('trên tên trong <!ENTITY Rows> trả null', at('<!ENTITY Rows', 10), null);
eq('trên list px trả null', at('100, 60, 90', 2), null);
eq('trên pattern của hàng trả null', at('110: [ma_kh]', 1), null);
eq('trên khoảng trắng trả null', at('<view id="Dir">', -1), null);

section('definition — offset lạ không làm nó ném');
for (const bad of [-1, XML.length + 1, NaN, Infinity, null, undefined, 'x']) {
  eq(`offset ${String(bad)} → null`, definitionTargetAt(XML, bad), null);
}
eq('văn bản rỗng', definitionTargetAt('', 0), null);
eq('văn bản null', definitionTargetAt(null, 0), null);

section('definition — cột của lưới trỏ về khai báo field');
const GRID = [
  '<grid table="svtran" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields><field name="ma_kh" width="80"><header v="KH" e="C"/></field></fields>',
  '  <views><view id="Grid"><field name="ma_kh"/></view></views>',
  '</grid>',
].join(NL);
// Thẻ `<field name="ma_kh"/>` trong `<view>` là một THAM CHIẾU (liệt kê cột), khác hẳn thẻ cùng
// tên trong `<fields>` vốn là khai báo. Phải phân biệt được, nếu không thì F12 hoặc không chạy
// trong view, hoặc chạy cả ở chỗ không nên.
const inView = definitionTargetAt(GRID, GRID.lastIndexOf('name="ma_kh"') + 8);
eq('cột của view ra field', inView?.kind, 'field');
eq('tên đúng', inView?.name, 'ma_kh');
eq('trong <fields> thì vẫn null', definitionTargetAt(GRID, GRID.indexOf('name="ma_kh"') + 8), null);

section('definition — thứ đã comment thì không nhảy');
// Cùng luật với mọi bộ quét khác: một tham chiếu đã comment là một tham chiếu KHÔNG tồn tại.
const CMT = XML.replace('    &Rows;', '    <!-- &Rows; -->');
eq('tham chiếu trong comment trả null', definitionTargetAt(CMT, CMT.indexOf('&Rows;') + 2), null);

section('definition — dải khai báo của một field');
const span = fieldDeclarationSpan(XML, 'ten_kh');
// Đích của cú nhảy là chính CÁI TÊN, không phải cả thẻ: con trỏ đặt đúng chỗ, không bôi đen
// mấy dòng rồi bắt người ta tự tìm.
eq('trỏ đúng vào tên', XML.slice(span.start, span.end), 'ten_kh');
eq('field không có thì null', fieldDeclarationSpan(XML, 'khong_co'), null);

section('completion — bối cảnh gợi ý field');
/*
 * Nhận ra bằng cách nhìn LÙI từ con trỏ, không bằng cách phân tích cả tài liệu: người dùng đang
 * gõ dở thì tài liệu KHÔNG hợp lệ, và một bộ phân tích đòi hỏi hợp lệ sẽ im lặng đúng vào lúc
 * người ta cần gợi ý nhất.
 */
const CV = '<dir><view id="V"><item value="11: [ma_kh].Label, [ma_"/></view></dir>';
const cc = (off) => completionContextAt(CV, off);

const dangGo = cc(CV.indexOf('[ma_"') + 4);
eq('đang gõ dở → gợi ý field', dangGo.kind, 'field');
eq('phần đã gõ', dangGo.prefix, 'ma_');
/*
 * Dải thay thế tính TỪ dấu `[`, không từ con trỏ. Không tính thì VS Code chèn thêm vào sau phần
 * đã gõ và ra `[ma_[ma_kh]` — lỗi nhìn thấy ngay nhưng chỉ khi bấm chọn, tức là sau khi tính
 * năng đã có vẻ chạy.
 */
eq('thay thế từ dấu ngoặc mở', CV.slice(dangGo.replaceStart, dangGo.replaceEnd), '[ma_');

const ngaySau = cc(CV.indexOf('[ma_kh].Label') + 1);
eq('ngay sau dấu ngoặc cũng gợi ý', ngaySau.kind, 'field');
eq('chưa gõ gì thì prefix rỗng', ngaySau.prefix, '');

section('completion — chỗ KHÔNG được gợi ý field');
// Ngoài token: `]` đã đóng, `,` và `:` là ranh giới.
eq('trên pattern', cc(CV.indexOf('11: ') + 1), null);
eq('sau dấu ngoặc đã đóng', cc(CV.indexOf('].Label') + 3), null);
// Ngoài `<item value>` hoàn toàn.
eq('ngoài item value', cc(CV.indexOf('id="V"') + 4), null);
eq('trong <dir> trần', cc(3), null);

section('completion — bối cảnh gợi ý entity');
const e1 = completionContextAt('x &Ro', 5);
eq('loại', e1.kind, 'entity');
eq('phần đã gõ', e1.prefix, 'Ro');
eq('thay thế từ dấu &', e1.replaceStart, 2);
eq('chỉ mới gõ dấu &', completionContextAt('x &', 3).prefix, '');
// Khoảng trắng cắt đứt: `& Ro` không phải một tham chiếu đang gõ dở.
eq('khoảng trắng cắt đứt', completionContextAt('x & Ro', 6), null);
eq('không có dấu & nào', completionContextAt('xin chao', 8), null);
// Entity thắng field khi cả hai cùng khớp — `&` nằm gần con trỏ hơn.
const both = '<dir><view id="V"><item value="1: [&Ro"/></view></dir>';
eq('trong token mà đang gõ entity thì ra entity', completionContextAt(both, both.indexOf('&Ro') + 3).kind, 'entity');

section('completion — offset lạ không làm nó ném');
for (const bad of [-1, CV.length + 1, NaN, null, undefined, 'x']) {
  eq(`offset ${String(bad)} → null`, completionContextAt(CV, bad), null);
}
eq('văn bản rỗng', completionContextAt('', 0), null);

section('definition — hover nhận thêm ca đứng trên chính khai báo');
const DECL = '<dir><fields><field name="ma_kh"/></fields><view id="V"/></dir>';
const onDecl = DECL.indexOf('name="ma_kh"') + 8;
// F12 trả null ở đây (nhảy tới chính mình là cú nhảy không đi đâu); hover thì PHẢI nhận, vì
// người ta rê chuột lên một `<field>` chính là để đọc nó.
eq('F12 vẫn null', definitionTargetAt(DECL, onDecl), null);
eq('hover nhận', definitionTargetAt(DECL, onDecl, { declarations: true })?.name, 'ma_kh');
eq('và trỏ đúng vào tên',
  DECL.slice(definitionTargetAt(DECL, onDecl, { declarations: true }).start,
    definitionTargetAt(DECL, onDecl, { declarations: true }).end), 'ma_kh');
