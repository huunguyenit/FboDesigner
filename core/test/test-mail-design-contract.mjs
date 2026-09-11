// test-mail-design-contract.mjs — hợp đồng webview ↔ host của Email Designer (Phase 2).
//
// `validateMailMessage` là CỬA VÀO của mọi thông điệp từ webview — nơi đang cầm DOM của một mẫu
// mail do khách viết. Test cả hai chiều: thứ hợp lệ phải qua NGUYÊN VẸN (nhất là `{!token}`),
// thứ lạ phải bị chặn, và trường ngoài hợp đồng phải bị LỌC BỎ chứ không được đi tiếp.

import { section, eq, ok } from './harness.mjs';
import {
  DESIGN_ATTR, formatElementId, parseElementId, elementFingerprint, roleOfTag, MAIL_OPS,
  MAIL_PARTS, isAttributeAllowed, isSafeCssValue, isSafeUrl, validateMailMessage, MAX_TEXT_LENGTH,
  isValidAttrValue, ATTRIBUTE_ENUMS, isStyleProperty,
} from '../src/mail-design-contract.mjs';

const edit = (fields) => validateMailMessage({ type: 'edit', rev: 1, elementId: 'e3', ...fields });

section('mail contract — id phần tử');

eq('thuộc tính đánh dấu', DESIGN_ATTR, 'data-fbo-el');
eq('formatElementId(1)', formatElementId(1), 'e1');
eq('parseElementId("e42")', parseElementId('e42'), 42);
eq('e0 không hợp lệ', parseElementId('e0'), null);
eq('e01 không hợp lệ — mỗi phần tử đúng MỘT cách viết id', parseElementId('e01'), null);
eq('không phải chuỗi', parseElementId(7), null);
{
  let threw = false;
  try { formatElementId(0); } catch { threw = true; }
  ok('formatElementId(0) ném', threw);
}
ok('vân tay khác khi style khác (hai <td> liền nhau)',
  elementFingerprint({ part: 'header', tag: 'td', openTag: '<td style="width:50px">' })
  !== elementFingerprint({ part: 'header', tag: 'td', openTag: '<td style="width:60px">' }));
ok('vân tay khác khi part khác',
  elementFingerprint({ part: 'header', tag: 'tr', openTag: '<tr>' })
  !== elementFingerprint({ part: 'detail', tag: 'tr', openTag: '<tr>' }));
eq('tên thẻ không phân biệt hoa thường, thẻ mở giữ nguyên văn',
  elementFingerprint({ part: 'detail', tag: 'TD', openTag: '<TD>' }), 'detail|td|<TD>');
eq('ba part theo thứ tự', MAIL_PARTS, ['header', 'detail', 'footer']);

section('mail contract — vai trò mặc định theo thẻ');

eq('body = frame', roleOfTag('body'), 'frame');
eq('style = frame', roleOfTag('style'), 'frame');
eq('td = structure', roleOfTag('td'), 'structure');
eq('table = structure (luật vị trí mới nâng lên block)', roleOfTag('table'), 'structure');
eq('p = block', roleOfTag('p'), 'block');
eq('A = inline (không phân biệt hoa thường)', roleOfTag('A'), 'inline');
eq('v:rect (VML Outlook) = unknown', roleOfTag('v:rect'), 'unknown');
eq('undefined = unknown', roleOfTag(undefined), 'unknown');

section('mail contract — bảng op');

ok('MAIL_OPS đóng băng cả hai tầng', Object.isFrozen(MAIL_OPS) && Object.isFrozen(MAIL_OPS.setText));
eq('Phase 3 chỉ có hai op', Object.entries(MAIL_OPS).filter(([, s]) => s.phase === 3).map(([k]) => k), ['setText', 'setStyle']);
eq('op kế thừa từ "Xem mail"', Object.entries(MAIL_OPS).filter(([, s]) => s.phase === 0).map(([k]) => k), ['resizeColumn', 'addColumn', 'addRow']);
ok('mọi op có effect hợp lệ', Object.values(MAIL_OPS).every((s) => ['replace', 'insert', 'delete'].includes(s.effect)));
ok('img cho sửa src', isAttributeAllowed('img', 'src'));
ok('a không có src', !isAttributeAllowed('a', 'src'));
ok('không cho sửa style qua setAttr', !isAttributeAllowed('td', 'style'));

section('mail contract — thông điệp không phải edit');

