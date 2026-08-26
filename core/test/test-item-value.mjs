// test-item-value.mjs — ví dụ lấy thẳng từ đặc tả reference-item-value.md của hub.
// Ví dụ trong đặc tả là hợp đồng: đổi hành vi ở đây mà không đổi đặc tả là đã lệch nguồn.

import { ok, eq, section } from './harness.mjs';
import {
  classifyItem, parseWidths, parseToken, parseRow, resolvePattern, buildCells, serializeRow, setSpan,
  removeCell, insertCell, newRow,
} from '../src/item-value.mjs';

section('classifyItem — chỉ item ĐẦU TIÊN và không có ":" mới là list px');
eq('item 0 không dấu hai chấm → widths', classifyItem('100, 80, 100', 0), 'widths');
eq('item 0 có dấu hai chấm → row', classifyItem('1100: [a].Label, [a]', 0), 'row');
eq('item 3 không dấu hai chấm vẫn là row', classifyItem('100, 80', 3), 'row');

section('parseWidths — width 0 là hợp lệ và có thật');
eq('13 cột của Dir/Customer', parseWidths('120, 30, 45, 25, 65, 45, 30, 25, 65, 75, 25, 0, 203').widths,
  [120, 30, 45, 25, 65, 45, 30, 25, 65, 75, 25, 0, 203]);

section('parseToken');
eq('[f] → input', parseToken('[ma_kh]').kind, 'input');
eq('[f].Label → label', parseToken('[ma_kh].Label').kind, 'label');
eq('[f].Description → description', parseToken('[status].Description').kind, 'description');
eq('.Footer KHÔNG đẩy xuống vùng footer, vẫn là một kind riêng', parseToken('[ma_so_thue].Footer').kind, 'footer');
eq('chấm rỗng "[f]." đọc như Input, không phải footer', parseToken('[ma_kh].').kind, 'input');
eq('hậu tố %l là một phần của TÊN', parseToken('[ten_tk%l]').field, 'ten_tk%l');
eq('entity là chính tên field, không expand', parseToken('[&k;].Label').field, '&k;');
ok('typo .Desciption (95 lần trong corpus) KHÔNG hợp lệ', parseToken('[a].Desciption').valid === false);
eq('và giữ nguyên văn để UI chỉ được chỗ sai', parseToken('[a].Desciption').kindRaw, 'Desciption');

section('parseRow — bất biến số "1" = số token');
const r1 = parseRow('1100-: [ma_kh].Label, [ma_kh]');
eq('pattern', r1.pattern, '1100-');
eq('2 token', r1.tokens.length, 2);
eq('không cảnh báo', r1.warnings, []);
const broken = parseRow('111-: [a].Label, [a]');
ok('3 "1" mà 2 token → báo hỏng bất biến', broken.warnings.some((w) => w.includes('bất biến')));
ok('phát hiện entity trong value', parseRow('110&UnitCols;: [&UnitFields;].Label').hasEntity === true);

section('resolvePattern — ngắn thì pad, dài thì CẮT');
eq('pattern 4 ký tự trên view 13 cột → pad 9 dấu gạch', resolvePattern('1100', 13).pattern, '1100---------');
const cut = resolvePattern('10100100000000000', 13);
eq('17 ký tự → cắt còn 13', cut.pattern, '1010010000000');
eq('ba "1" nằm ở cột 1, 3, 6 nên không mất token nào', cut.lostOnes, 0);
eq('cắt trúng "1" thì phải đếm được', resolvePattern('1---1', 4).lostOnes, 1);

section('buildCells — ví dụ 5 cột của đặc tả');
const widths5 = parseWidths('100, 80, 100, 120, 200').widths;
const built = buildCells(parseRow('1100-: [ma_kh].Label, [ma_kh]'), widths5);
eq('ô 0: Label, 1 cột, 100px', [built.cells[0].span, built.cells[0].width, built.cells[0].token.kind], [1, 100, 'label']);
eq('ô 1: Input span 3 = 80+100+120 = 300px', [built.cells[1].span, built.cells[1].width], [3, 300]);
eq('ô 2: cột cuối trống', built.cells[2].empty, true);
eq('tổng cột đúng 5', built.cells.reduce((n, c) => n + c.span, 0), 5);

section('buildCells — "0" không có "1" trước thì không nối vào đâu');
const orphan = buildCells(parseRow('-0: [a]'), parseWidths('50, 50').widths);
eq('cả hai ô đều trống', orphan.cells.map((c) => c.empty), [true, true]);

section('serializeRow — round-trip giữ nguyên chuỗi gốc');
for (const raw of ['1100-: [ma_kh].Label, [ma_kh]', '111000000000: [status].Label, [status], [status].Description']) {
  eq(`round-trip "${raw}"`, serializeRow(parseRow(raw)), raw);
}
eq('separator không khoảng trắng cũng giữ', serializeRow(parseRow('11: [a].Label,[a]')), '11: [a].Label,[a]');

section('setSpan — nở vào cột trống thì được, đụng control thì TỪ CHỐI');
const rowA = parseRow('11--: [a].Label, [a]');
const grow = setSpan(rowA, parseWidths('50, 50, 50, 50').widths, 1, 3);
ok('nở ô Input từ 1 lên 3 cột', grow.ok === true);
eq('pattern mới', grow.ok && grow.row.pattern, '1100');
eq('serialize giữ nguyên token', grow.ok && serializeRow(grow.row), '1100: [a].Label, [a]');

