// test-swap-split.mjs — ĐỔI CHỖ HAI DẢI CỘT, và DỜI KHỐI THEO NỬA `view@split`.
//
// Hai phép sửa mới, sinh ra từ hai lời từ chối sai của bản trước:
//
//   1. Kéo `so_ct.Label, so_ct` lên `ngay_ct.Label, ngay_ct` bị chặn bằng «cột N đang có
//      control». Câu ấy đúng luật của phép DỜI nhưng sai việc người dùng đang làm: đổi chỗ hai
//      cụm thì không ô nào bị nuốt mất. Nay có `planSwapBlock` — và nó đo bằng SỐ CỘT chứ
//      không ghép control với control, nên `ty_gia.Label, ma_nt, ty_gia` (3 control, 4 cột)
//      đổi được với `ngay_ct.Label, ngay_ct` (2 control, cũng 4 cột).
//   2. Chọn một khối hàng ở nửa TRÁI của vùng split rồi thả xuống thì cả nửa PHẢI cũng đổi thứ
//      tự, dù không ai đụng vào chúng — vì phép cũ dời nguyên thẻ `<item>`, mà một `<item>` của
//      vùng split là hai nửa nằm chung một dòng. Nay `planMoveRowBlock` nhận `half`.
//
// Bất biến canh xuyên suốt: mọi thứ NGOÀI phần vừa sửa không đổi một byte.

import { ok, eq, section } from './harness.mjs';
import { renderControllerHtml } from '../src/render.mjs';
import { planSwapBlock, planSwapControl, planMoveRowBlock, moveControlFiles } from '../src/edit.mjs';
import { expandEntities } from '../src/entities.mjs';
import { applySplices } from '../src/spans.mjs';

const NL = '\r\n';
const HOST = 'C:/P/App_Data/Controllers/Dir/SQTran.xml';

function build(text, file = HOST, readFile = () => null) {
  const ex = expandEntities(text, { filePath: file, readFile });
  const r = renderControllerHtml(ex.clearText, { segments: ex.segments, hostFile: file });
  return r.model;
}

function applyFor(text, edits, file = HOST) {
  const mine = edits.filter((e) => e.file === file).map(({ start, end, text: t }) => ({ start, end, text: t }));
  return applySplices(text, mine);
}

const rowOf = (model, field) => model.rows.find((r) => r.row.tokens.some((t) => t.field === field));
const cellOf = (row, field, kind = 'input') =>
  row.cells.findIndex((c) => !c.empty && c.token?.field === field && c.token?.kind === kind);
/** Danh sách `<item value>` của view, bỏ dòng list px đầu. */
const itemsOf = (text) => [...text.matchAll(/<item value="([^"]*)"\/>/g)].map((m) => m[1]).slice(1);

/* ══════════════════════════════════════════════════════════════════════════
 * 1. ĐỔI CHỖ HAI DẢI CỘT — đo bằng SỐ CỘT, không ghép control với control
 * ══════════════════════════════════════════════════════════════════════════ */

const PAIR = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="m61">',
  '  <fields>',
  '    <field name="so_ct"><header v="Số ct" e="No"/></field>',
  '    <field name="ngay_ct" type="DateTime"><header v="Ngày ct" e="Date"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 60, 100, 60, 60"/>',
  '    <!-- comment phải sống sót -->',
  '    <item value="110110: [so_ct].Label, [so_ct], [ngay_ct].Label, [ngay_ct]"/>',
  '  </view>',
  '</dir>',
].join(NL);

section('hai dải cùng bề rộng, cùng số control — đổi chỗ nguyên khối');

const m1 = build(PAIR);
const row1 = rowOf(m1, 'so_ct');
const op1 = {
  kind: 'swapBlock',
  a: { item: row1.index, col: 0, span: 3 },
  b: { item: row1.index, col: 3, span: 3 },
};
const swap1 = planSwapBlock(m1, op1, () => PAIR);
ok('lập kế hoạch được — không còn "cột N đang có control"', swap1.ok, swap1.reason);
eq('chỉ một file phải mở', moveControlFiles(m1, op1), [HOST]);

const out1 = applyFor(PAIR, swap1.edits);
eq('hai dải hoán chỗ, mỗi control giữ nguyên span của nó',
  itemsOf(out1), ['110110: [ngay_ct].Label, [ngay_ct], [so_ct].Label, [so_ct]']);
ok('comment sống sót', out1.includes('<!-- comment phải sống sót -->'));
ok('list px không bị đụng', out1.includes('value="100, 60, 60, 100, 60, 60"'));

