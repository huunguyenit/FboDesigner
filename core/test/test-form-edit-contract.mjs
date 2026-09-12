// test-form-edit-contract.mjs — cổng nhẹ cho message `{type:'edit', op, …}` của FBO designer
// (`core/src/form-edit-contract.mjs`). Kiểm hai điều: (1) 18 op hợp lệ với message ĐÚNG HÌNH DẠNG
// mà `media/designer.js` thật sự gửi (xem trích dẫn `postEdit` trong comment mỗi case) đều qua
// cổng; (2) op lạ / field sai kiểu bị chặn kèm lý do — khác trước đây rơi qua im lặng.

import { ok, eq, section } from './harness.mjs';
import { FORM_EDIT_OPS, isSupportedFormEditOp, validateFormEditMessage } from '../src/form-edit-contract.mjs';

section('FORM_EDIT_OPS — đúng 18 op, không trùng tên');
eq('số lượng', FORM_EDIT_OPS.length, 18);
eq('không trùng tên', new Set(FORM_EDIT_OPS).size, FORM_EDIT_OPS.length);

section('op không nhận diện được → từ chối kèm lý do (thay vì rơi qua im lặng)');
{
  const r = validateFormEditMessage({ op: 'renameTable' });
  ok('từ chối', !r.ok);
  ok('lý do nêu tên op lạ', r.reason.includes('renameTable'));
  ok('không nhận diện được', !isSupportedFormEditOp('renameTable'));
}
{
  const r = validateFormEditMessage(null);
  ok('msg null → từ chối, không ném', !r.ok);
}
{
  const r = validateFormEditMessage({ op: ['resize'] });
  ok('op không phải chuỗi → từ chối', !r.ok);
}

// Mỗi case dưới đây là hình dạng THẬT `postEdit({...})` gửi lên, trích từ `media/designer.js`.
section('colWidth — postEdit({ op: "colWidth", ...target, width })');
ok('hợp lệ', validateFormEditMessage({ op: 'colWidth', grid: 'g', column: 'ma_kh', width: 100 }).ok);
ok('thiếu column → từ chối', !validateFormEditMessage({ op: 'colWidth', width: 100 }).ok);
ok('width không phải số → từ chối', !validateFormEditMessage({ op: 'colWidth', column: 'ma_kh', width: '100' }).ok);

section('colRemove — postEdit({ op: "colRemove", ...colTarget, withField })');
ok('hợp lệ', validateFormEditMessage({ op: 'colRemove', grid: 'g', column: 'ma_kh', withField: true }).ok);
ok('thiếu column → từ chối', !validateFormEditMessage({ op: 'colRemove', grid: 'g' }).ok);

section('colInsert — postEdit({ op: "colInsert", grid, column, side })');
ok('hợp lệ', validateFormEditMessage({ op: 'colInsert', grid: 'g', column: 'ma_kh', side: 'right' }).ok);
ok('thiếu column → từ chối', !validateFormEditMessage({ op: 'colInsert', grid: 'g', side: 'right' }).ok);

section('colMove — postEdit({ op: "colMove", grid, column, anchor, side })');
ok('hợp lệ', validateFormEditMessage({
  op: 'colMove', grid: 'g', column: 'ma_kh', anchor: 'ten_kh', side: 'before',
}).ok);
ok('thiếu anchor → từ chối', !validateFormEditMessage({ op: 'colMove', grid: 'g', column: 'ma_kh', side: 'before' }).ok);

section('colSplit — postEdit({ op: "colSplit", region, col, left, right })');
ok('hợp lệ', validateFormEditMessage({
  op: 'colSplit', region: 'main', col: 0, left: 60, right: 60,
}).ok);
ok('thiếu region → từ chối', !validateFormEditMessage({ op: 'colSplit', col: 0 }).ok);
ok('col không phải số → từ chối', !validateFormEditMessage({ op: 'colSplit', region: 'main', col: 'x' }).ok);

section('colMerge — postEdit({ op: "colMerge", region, col })');
ok('hợp lệ', validateFormEditMessage({ op: 'colMerge', region: 'main', col: 1 }).ok);
ok('thiếu region → từ chối', !validateFormEditMessage({ op: 'colMerge', col: 1 }).ok);

section('colWidthRegion — postEdit({ op: "colWidthRegion", region, col, width })');
ok('hợp lệ', validateFormEditMessage({
  op: 'colWidthRegion', region: 'main', col: 0, width: 90,
}).ok);
ok('width không phải số → từ chối', !validateFormEditMessage({ op: 'colWidthRegion', region: 'main', col: 0, width: 'x' }).ok);

