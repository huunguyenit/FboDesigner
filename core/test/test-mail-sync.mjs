// test-mail-sync.mjs — cầu nối Code ↔ Designer (Phase 7).
//
// Hai phép thuần mà tầng vỏ dựa vào: con trỏ trong XML → phần tử designer chọn theo; phần tử đang chọn →
// số thứ tự cột/dòng cho các phép bảng của «Xem mail». Sai ở đây là designer nhảy sang phần tử khác,
// hoặc phép «đổi bề rộng cột» ghi vào cột người dùng không hề chọn.

import { section, eq, ok } from './harness.mjs';
import { mailElementAtSource } from '../src/mail-html.mjs';
import { mailTableContext } from '../src/mail-structure.mjs';
import {
  HOST, SHARED, SOURCE, SHARED_SOURCE, build, nth,
} from './test-mail-html.mjs';

section('mail sync — con trỏ trong nguồn → phần tử');
{
  const b = build();
  const at = (file, needle, src = SOURCE) => mailElementAtSource(b.view, b.index, b.expanded.segments, file, src.indexOf(needle));

  eq('chữ trong h2 → h2', at(HOST, 'Xin chào'), nth(b.index, 'h2').id);
  eq('trong thẻ mở <a> (href) → a', at(HOST, '{!alink}'), nth(b.index, 'a', 0).id);
  eq('trong <b> lồng trong <p> → b, phần tử sâu nhất', at(HOST, 'Đậm'), nth(b.index, 'b').id);
  eq('chữ ngay sau </b> → về lại p', at(HOST, ' thường'), nth(b.index, 'p', 1).id);
  eq('ô tiêu đề bảng → td', at(HOST, '{!so_ct}'), nth(b.index, 'td', 1).id);
  eq('dòng mẫu detail → td của detail', at(HOST, '{!ma_vt}'), nth(b.index, 'td', 2).id);
  eq('trong <fields> → null (không có gì để chọn)', at(HOST, '<header v="Số phiếu"'), null);
  eq('giá trị <!ENTITY HeaderColor> trong DOCTYPE → ô bảng dùng entity đó', at(HOST, 'background-color:#edede2'), nth(b.index, 'td', 0).id);
  eq('đường dẫn gạch ngược + hoa vẫn khớp',
    mailElementAtSource(b.view, b.index, b.expanded.segments, HOST.replace(/\//g, '\\').toUpperCase(), SOURCE.indexOf('Xin chào')), nth(b.index, 'h2').id);

  eq('file Include của action khác → null trên bản vẽ Order', at(SHARED, 'Chung', SHARED_SOURCE), null);
  const shared = build(undefined, { actionId: 'Shared' });
  eq('… và trỏ đúng <p> trên bản vẽ Shared',
    mailElementAtSource(shared.view, shared.index, shared.expanded.segments, SHARED, SHARED_SOURCE.indexOf('Chung')), nth(shared.index, 'p').id);
}

section('mail sync — vai trò bảng của phần tử');
{
  const b = build();
  const ctx = mailTableContext(b.view, b.index, b.expanded.clearText, { actionId: 'Order', body: 'body' });
  eq('ô tiêu đề cột 1, width khai trực tiếp (dù style bị entity cắt)', ctx[nth(b.index, 'td', 0).id].column, { index: 0, width: 100, header: true });
  eq('ô tiêu đề cột 2, không khai width', ctx[nth(b.index, 'td', 1).id].column, { index: 1, width: null, header: true });
  eq('ô dòng mẫu cùng cột 2', ctx[nth(b.index, 'td', 3).id].column, { index: 1, width: null, header: false });
  eq('hàng tiêu đề trong header nhân bản được', ctx[nth(b.index, 'tr', 0).id].row, { part: 'header', rowIndex: 0 });
  ok('dòng mẫu detail KHÔNG nhân bản được', !ctx[nth(b.index, 'tr', 1).id]);
  ok('phần tử ngoài bảng không có vai trò bảng', !ctx[nth(b.index, 'h2').id]);

  const shared = build(undefined, { actionId: 'Shared' });
  eq('mẫu không có bảng lưới → rỗng', mailTableContext(shared.view, shared.index, shared.expanded.clearText, { actionId: 'Shared', body: 'body' }), {});
}