section('KHÁC số control nhưng CÙNG số cột — vẫn khít, và đây là cả điểm của phép này');

/*
 * Ca người dùng nêu:
 *
 *   [ty_gia].Label, [ma_nt], [ty_gia]   ba control · 1 + 2 + 1 = 4 cột
 *   [ngay_ct].Label, [ngay_ct]          hai control · 1 + 3   = 4 cột
 *
 * Luật cũ ghép control-với-control: đếm 3 với 2, không ghép nổi. Luật mới đếm CỘT: 4 với 4,
 * vừa khít — và mỗi control giữ nguyên span, không cái nào bị thu về `min` như bản trước.
 */
const MIXED = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="m61">',
  '  <fields>',
  '    <field name="ty_gia" type="Decimal"><header v="Tỷ giá" e="Rate"/></field>',
  '    <field name="ma_nt"><header v="Mã nt" e="Cur"/></field>',
  '    <field name="ngay_ct" type="DateTime"><header v="Ngày ct" e="Date"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="60, 40, 40, 60, 60, 40, 40, 60"/>',
  '    <item value="11011100: [ty_gia].Label, [ma_nt], [ty_gia], [ngay_ct].Label, [ngay_ct]"/>',
  '  </view>',
  '</dir>',
].join(NL);

const m2 = build(MIXED);
const row2 = rowOf(m2, 'ty_gia');
const spansOf = (row) => row.cells.filter((c) => !c.empty).map((c) => c.span);
eq('dải trái: ba control trong 4 cột (1 + 2 + 1)', spansOf(row2).slice(0, 3), [1, 2, 1]);
eq('dải phải: hai control cũng 4 cột (1 + 3)', spansOf(row2).slice(3), [1, 3]);

const swap2 = planSwapBlock(m2, {
  a: { item: row2.index, col: 0, span: 4 },
  b: { item: row2.index, col: 4, span: 4 },
}, () => MIXED);
ok('đổi chỗ được dù 3 control ↔ 2 control', swap2.ok, swap2.reason);
eq('cụm 4 cột đổi chỗ nguyên khối, mọi span giữ nguyên',
  itemsOf(applyFor(MIXED, swap2.edits)),
  ['11001101: [ngay_ct].Label, [ngay_ct], [ty_gia].Label, [ma_nt], [ty_gia]']);

section('hai dải KHÁC bề rộng → từ chối, không đoán phần dư đi đâu');

const m3 = build(MIXED);
const row3 = rowOf(m3, 'ty_gia');
const wrongWidth = planSwapBlock(m3, {
  a: { item: row3.index, col: 0, span: 4 },
  b: { item: row3.index, col: 4, span: 3 },
}, () => MIXED);
ok('từ chối', wrongWidth.ok === false);
ok('lý do nêu đúng hai con số', /4 cột.*3 cột/.test(wrongWidth.reason || ''), wrongWidth.reason);

section('dải CẮT ĐÔI một control → từ chối');

const cut = planSwapBlock(m3, {
  a: { item: row3.index, col: 0, span: 2 },
  b: { item: row3.index, col: 2, span: 2 },
}, () => MIXED);
ok('từ chối', cut.ok === false);
ok('gọi đúng tên control bị cắt', /ma_nt/.test(cut.reason || ''), cut.reason);

section('hai dải GIẪM lên nhau trong cùng hàng → từ chối');

const LAP = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="m61">',
  '  <fields>',
  '    <field name="so_ct"><header v="Số ct" e="No"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 100, 60"/>',
  '    <item value="11--: [so_ct].Label, [so_ct]"/>',
  '  </view>',
  '</dir>',
].join(NL);

const mLap = build(LAP);
const rowLap = rowOf(mLap, 'so_ct');
const lap = planSwapBlock(mLap, {
  a: { item: rowLap.index, col: 0, span: 2 },
  b: { item: rowLap.index, col: 1, span: 2 },
}, () => LAP);
ok('từ chối', lap.ok === false);
ok('lý do nói đúng chuyện giẫm nhau', /giẫm/.test(lap.reason || ''), lap.reason);

section('hai dải ở HAI HÀNG khác nhau');

const TWO = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="m61">',
  '  <fields>',
  '    <field name="so_ct"><header v="Số ct" e="No"/></field>',
  '    <field name="ngay_ct" type="DateTime"><header v="Ngày ct" e="Date"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 100, 60"/>',
  '    <item value="11--: [so_ct].Label, [so_ct]"/>',
  '    <item value="11--: [ngay_ct].Label, [ngay_ct]"/>',
  '  </view>',
  '</dir>',
].join(NL);

