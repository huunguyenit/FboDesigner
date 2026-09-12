// test-mail-components.mjs — suy LOẠI component từ HTML mail (Phase 4).
//
// Loại quyết định bảng thuộc tính hiện nhóm ô nào. Ca khó cố tình đưa vào: `<a>` mang
// `display:{!slink}` (token, không phải nút), ô bảng để trắng không khai chiều cao (ô tiêu đề
// rỗng — không phải khoảng trống), khối chỉ chứa `&nbsp;` (khoảng trống, không phải chữ).

import { section, eq, ok } from './harness.mjs';
import { componentKindOf, COMPONENT_PANELS } from '../src/mail-components.mjs';

const NBSP = String.fromCharCode(160);
const kind = (o) => componentKindOf({
  role: 'block', ...o, style: new Map(Object.entries(o.style ?? {})), attrs: new Map(Object.entries(o.attrs ?? {})),
});

section('mail components — suy loại');

eq('frame giữ nguyên', kind({ tag: 'body', role: 'frame' }), 'frame');
eq('img = ảnh', kind({ tag: 'img', role: 'inline' }), 'image');
eq('hr = đường kẻ', kind({ tag: 'hr' }), 'divider');
eq('a trơn = liên kết', kind({ tag: 'a', role: 'inline', text: 'Duyệt', style: { color: '#003399' } }), 'link');
eq('a có nền = nút', kind({ tag: 'a', role: 'inline', style: { 'background-color': '#1677ff' } }), 'button');
eq('a inline-block = nút', kind({ tag: 'a', role: 'inline', style: { display: 'inline-block' } }), 'button');
eq('a display:{!token} = liên kết', kind({ tag: 'a', role: 'inline', style: { display: '{!slink}' } }), 'link');
eq('div rỗng có border-top = đường kẻ', kind({ tag: 'div', style: { 'border-top': '1px solid #ddd' } }), 'divider');
eq('td rỗng cao 1 có bgcolor = đường kẻ', kind({ tag: 'td', role: 'structure', attrs: { height: '1', bgcolor: '#ddd' } }), 'divider');
eq('div chỉ &nbsp; cao 20px = khoảng trống', kind({ tag: 'div', text: NBSP, style: { height: '20px' } }), 'spacer');
eq('td rỗng height="30" = khoảng trống', kind({ tag: 'td', role: 'structure', attrs: { height: '30' } }), 'spacer');
eq('td rỗng không khai cao = khung chứa', kind({ tag: 'td', role: 'structure' }), 'container');
eq('td có chữ = khung chứa', kind({ tag: 'td', role: 'structure', text: 'Số phiếu' }), 'container');
eq('div có con, dù khai cao = khung chứa', kind({ tag: 'div', childCount: 1, style: { height: '20px' } }), 'container');
eq('p có chữ = chữ', kind({ tag: 'p', text: 'Xin chào' }), 'text');
eq('p rỗng không khai cao = chữ', kind({ tag: 'p' }), 'text');
eq('span = chữ', kind({ tag: 'span', role: 'inline', text: 'x' }), 'text');
eq('thẻ lạ = chữ', kind({ tag: 'o:p', role: 'unknown' }), 'text');

section('mail components — bảng thuộc tính');

ok('mọi loại có nhãn + danh sách style + danh sách thuộc tính',
  Object.values(COMPONENT_PANELS).every((p) => p.label && Array.isArray(p.styles) && Array.isArray(p.attrs)));
ok('bảng đóng băng', Object.isFrozen(COMPONENT_PANELS) && Object.isFrozen(COMPONENT_PANELS.image.attrs));
ok('ảnh: link sửa ở thẻ <a> cha', COMPONENT_PANELS.image.parentLink === true);
ok('nút: căn lề sửa ở khối cha', COMPONENT_PANELS.button.parentAlign === true);
eq('ảnh hiện đủ ô theo yêu cầu', COMPONENT_PANELS.image.attrs, ['src', 'alt', 'width', 'height', 'align', 'border', 'title']);
eq('khung tài liệu không có ô nào', [COMPONENT_PANELS.frame.styles.length, COMPONENT_PANELS.frame.attrs.length], [0, 0]);
