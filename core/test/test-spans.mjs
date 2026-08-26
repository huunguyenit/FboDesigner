// test-spans.mjs — vị trí phải TRỎ ĐÚNG, và splice phải để phần không đụng tới nguyên vẹn.
// Đây là bài test giữ lời hứa "không bao giờ parse-rồi-serialize-lại cả file".

import { ok, eq, section } from './harness.mjs';
import { scanViews, scanFields, applySplices, scanCss } from '../src/spans.mjs';

const XML = [
  '<?xml version="1.0" encoding="windows-1258"?>',
  '<dir table="dmkh">',
  '  <fields>',
  '    <field name="ma_kh" required="true">',
  '      <header v="Mã khách hàng" e="Customer code"/>',
  '    </field>',
  '    <field name="loai" type="combo">',
  '      <items>',
  '        <item value="0"><text v="Không tính" e="None"/></item>',
  '        <item value="1"><text v="Có tính" e="Yes"/></item>',
  '      </items>',
  '    </field>',
  '  </fields>',
  '  <view id="Dir" height="280">',
  '    <item value="100, 80, 100, 120, 200"/>',
  '    <item value="1100-: [ma_kh].Label, [ma_kh]" />',
  '    <item value="1&Extra;: [loai].Label" />',
  '  </view>',
  '</dir>',
].join('\r\n');

section('scanViews');
const views = scanViews(XML);
eq('một view', views.length, 1);
eq('attribute của view đọc được', [views[0].attrs.id, views[0].attrs.height], ['Dir', '280']);
eq('ba item con của view', views[0].items.length, 3);

section('item lựa chọn dropdown KHÔNG lọt vào view');
ok('không có item value="0" trong danh sách của view',
  views[0].items.every((it) => it.value !== '0' && it.value !== '1'));

section('valueSpan trỏ đúng phần giá trị, không gồm dấu nháy');
for (const it of views[0].items) {
  const slice = XML.slice(it.valueSpan.start, it.valueSpan.end);
  ok(`span khớp value: ${JSON.stringify(it.value)}`, slice === it.value, `cắt ra ${JSON.stringify(slice)}`);
}
eq('phát hiện entity trong item', views[0].items.map((it) => it.hasEntity), [false, false, true]);

section('scanFields');
const fields = scanFields(XML);
eq('hai field', fields.map((f) => f.name), ['ma_kh', 'loai']);
eq('header tiếng Việt', fields[0].header.v, 'Mã khách hàng');
eq('attribute required giữ nguyên', fields[0].attrs.required, 'true');

section('applySplices — chỉ đổi đúng khoảng, phần còn lại nguyên từng ký tự');
const target = views[0].items[1].valueSpan;
const patched = applySplices(XML, [{ start: target.start, end: target.end, text: '1000-: [ma_kh]' }]);
ok('value mới nằm đúng chỗ', patched.includes('<item value="1000-: [ma_kh]" />'));
eq('độ dài đổi đúng bằng chênh lệch',
  patched.length, XML.length - (target.end - target.start) + '1000-: [ma_kh]'.length);
ok('CRLF không bị đụng', patched.includes('\r\n') && !/[^\r]\n/.test(patched));
ok('phần trước khoảng splice y nguyên', patched.slice(0, target.start) === XML.slice(0, target.start));
ok('phần sau khoảng splice y nguyên', patched.slice(target.start + '1000-: [ma_kh]'.length) === XML.slice(target.end));
ok('entity ở item khác vẫn còn nguyên văn', patched.includes('&Extra;'));

section('applySplices — nhiều splice và trường hợp sai');
const two = applySplices('abcdef', [{ start: 0, end: 1, text: 'X' }, { start: 4, end: 6, text: 'YZ!' }]);
eq('áp từ phải sang trái, offset không lệch', two, 'XbcdYZ!');
let threw = false;
try { applySplices('abcdef', [{ start: 0, end: 3, text: 'X' }, { start: 2, end: 4, text: 'Y' }]); } catch { threw = true; }
ok('splice chồng nhau thì NÉM, không đoán ý', threw);

section('scanCss — CSS do chính controller khai');
// Bẫy của định dạng: CDATA bị NGẮT QUÃNG để nhét giá trị entity vào giữa. Cắt lấy riêng ruột
// từng khối CDATA sẽ đánh rơi đúng cái tên vừa được thay vào — mà đó thường là tên class của
// nút riêng, tức là mất luôn thứ cần nhất.
const CSSDOC = [
  '<dir>',
  '  <css>',
  '    <text>',
  '      <![CDATA[',
  'div.]]>APTranImport<![CDATA[{cursor:pointer;background-image:url(\'data:image/gif;base64,R0lGOD\');}',
  '.Break{height:1px;}',
  ']]>',
  '    </text>',
  '  </css>',
  '</dir>',
].join('\r\n');
const got = scanCss(CSSDOC);
ok('ghép được tên class bị chẻ đôi qua entity', got.includes('div.APTranImport{'));
ok('giữ nguyên icon data URI của nút riêng', got.includes("url('data:image/gif;base64,R0lGOD')"));
ok('giữ cả rule sau đó', got.includes('.Break{height:1px;}'));
ok('không còn dấu CDATA', !got.includes('CDATA') && !got.includes(']]>'));
eq('không khai <css> thì trả rỗng', scanCss('<dir><view id="Dir"/></dir>'), '');
eq('có <css> nhưng rỗng thì cũng rỗng', scanCss('<dir><css><text></text></css></dir>'), '');

section('scanCss — bỏ khối <Encrypted>, giữ phần đọc được ngay sau nó');
// File lưới thật trộn cả hai: một khối CSS đã mã hoá bằng khoá của Fast (không giải được) rồi
// mới tới rule đọc được. Nhét nguyên khối base64 vào <style> làm hỏng luôn phần phía sau.
const MIXED = '<grid><css><text><![CDATA[<Encrypted>AbCd+/=</Encrypted>\r\ndiv.GroupExtra{background-image:url(../Images/Extra.png);}]]></text></css></grid>';
const mixed = scanCss(MIXED);
ok('bỏ hết phần mã hoá', !mixed.includes('Encrypted') && !mixed.includes('AbCd'));
ok('giữ rule đọc được', mixed.includes('div.GroupExtra{background-image:url(../Images/Extra.png);}'));