const m4 = build(TWO);
const rSo = rowOf(m4, 'so_ct');
const rNgay = rowOf(m4, 'ngay_ct');
const swap4 = planSwapBlock(m4, {
  a: { item: rSo.index, col: 0, span: 2 },
  b: { item: rNgay.index, col: 0, span: 2 },
}, () => TWO);
ok('lập kế hoạch được', swap4.ok, swap4.reason);
eq('hai hàng đổi nội dung cho nhau, pattern giữ nguyên', itemsOf(applyFor(TWO, swap4.edits)), [
  '11--: [ngay_ct].Label, [ngay_ct]',
  '11--: [so_ct].Label, [so_ct]',
]);

section('dải TRỐNG đổi chỗ với dải có control — dời cả cụm sang chỗ trống');

const HOLE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="m61">',
  '  <fields>',
  '    <field name="so_ct"><header v="Số ct" e="No"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 100, 60"/>',
  '    <item value="11--: [so_ct].Label, [so_ct]"/>',
  '  </view>',
  '</dir>',
].join(NL);

const mHole = build(HOLE);
const rowHole = rowOf(mHole, 'so_ct');
const toHole = planSwapBlock(mHole, {
  a: { item: rowHole.index, col: 0, span: 2 },
  b: { item: rowHole.index, col: 2, span: 2 },
}, () => HOLE);
ok('lập kế hoạch được', toHole.ok, toHole.reason);
eq('cả cụm dời sang hai cột trống, thứ tự token theo cột',
  itemsOf(applyFor(HOLE, toHole.edits)), ['--11: [so_ct].Label, [so_ct]']);

/* ══════════════════════════════════════════════════════════════════════════
 * 2. DỜI KHỐI THEO NỬA `view@split`
 * ══════════════════════════════════════════════════════════════════════════ */

const SPLIT = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="m61">',
  '  <fields>',
  '    <field name="a"><header v="A" e="A"/></field>',
  '    <field name="b"><header v="B" e="B"/></field>',
  '    <field name="c"><header v="C" e="C"/></field>',
  '    <field name="x"><header v="X" e="X"/></field>',
  '    <field name="y"><header v="Y" e="Y"/></field>',
  '    <field name="z"><header v="Z" e="Z"/></field>',
  '  </fields>',
  '  <view id="Dir" split="2">',
  '    <item value="100, 100, 100, 100"/>',
  '    <item value="1-1-: [a], [x]"/>',
  '    <item value="1-1-: [b], [y]"/>',
  '    <item value="1-1-: [c], [z]"/>',
  '  </view>',
  '</dir>',
].join(NL);

section('khối ở nửa TRÁI dời lên đầu — nửa PHẢI đứng yên');

const m5 = build(SPLIT);
const rows5 = [rowOf(m5, 'a'), rowOf(m5, 'b'), rowOf(m5, 'c')];
const op5 = {
  kind: 'moveBlock',
  items: [rows5[1].index, rows5[2].index],
  toItem: rows5[0].index,
  side: 'before',
  half: 'left',
};
eq('file cần mở gồm cả dải bị ảnh hưởng', moveControlFiles(m5, op5), [HOST]);
const move5 = planMoveRowBlock(m5, op5, () => SPLIT);
ok('lập kế hoạch được', move5.ok, move5.reason);
eq('nửa trái xoay thành b, c, a — nửa phải vẫn x, y, z', itemsOf(applyFor(SPLIT, move5.edits)), [
  '1-1-: [b], [x]',
  '1-1-: [c], [y]',
  '1-1-: [a], [z]',
]);

section('khối ở nửa PHẢI — đối xứng, nửa trái đứng yên');

const m6 = build(SPLIT);
const rows6 = [rowOf(m6, 'a'), rowOf(m6, 'b'), rowOf(m6, 'c')];
const move6 = planMoveRowBlock(m6, {
  items: [rows6[1].index, rows6[2].index], toItem: rows6[0].index, side: 'before', half: 'right',
}, () => SPLIT);
ok('lập kế hoạch được', move6.ok, move6.reason);
eq('nửa phải xoay thành y, z, x — nửa trái vẫn a, b, c', itemsOf(applyFor(SPLIT, move6.edits)), [
  '1-1-: [a], [y]',
  '1-1-: [b], [z]',
  '1-1-: [c], [x]',
]);

section('không truyền half → vẫn dời CẢ THẺ <item> như cũ');

