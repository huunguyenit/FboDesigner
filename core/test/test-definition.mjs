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
import { definitionTargetAt, fieldDeclarationSpan } from '../src/definition.mjs';

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