const blocked = setSpan(parseRow('111-: [a].Label, [a], [b]'), parseWidths('50, 50, 50, 50').widths, 1, 2);
ok('nở đè lên ô đang giữ control → từ chối', blocked.ok === false);
ok('và nói rõ vì sao', blocked.ok === false && blocked.reason.includes('đang có control'));

const shrink = setSpan(parseRow('1000: [a]'), parseWidths('50, 50, 50, 50').widths, 0, 2);
eq('thu span 4 → 2, hai cột thừa thành ô trống', shrink.ok && shrink.row.pattern, '10--');

const entityRow = parseRow('110&UnitCols;: [&UnitFields;].Label, [&UnitFields;]');
const refused = setSpan(entityRow, parseWidths('50, 50, 50').widths, 0, 2);
ok('hàng có entity thì designer KHÔNG sửa tại controller', refused.ok === false);
ok('lý do nêu đúng chỗ phải sửa', refused.ok === false && refused.reason.includes('file entity'));

// ─────────────────────────────────────────────────────────────────────────────
// Phép SỬA hàng. Đây là những hàm đầu tiên ghi ngược ra XML, nên luật chung là:
// đụng đúng thứ được yêu cầu, và TỪ CHỐI khi không chắc — không đoán hộ.
const W = [100, 60, 90, 150];
const R = (v) => parseRow(v);

section('removeCell — bỏ control, trả cột về trống');
const rm = removeCell(R('1100: [a].Label, [a]'), W, 0);
ok('bỏ được', rm.ok);
// `1100` = ô0 ở cột 0, ô1 ở cột 1 TRẢI 3 cột (hai số `0` nối vào nó). Xoá ô0 chỉ trả cột 0.
eq('cột của nó thành "-"', rm.row.pattern, '-100');
eq('token của nó biến mất', rm.row.tokens.map((t) => t.raw), ['[a]']);
// Ô bên cạnh KHÔNG tự nở ra chiếm chỗ — nở hay không là quyết định của người dùng.
const rm2 = removeCell(R('1100: [a].Label, [a]'), W, 1);
eq('xoá ô trải 3 cột thì trả cả 3 cột', rm2.row.pattern, '1---');
eq('còn lại đúng token kia', rm2.row.tokens.map((t) => t.raw), ['[a].Label']);
eq('ô trống không có gì để xoá', removeCell(R('1---: [a]'), W, 1).reason, 'ô trống, không có gì để xoá');

section('removeCell — token gỡ đúng chỗ khi hàng có nhiều control');
const three = removeCell(R('1110: [a], [b], [c]'), W, 1);
eq('gỡ đúng token giữa', three.row.tokens.map((t) => t.raw), ['[a]', '[c]']);
eq('chỉ cột giữa thành trống', three.row.pattern, '1-10');

section('insertCell — chỉ ăn ô TRỐNG, không đè lên control');
const ins = insertCell(R('1---: [a]'), W, 0, 'right', '[b]');
ok('thêm được vào ô trống bên phải', ins.ok);
eq('cột kế thành "1"', ins.row.pattern, '11--');
eq('token chèn đúng thứ tự', ins.row.tokens.map((t) => t.raw), ['[a]', '[b]']);
// Ô TRỐNG cũng là một ô: ở `-1--` thì ô 0 là ô trống cột 0, control `[a]` mới là ô 1.
const insL = insertCell(R('-1--: [a]'), W, 1, 'left', '[b]');
eq('thêm bên trái: token đứng TRƯỚC', insL.row.tokens.map((t) => t.raw), ['[b]', '[a]']);
eq('pattern đúng', insL.row.pattern, '11--');
// Đè lên control có sẵn là làm mất một khai báo người dùng không hề yêu cầu.
ok('từ chối khi ô kề đang có control', !insertCell(R('11--: [a], [b]'), W, 0, 'right', '[c]').ok);
ok('từ chối khi đã ở mép trái', !insertCell(R('1---: [a]'), W, 0, 'left', '[b]').ok);
ok('từ chối token không đọc được', !insertCell(R('1---: [a]'), W, 0, 'right', 'xyz').ok);

section('mọi phép sửa đều từ chối hàng có entity');
// Ghi bản đã bung đè lên nguồn là xoá sạch `&Name;` và nhân bản nội dung dùng chung.
const ent = R('1100: [&k;].Label, [&k;]');
for (const [ten, kq] of [
  ['setSpan', setSpan(ent, W, 0, 2)],
  ['removeCell', removeCell(ent, W, 0)],
  ['insertCell', insertCell(ent, W, 0, 'right', '[b]')],
]) {
  ok(`${ten} từ chối`, !kq.ok && kq.reason.includes('entity'));
}

section('newRow — hàng mới chỉ có đúng một control, không đoán phần còn lại');
const nr = newRow(W, '[a]');
eq('một "1" rồi toàn "-"', nr.row.pattern, '1---');
eq('đúng một token', nr.row.tokens.map((t) => t.raw), ['[a]']);
eq('ghi ra đúng dạng item value', serializeRow(nr.row), '1---: [a]');

section('sửa xong ghi lại phải đọc lại được y như thế');
// Vòng tròn parse → sửa → serialize → parse là thứ giữ cho edit không trôi dần.
const round = parseRow(serializeRow(removeCell(R('1110: [a], [b], [c]'), W, 1).row));
eq('pattern giữ nguyên', round.pattern, '1-10');
eq('token giữ nguyên', round.tokens.map((t) => t.raw), ['[a]', '[c]']);
eq('không sinh cảnh báo mới', round.warnings, []);