const m7 = build(SPLIT);
const rows7 = [rowOf(m7, 'a'), rowOf(m7, 'b'), rowOf(m7, 'c')];
const move7 = planMoveRowBlock(m7, {
  items: [rows7[1].index, rows7[2].index], toItem: rows7[0].index, side: 'before',
}, () => SPLIT);
ok('lập kế hoạch được', move7.ok, move7.reason);
eq('cả hàng đi cùng — hai nửa cùng đổi thứ tự', itemsOf(applyFor(SPLIT, move7.edits)), [
  '1-1-: [b], [y]',
  '1-1-: [c], [z]',
  '1-1-: [a], [x]',
]);

section('vùng không khai split → không có nửa nào để dời riêng');

const NOSPLIT = SPLIT.replace(' split="2"', '');
const m8 = build(NOSPLIT);
const rows8 = [rowOf(m8, 'a'), rowOf(m8, 'b'), rowOf(m8, 'c')];
const move8 = planMoveRowBlock(m8, {
  items: [rows8[1].index, rows8[2].index], toItem: rows8[0].index, side: 'before', half: 'left',
}, () => NOSPLIT);
ok('từ chối', move8.ok === false);
ok('nói rõ vì sao', /split/.test(move8.reason || ''), move8.reason);

section('văn bản nguồn đã đổi → TỪ CHỐI, phép so nguyên văn không bao giờ được bỏ');

const stale = planMoveRowBlock(build(SPLIT), {
  items: [rowOf(build(SPLIT), 'b').index, rowOf(build(SPLIT), 'c').index],
  toItem: rowOf(build(SPLIT), 'a').index,
  side: 'before',
  half: 'left',
}, () => SPLIT.replace('[b], [y]', '[bb], [y]'));
ok('từ chối khi file dưới tay đã khác', stale.ok === false, stale.reason);

/* ══════════════════════════════════════════════════════════════════════════
 * 3. TOKEN viết bằng &ENTITY; — đổi chỗ KHÔNG được đụng tới chữ trong token
 * ══════════════════════════════════════════════════════════════════════════ */

section('token có &entity; → đổi chỗ được, entity đi qua nguyên văn');

/*
 * Ca người dùng báo, từ `Dir/zzSQTran.xml`:
 *
 *   <item value="110--------100100: [ma_kh].Label, [ma_kh], [&Revert.Field.1;].Label, [&Revert.Field.1;]"/>
 *
 * Bản trước dựng chuỗi mới từ token của MODEL (đã bung `&Revert.Field.1;` thành `so_ct`) rồi
 * nhờ `textPatch` quy về file nguồn — đoạn phải ghi lại vắt qua ranh giới entity nên bị từ
 * chối. Nhưng đổi chỗ là hoán vị: chữ trong mỗi token đi nguyên vẹn, chỉ đổi chỗ đứng.
 */
const ENT_TOKEN = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [<!ENTITY Rev "so_ct">]>',
  '<dir table="m61">',
  '  <fields>',
  '    <field name="so_ct"><header v="Số ct" e="No"/></field>',
  '    <field name="ong_ba"><header v="Ông bà" e="Contact"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 60, 100, 60, 60"/>',
  '    <item value="110110: [ong_ba].Label, [ong_ba], [&Rev;].Label, [&Rev;]"/>',
  '  </view>',
  '</dir>',
].join(NL);

const m9 = build(ENT_TOKEN);
const row9 = rowOf(m9, 'ong_ba');
const swap9 = planSwapBlock(m9, {
  a: { item: row9.index, col: 0, span: 3 },
  b: { item: row9.index, col: 3, span: 3 },
}, () => ENT_TOKEN);
ok('KHÔNG còn "vắt qua ranh giới entity"', swap9.ok, swap9.reason);

const out9 = applyFor(ENT_TOKEN, swap9.edits);
eq('token entity đổi chỗ nguyên văn, không bung ra chữ so_ct', itemsOf(out9), [
  '110110: [&Rev;].Label, [&Rev;], [ong_ba].Label, [ong_ba]',
]);
ok('không chỗ nào bung entity thành so_ct', !/\[so_ct\]/.test(out9), out9);
ok('khai báo entity không bị đụng', out9.includes('<!ENTITY Rev "so_ct">'));

section('đổi chỗ MỘT cặp cũng đi cùng đường — entity vẫn nguyên văn');

const m10 = build(ENT_TOKEN);
const row10 = rowOf(m10, 'ong_ba');
const one = planSwapControl(m10, {
  item: row10.index,
  cell: cellOf(row10, 'ong_ba'),
  toItem: row10.index,
  other: cellOf(row10, 'so_ct'),
}, () => ENT_TOKEN);
ok('lập kế hoạch được', one.ok, one.reason);
eq('chỉ hai token đổi chỗ, hai token kia đứng yên', itemsOf(applyFor(ENT_TOKEN, one.edits)), [
  '110110: [ong_ba].Label, [&Rev;], [&Rev;].Label, [ong_ba]',
]);