eq('ready: bỏ trường lạ', validateMailMessage({ type: 'ready', junk: 1 }), { ok: true, message: { type: 'ready' } });
ok('null bị chặn', !validateMailMessage(null).ok);
ok('mảng bị chặn', !validateMailMessage([]).ok);
ok('type lạ bị chặn', !validateMailMessage({ type: 'eval' }).ok);
eq('selection: đúng bốn trường, html lạ bị bỏ',
  validateMailMessage({ type: 'selection', actionId: 'PurchaseRequisition', body: 'body2', lang: 'en', html: '<x>' }).message,
  { type: 'selection', actionId: 'PurchaseRequisition', body: 'body2', lang: 'en' });
ok('selection: body không phải bodyN bị chặn', !validateMailMessage({ type: 'selection', actionId: 'A', body: 'header' }).ok);
ok('selection: actionId có dấu nháy bị chặn', !validateMailMessage({ type: 'selection', actionId: "A'--", body: 'body' }).ok);
eq('selection: lang lạ rơi về vi', validateMailMessage({ type: 'selection', actionId: 'A', body: 'body', lang: 'fr' }).message.lang, 'vi');
ok('gotoSource: section lạ bị chặn', !validateMailMessage({ type: 'gotoSource', section: 'text' }).ok);
eq('select: reveal chỉ true khi đúng boolean true',
  validateMailMessage({ type: 'select', rev: 3, elementId: 'e5', reveal: 'yes' }).message.reveal, false);
ok('select: thiếu rev bị chặn', !validateMailMessage({ type: 'select', elementId: 'e5' }).ok);
eq('log: cắt còn 2000 ký tự', validateMailMessage({ type: 'log', text: 'x'.repeat(3000) }).message.text.length, 2000);

section('mail contract — edit: toạ độ nguồn từ webview không lọt qua được');

{
  const r = edit({
    op: 'setText', value: 'Xin chào {!ten_kh}', start: 0, end: 999, file: 'C:/x.xml', edits: [{ start: 0, end: 1, text: 'x' }],
  });
  ok('hợp lệ', r.ok, r.reason);
  eq('chỉ còn trường của hợp đồng', Object.keys(r.message).sort(), ['elementId', 'op', 'rev', 'type', 'value']);
  eq('{!token} giữ nguyên văn', r.message.value, 'Xin chào {!ten_kh}');
}
ok('op lạ bị chặn', !edit({ op: 'eval' }).ok);
ok('op kế thừa từ prototype không lọt', !edit({ op: 'toString' }).ok);
ok('rev âm bị chặn', !validateMailMessage({ type: 'edit', op: 'removeElement', rev: -1, elementId: 'e1' }).ok);
ok('rev dạng chuỗi bị chặn', !validateMailMessage({ type: 'edit', op: 'removeElement', rev: '1', elementId: 'e1' }).ok);
ok('elementId sai dạng bị chặn', !edit({ op: 'removeElement', elementId: 'e1"]' }).ok);
ok('setText quá dài bị chặn', !edit({ op: 'setText', value: 'a'.repeat(MAX_TEXT_LENGTH + 1) }).ok);
ok('setText có NUL bị chặn', !edit({ op: 'setText', value: 'a\u0000b' }).ok);
ok('setText nhận xuống dòng', edit({ op: 'setText', value: 'a\nb' }).ok);
ok('setText nhận chữ có dấu cách và dấu câu', edit({ op: 'setText', value: 'Tổng tiền: 12,500,000 (đã gồm VAT)' }).ok);

section('mail contract — setStyle');

for (const [property, value] of [['font-size', '18px'], ['color', '#1677ff'], ['font-family', "'Segoe UI', Arial"], ['padding', '8px 16px'], ['color', '']]) {
  ok(`nhận ${property}: "${value}"`, edit({ op: 'setStyle', property, value }).ok);
}
ok('thuộc tính ngoài danh sách (position) bị chặn', !edit({ op: 'setStyle', property: 'position', value: 'fixed' }).ok);
ok('background rút gọn bị chặn — Outlook bỏ qua', !edit({ op: 'setStyle', property: 'background', value: 'red' }).ok);
for (const value of ['18px; display:none', 'url(http://x/p.gif)', 'expression(alert(1))', 'red" onmouseover="x', '{!mau}', 'a</style>', 'red /* x */']) {
  ok(`giá trị bị chặn: ${value}`, !isSafeCssValue(value) && !edit({ op: 'setStyle', property: 'color', value }).ok);
}

section('mail contract — setAttr / URL');