section('viewHeight — postEdit({ op: "viewHeight", height })');
ok('hợp lệ', validateFormEditMessage({ op: 'viewHeight', height: 300 }).ok);
ok('thiếu height → từ chối', !validateFormEditMessage({ op: 'viewHeight' }).ok);

section('fieldRows — postEdit({ op: "fieldRows", field, height })');
ok('hợp lệ', validateFormEditMessage({ op: 'fieldRows', field: 'd81', height: 200 }).ok);
ok('thiếu field → từ chối', !validateFormEditMessage({ op: 'fieldRows', height: 200 }).ok);

section('regionMeta — postEdit({ op: "regionMeta", region, attr, value })');
ok('hợp lệ (anchor)', validateFormEditMessage({
  op: 'regionMeta', region: 'main', attr: 'anchor', value: 2,
}).ok);
ok('hợp lệ (split)', validateFormEditMessage({
  op: 'regionMeta', region: 'main', attr: 'split', value: 0,
}).ok);
ok('attr lạ → từ chối', !validateFormEditMessage({ op: 'regionMeta', region: 'main', attr: 'width', value: 1 }).ok);

section('remove — postEdit({ op: "remove", ...target, withField })');
ok('hợp lệ', validateFormEditMessage({
  op: 'remove', item: 1, cell: 0, withField: false,
}).ok);
ok('item không phải số → từ chối', !validateFormEditMessage({ op: 'remove', item: '1', cell: 0 }).ok);

section('resize — postEdit({ op: "resize", ...target, span }) hoặc (…, side, col)');
ok('hợp lệ (span)', validateFormEditMessage({ op: 'resize', item: 1, cell: 0, span: 2 }).ok);
ok('hợp lệ (side/col)', validateFormEditMessage({
  op: 'resize', item: 1, cell: 0, side: 'left', col: 0,
}).ok);
ok('thiếu cell → từ chối', !validateFormEditMessage({ op: 'resize', item: 1, span: 2 }).ok);

section('insert — postEdit({ op: "insert", ...target, side })');
ok('hợp lệ', validateFormEditMessage({ op: 'insert', item: 1, cell: 0, side: 'in' }).ok);
ok('thiếu item → từ chối', !validateFormEditMessage({ op: 'insert', cell: 0, side: 'in' }).ok);

section('addRow — postEdit({ op: "addRow", item, cell, side, blank, splitSide })');
ok('hợp lệ', validateFormEditMessage({
  op: 'addRow', item: 1, cell: 0, side: 'below', blank: true, splitSide: 'left',
}).ok);
ok('thiếu item → từ chối', !validateFormEditMessage({ op: 'addRow', side: 'below' }).ok);

section('move — postEdit({ op: "move", ...target, toItem, col, targets })');
ok('hợp lệ, không targets', validateFormEditMessage({
  op: 'move', item: 1, cell: 0, toItem: 2, col: 1,
}).ok);
ok('hợp lệ, kèm targets', validateFormEditMessage({
  op: 'move', item: 1, cell: 0, toItem: 2, col: 1, targets: [{ item: 1, cell: 0 }],
}).ok);
ok('targets không phải mảng → từ chối', !validateFormEditMessage({
  op: 'move', item: 1, cell: 0, targets: 'x',
}).ok);

section('swap — postEdit({ op: "swap", ...target, toItem, other })');
ok('hợp lệ', validateFormEditMessage({
  op: 'swap', item: 1, cell: 0, toItem: 2, other: 1,
}).ok);
ok('thiếu other → từ chối', !validateFormEditMessage({ op: 'swap', item: 1, cell: 0 }).ok);

section('swapBlock — postEdit({ op: "swapBlock", a, b })');
ok('hợp lệ', validateFormEditMessage({
  op: 'swapBlock', a: { item: 1, col: 0, span: 2 }, b: { item: 2, col: 0, span: 2 },
}).ok);
ok('thiếu b → từ chối', !validateFormEditMessage({ op: 'swapBlock', a: { item: 1, col: 0, span: 2 } }).ok);
ok('a.span sai kiểu → từ chối', !validateFormEditMessage({
  op: 'swapBlock', a: { item: 1, col: 0, span: 'x' }, b: { item: 2, col: 0, span: 2 },
}).ok);

section('moveBlock — postEdit({ op: "moveBlock", items, toItem, side, half })');
ok('hợp lệ', validateFormEditMessage({
  op: 'moveBlock', items: [1, 2], toItem: 3, side: 'before', half: null,
}).ok);
ok('items rỗng → từ chối', !validateFormEditMessage({ op: 'moveBlock', items: [], toItem: 3 }).ok);
ok('thiếu toItem → từ chối', !validateFormEditMessage({ op: 'moveBlock', items: [1, 2] }).ok);