section('PATTERN ghép từ &entity; — span bằng nhau thì vẫn đổi chỗ được');

/*
 * `11&Sp;` bung ra `110110`. Đổi chỗ hai cụm cùng bề rộng thì pattern không đổi một ký tự nào,
 * nên chỉ danh sách token bị ghi lại — mấy ký tự đến từ `&Sp;` không hề bị chạm tới.
 */
const ENT_PATTERN = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [<!ENTITY Sp "0110">]>',
  '<dir table="m61">',
  '  <fields>',
  '    <field name="so_ct"><header v="Số ct" e="No"/></field>',
  '    <field name="ngay_ct" type="DateTime"><header v="Ngày ct" e="Date"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 60, 100, 60, 60"/>',
  '    <item value="11&Sp;: [so_ct].Label, [so_ct], [ngay_ct].Label, [ngay_ct]"/>',
  '  </view>',
  '</dir>',
].join(NL);

const m11 = build(ENT_PATTERN);
const row11 = rowOf(m11, 'so_ct');
eq('pattern bung ra đúng 6 cột', row11.row.pattern, '110110');
const swap11 = planSwapBlock(m11, {
  a: { item: row11.index, col: 0, span: 3 },
  b: { item: row11.index, col: 3, span: 3 },
}, () => ENT_PATTERN);
ok('lập kế hoạch được — pattern không đổi nên không ai phải đụng vào &Sp;', swap11.ok, swap11.reason);
eq('pattern giữ nguyên tham chiếu &Sp;', itemsOf(applyFor(ENT_PATTERN, swap11.edits)), [
  '11&Sp;: [ngay_ct].Label, [ngay_ct], [so_ct].Label, [so_ct]',
]);

section('PATTERN ghép từ &entity; — span khác nhau thì vá ĐÚNG ký tự đổi, ngay trong khai báo entity');

/*
 * Hai dải cùng 3 cột nhưng HÌNH khác nhau — `110` đổi với `100` — nên pattern buộc phải đổi,
 * và mấy ký tự đổi lại nằm gọn trong khai báo `&Sp;`.
 */
const ENT_PATTERN_WIDE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [<!ENTITY Sp "110100">]>',
  '<dir table="m61">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã kh" e="Cust"/></field>',
  '    <field name="so_ct"><header v="Số ct" e="No"/></field>',
  '    <field name="ngay_ct" type="DateTime"><header v="Ngày ct" e="Date"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="60, 60, 60, 60, 60, 60, 60, 60"/>',
  '    <item value="11&Sp;: [ma_kh].Label, [ma_kh], [so_ct].Label, [so_ct], [ngay_ct]"/>',
  '  </view>',
  '</dir>',
].join(NL);

const m12 = build(ENT_PATTERN_WIDE);
const row12 = rowOf(m12, 'so_ct');
eq('pattern bung ra 8 cột', row12.row.pattern, '11110100');
const swap12 = planSwapBlock(m12, {
  a: { item: row12.index, col: 2, span: 3 },
  b: { item: row12.index, col: 5, span: 3 },
}, () => ENT_PATTERN_WIDE);
ok('KHÔNG chặn cả gói vì "pattern viết bằng entity"', swap12.ok, swap12.reason);

/*
 * Hai splice, hai chỗ khác nhau, và đó chính là điểm của cách làm này:
 *   · danh sách token ghi ở chỗ nó nằm — trong `<item value>` của file chủ;
 *   · mấy ký tự pattern thật sự đổi rơi vào đúng khai báo `&Sp;`, không đụng `11` của file chủ.
 * Cùng đường với `patternPlan` của phép kéo giãn, thứ đã chạm được vào hàng lai từ trước.
 */
eq('đúng hai splice', swap12.edits.length, 2);
const out12 = applyFor(ENT_PATTERN_WIDE, swap12.edits);
ok('pattern trong <item> vẫn là tham chiếu &Sp;', out12.includes('value="11&Sp;: '), out12);
ok('ký tự đổi ghi vào khai báo entity', out12.includes('<!ENTITY Sp "100110">'), out12);
eq('token hoán đúng thứ tự', itemsOf(out12),
  ['11&Sp;: [ma_kh].Label, [ma_kh], [ngay_ct], [so_ct].Label, [so_ct]']);
eq('bung lại ra đúng pattern đã tính', build(out12).rows[0].row.pattern, '11100110');