for (const value of ['https://fast.com.vn', '{!alink}&n=1', 'mailto:a@b.vn', '#', 'cid:logo']) {
  ok(`href nhận: ${value}`, isSafeUrl(value) && edit({ op: 'setAttr', name: 'href', value }).ok);
}
ok('src nhận data:image base64', edit({ op: 'setAttr', name: 'src', value: 'data:image/png;base64,iVBORw0KGgo=' }).ok);
for (const value of ['javascript:alert(1)', ' JaVa\tScRiPt:alert(1)', '&#106;avascript:alert(1)', 'javascript&colon;alert(1)', 'vbscript:x', 'data:image/png;base64,iVBORw0KGgo=']) {
  ok(`href bị chặn: ${JSON.stringify(value)}`, !edit({ op: 'setAttr', name: 'href', value }).ok);
}
ok('src data:text/html bị chặn', !edit({ op: 'setAttr', name: 'src', value: 'data:text/html;base64,PHNjcmlwdD4=' }).ok);
ok('thuộc tính onclick bị chặn', !edit({ op: 'setAttr', name: 'onclick', value: 'x()' }).ok);
ok('thuộc tính style không đi đường setAttr', !edit({ op: 'setAttr', name: 'style', value: 'color:red' }).ok);
ok('alt có dấu nháy kép bị chặn', !edit({ op: 'setAttr', name: 'alt', value: 'Logo" onerror="x' }).ok);

section('mail contract — move / insert / phép bảng');

ok('move up', edit({ op: 'moveElement', direction: 'up' }).ok);
ok('move left bị chặn', !edit({ op: 'moveElement', direction: 'left' }).ok);
ok('insert button trước phần tử', edit({ op: 'insertComponent', position: 'before', component: 'button' }).ok);
ok('insert position lạ bị chặn', !edit({ op: 'insertComponent', position: 'inside', component: 'text' }).ok);
ok('insert __proto__ bị chặn', !edit({ op: 'insertComponent', position: 'after', component: '__proto__' }).ok);
{
  const r = edit({ op: 'insertComponent', position: 'after', component: 'condition' });
  ok('condition (giữ chỗ) bị chặn kèm lý do', !r.ok && r.reason.includes('chưa hỗ trợ'), r.reason);
}
{
  const r = validateMailMessage({ type: 'edit', op: 'resizeColumn', rev: 2, elementId: 'e9', columnIndex: 1, width: 120 });
  ok('resizeColumn hợp lệ', r.ok, r.reason);
  eq('phép trên template không mang elementId đi tiếp', Object.keys(r.message).sort(), ['columnIndex', 'op', 'rev', 'type', 'width']);
}
ok('resizeColumn width 9 bị chặn', !validateMailMessage({ type: 'edit', op: 'resizeColumn', rev: 2, columnIndex: 0, width: 9 }).ok);
ok('addRow ở detail bị chặn', !validateMailMessage({ type: 'edit', op: 'addRow', rev: 2, part: 'detail', rowIndex: 0 }).ok);
ok('addRow ở footer', validateMailMessage({ type: 'edit', op: 'addRow', rev: 2, part: 'footer', rowIndex: 0 }).ok);

section('mail contract — thuộc tính kiểm theo kiểu (Phase 4)');

for (const [name, value] of [['width', '600'], ['width', '100%'], ['align', 'center'], ['valign', 'middle'], ['target', '_blank'],
  ['bgcolor', '#1677ff'], ['bgcolor', 'white'], ['size', '1'], ['alt', 'Logo Fast'], ['href', ''], ['width', '']]) {
  ok(`nhận ${name}="${value}"`, isValidAttrValue(name, value) && edit({ op: 'setAttr', name, value }).ok);
}
for (const [name, value] of [['width', 'abc'], ['width', '600px'], ['align', 'middle'], ['valign', 'center'], ['target', '_new'],
  ['bgcolor', 'red;x'], ['bgcolor', '#12345g'], ['height', '{!cao}']]) {
  ok(`chặn ${name}="${value}"`, !isValidAttrValue(name, value) && !edit({ op: 'setAttr', name, value }).ok);
}
eq('align liệt kê đúng ba giá trị', ATTRIBUTE_ENUMS.align, ['left', 'center', 'right']);
ok('hr cho sửa size', isAttributeAllowed('hr', 'size'));
ok('div chỉ cho align', isAttributeAllowed('div', 'align') && !isAttributeAllowed('div', 'width'));
ok('td cho sửa height (khoảng trống kiểu bảng)', isAttributeAllowed('td', 'height'));
ok('style của đường kẻ/khoảng trống nằm trong whitelist', isStyleProperty('border-top') && isStyleProperty('line-height'));
