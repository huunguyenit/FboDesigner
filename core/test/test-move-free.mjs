// test-move-free.mjs — DỜI / ĐỔI CHỖ TỰ DO: qua hàng khác, qua vùng khác, qua tab khác.
//
// Ba thứ được canh ở đây, và chúng là ba lý do tính năng này khó:
//
//   1. Splice vẫn chỉ đụng đúng phần nó nhắm tới. Phép dời qua hàng khác ghi HAI `<item>` —
//      có khi ở hai file — nên bất biến "phần ngoài không đổi một byte" phải đúng cho từng cái.
//   2. Hàng có entity KHÔNG còn bị chặn cả gói. Chỉ đoạn SẮP GHI vắt qua ranh giới entity mới
//      bị từ chối; đoạn nằm gọn trong một nguồn thì ghi vào đúng file sở hữu nguồn ấy.
//   3. Vùng của hàng không được lệch sau phép dời. `categoryIndex` khai trên `<field>` chứ không
//      trên `<item>`, nên dời một token qua hàng khác có thể hất cả một hàng sang vùng khác —
//      đó là loại hỏng im lặng mà mọi phép kiểm dưới đây sinh ra để chặn.

import { ok, eq, section } from './harness.mjs';
import { renderControllerHtml } from '../src/render.mjs';
import { planMoveControl, planSwapControl, moveControlFiles } from '../src/edit.mjs';
import { expandEntities } from '../src/entities.mjs';
import { applySplices } from '../src/spans.mjs';

const NL = '\r\n';
const HOST = 'C:/P/App_Data/Controllers/Dir/Kho.xml';

function build(text, file = HOST, readFile = () => null) {
  const ex = expandEntities(text, { filePath: file, readFile });
  const r = renderControllerHtml(ex.clearText, { segments: ex.segments, hostFile: file });
  return r.model;
}

/** Áp mọi edit của một file rồi khẳng định phần ngoài các splice không đổi một byte. */
function applyFor(text, edits, file = HOST) {
  const mine = edits.filter((e) => e.file === file).map(({ start, end, text: t }) => ({ start, end, text: t }));
  return applySplices(text, mine);
}

const rowOf = (model, field) => model.rows.find((r) => r.row.tokens.some((t) => t.field === field));
const cellOf = (row, field) => row.cells.findIndex((c) => c.token?.field === field && !c.empty);

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Dời sang HÀNG KHÁC trong cùng vùng — ca người dùng nêu đầu tiên.
 * ══════════════════════════════════════════════════════════════════════════ */

const TWO_ROWS = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã khách" e="Code"/></field>',
  '    <field name="ten_kh"><header v="Tên khách" e="Name"/></field>',
  '    <field name="dia_chi"><header v="Địa chỉ" e="Addr"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 100, 100, 100"/>',
  '    <item value="1-1-: [ma_kh], [ten_kh]"/>',
  '    <item value="1---: [dia_chi]"/>',
  '  </view>',
  '</dir>',
].join(NL);

section('dời sang HÀNG KHÁC — cùng vùng, còn slot thì đi được');
const two = build(TWO_ROWS);
const r0 = rowOf(two, 'ma_kh');
const r1 = rowOf(two, 'dia_chi');
ok('hai hàng khác nhau', r0.index !== r1.index);
eq('cùng vùng (header)', [r0.categoryIndex, r1.categoryIndex], [0, 0]);

// `ma_kh` ở hàng 0 cột 0 → xuống hàng 1 cột 2 (đang trống).
const down = planMoveControl(two, { item: r0.index, cell: cellOf(r0, 'ma_kh'), toItem: r1.index, toCol: 2 },
  () => TWO_ROWS);
ok('dời xuống hàng dưới được', down.ok, down.reason);
eq('đúng HAI splice — một hàng nguồn, một hàng đích', down.edits.length, 2);
const afterDown = applyFor(TWO_ROWS, down.edits);
ok('hàng nguồn không còn ma_kh', /value="--1-: \[ten_kh\]"/.test(afterDown), afterDown);
ok('hàng đích nhận ma_kh ở cột 2', /value="1-1-: \[dia_chi\], \[ma_kh\]"/.test(afterDown), afterDown);
ok('comment và phần còn lại của file nguyên vẹn', afterDown.includes('<field name="ten_kh">'));

section('dời sang hàng khác — ô đích đang có control thì TỪ CHỐI');
const taken = planMoveControl(two, { item: r0.index, cell: cellOf(r0, 'ma_kh'), toItem: r1.index, toCol: 0 },
  () => TWO_ROWS);
ok('từ chối', !taken.ok);
ok('nói rõ cột nào đang có người', taken.reason.includes('đang có control'), taken.reason);

section('dời sang hàng khác — vượt khỏi hàng đích thì TỪ CHỐI');
const over = planMoveControl(two, { item: r0.index, cell: cellOf(r0, 'ma_kh'), toItem: r1.index, toCol: 9 },
  () => TWO_ROWS);
ok('từ chối', !over.ok);
ok('nói rõ là vượt hàng', over.reason.includes('vượt khỏi hàng'), over.reason);

section('dời control CUỐI CÙNG của một hàng → bỏ hẳn thẻ <item> nguồn');
// `dia_chi` là control duy nhất của hàng 1; dời nó lên hàng 0 thì hàng 1 rỗng.
const last = planMoveControl(two, { item: r1.index, cell: cellOf(r1, 'dia_chi'), toItem: r0.index, toCol: 3 },
  () => TWO_ROWS);
ok('dời được', last.ok, last.reason);
const afterLast = applyFor(TWO_ROWS, last.edits);
ok('thẻ <item> của hàng nguồn biến mất', !afterLast.includes('[dia_chi]:') && !/value="1---"/.test(afterLast));
ok('dia_chi có mặt ở hàng đích', /value="1-11: \[ma_kh\], \[ten_kh\], \[dia_chi\]"/.test(afterLast), afterLast);
ok('không để lại dòng trắng thừa', !/\r\n\s*\r\n\s*<\/view>/.test(afterLast));

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Dời qua VÙNG khác — tab ↔ header. Đây là chỗ `categoryIndex` vào cuộc.
 * ══════════════════════════════════════════════════════════════════════════ */

const TABS = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã khách" e="Code"/></field>',
  '    <field name="ten_kh"><header v="Tên" e="Name"/></field>',
  '    <field name="ma_nvbh" categoryIndex="1"><header v="NVBH" e="Sales"/></field>',
  '    <field name="ghi_chu" categoryIndex="1"><header v="Ghi chú" e="Note"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 100, 100, 100"/>',
  '    <item value="1-1-: [ma_kh], [ten_kh]"/>',
  '    <item value="1-1-: [ma_nvbh], [ghi_chu]"/>',
  '    <category index="1" header="Khác"/>',
  '  </view>',
  '</dir>',
].join(NL);

section('dời qua VÙNG khác — categoryIndex của field được ghi lại');
const tabs = build(TABS);
const head = rowOf(tabs, 'ma_kh');
const tab1 = rowOf(tabs, 'ma_nvbh');
eq('hàng header ở vùng 0', head.categoryIndex, 0);
eq('hàng tab ở vùng 1', tab1.categoryIndex, 1);

// `ma_nvbh` (tab 1) → hàng header, cột 3 đang trống.
const up = planMoveControl(tabs, { item: tab1.index, cell: cellOf(tab1, 'ma_nvbh'), toItem: head.index, toCol: 3 },
  () => TABS);
ok('dời qua vùng khác được', up.ok, up.reason);
const afterUp = applyFor(TABS, up.edits);
ok('token sang hàng header', /value="1-11: \[ma_kh\], \[ten_kh\], \[ma_nvbh\]"/.test(afterUp), afterUp);
ok('hàng tab chỉ còn ghi_chu', /value="--1-: \[ghi_chu\]"/.test(afterUp), afterUp);
ok('categoryIndex của ma_nvbh thành 0', /<field name="ma_nvbh" categoryIndex="0">/.test(afterUp), afterUp);
ok('categoryIndex của ghi_chu KHÔNG bị đụng', /<field name="ghi_chu" categoryIndex="1">/.test(afterUp));
ok('báo lại đã ghi thuộc tính gì', up.wrote.some((w) => w.includes('ma_nvbh')), JSON.stringify(up.wrote));

section('dời qua vùng khác — GHI TỐI THIỂU: field không khai categoryIndex thì không ghi gì');
// `ten_kh` (header, không khai categoryIndex) → xuống hàng của tab 1. Nó không cầm lái vùng của
// hàng nào cả, nên không có thuộc tính nào phải ghi.
const noWrite = planMoveControl(tabs, { item: head.index, cell: cellOf(head, 'ten_kh'), toItem: tab1.index, toCol: 3 },
  () => TABS);
ok('dời được', noWrite.ok, noWrite.reason);
eq('đúng hai splice, không có splice categoryIndex nào', noWrite.edits.length, 2);
eq('không ghim field nào', noWrite.pinned, []);
const afterNoWrite = applyFor(TABS, noWrite.edits);
ok('khai báo <field name="ten_kh"> không đổi một chữ',
  afterNoWrite.includes('<field name="ten_kh"><header v="Tên" e="Name"/></field>'));
ok('hàng tab nhận ten_kh', /value="1-11: \[ma_nvbh\], \[ghi_chu\], \[ten_kh\]"/.test(afterNoWrite), afterNoWrite);

/* ══════════════════════════════════════════════════════════════════════════
 * 3. GHIM vùng cho hàng nguồn — hàng mất field duy nhất khai categoryIndex.
 * ══════════════════════════════════════════════════════════════════════════ */

const PIN = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã" e="Code"/></field>',
  '    <field name="ma_nvbh" categoryIndex="1"><header v="NVBH" e="Sales"/></field>',
  '    <field name="ghi_chu"><header v="Ghi chú" e="Note"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 100, 100, 100"/>',
  '    <item value="1---: [ma_kh]"/>',
  '    <item value="1-1-: [ma_nvbh], [ghi_chu]"/>',
  '    <category index="1" header="Khác"/>',
  '  </view>',
  '</dir>',
].join(NL);

section('dời đi làm hàng NGUỒN mất vùng → ghim bằng field còn lại');
const pin = build(PIN);
const pinHead = rowOf(pin, 'ma_kh');
const pinTab = rowOf(pin, 'ma_nvbh');
eq('hàng tab đang ở vùng 1 nhờ ma_nvbh', pinTab.categoryIndex, 1);
ok('ghi_chu KHÔNG khai categoryIndex', pin.fieldByName.get('ghi_chu').attrs.categoryIndex === undefined);

const pinned = planMoveControl(pin, { item: pinTab.index, cell: cellOf(pinTab, 'ma_nvbh'), toItem: pinHead.index, toCol: 2 },
  () => PIN);
ok('dời được', pinned.ok, pinned.reason);
ok('có ghim một field lại', pinned.pinned.length > 0, JSON.stringify(pinned.pinned));
/*
 * HAI thuộc tính được ghi, và cả hai đều cần — đây đúng là hình dạng của ca ghim:
 *   ma_nvbh = 0  vì nó vừa sang hàng header mà vẫn khai là thuộc tab 1, tức đang kéo cả hàng
 *                header sang tab 1 nếu để nguyên
 *   ghi_chu = 1  vì hàng tab vừa mất field duy nhất khai vùng, phải nhờ nó đứng ra giữ chỗ
 */
eq('ghi đúng hai field: field vừa dời, rồi field ghim hàng nguồn', pinned.pinned, ['ma_nvbh', 'ghi_chu']);
const afterPin = applyFor(PIN, pinned.edits);
ok('ghi_chu nay khai categoryIndex="1" để giữ hàng ở tab',
  /<field categoryIndex="1" name="ghi_chu">/.test(afterPin), afterPin);
ok('ma_nvbh chuyển về vùng 0', /<field name="ma_nvbh" categoryIndex="0">/.test(afterPin), afterPin);

// Đọc lại bản đã ghi: vùng của mọi hàng phải y hệt ý định.
const reread = build(afterPin);
eq('hàng cũ của tab VẪN ở tab 1', rereadRegion(reread, 'ghi_chu'), 1);
eq('ma_nvbh nay ở header', rereadRegion(reread, 'ma_nvbh'), 0);
function rereadRegion(model, field) {
  return rowOf(model, field)?.categoryIndex;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Dời một ô = một field (span 1); multi qua `targets`; không gom cụm tự động.
 * ══════════════════════════════════════════════════════════════════════════ */

const CLUSTER = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã" e="Code"/></field>',
  '    <field name="ma_nvbh" categoryIndex="1"><header v="NVBH" e="Sales"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 100, 100, 100"/>',
  '    <item value="1---: [ma_kh]"/>',
  '    <item value="11--: [ma_nvbh].Label, [ma_nvbh]"/>',
  '    <category index="1" header="Khác"/>',
  '  </view>',
  '</dir>',
].join(NL);

section('qua vùng — kéo Input chỉ dời Input (Label ở lại), span đặt = 1');
const clu = build(CLUSTER);
const cluHead = rowOf(clu, 'ma_kh');
const cluTab = rowOf(clu, 'ma_nvbh');
const inputCell = cluTab.cells.findIndex((c) => c.token?.field === 'ma_nvbh' && c.token.kind === 'input');
const labelCell = cluTab.cells.findIndex((c) => c.token?.field === 'ma_nvbh' && c.token.kind === 'label');

const withLabel = planMoveControl(clu, { item: cluTab.index, cell: inputCell, toItem: cluHead.index, toCol: 2 },
  () => CLUSTER);
ok('dời được một ô Input', withLabel.ok, withLabel.reason);
eq('đúng một control', withLabel.moved, 1);
const afterClu = applyFor(CLUSTER, withLabel.edits);
ok('chỉ Input sang header; Label còn ở tab',
  /value="1-1-: \[ma_kh\], \[ma_nvbh\]"/.test(afterClu)
  && /\[ma_nvbh\]\.Label/.test(afterClu), afterClu);

section('multi `targets` — dời Label + Input cùng lúc, mỗi cái span 1');
const multi = planMoveControl(clu, {
  item: cluTab.index,
  cell: inputCell,
  toItem: cluHead.index,
  toCol: 2,
  targets: [
    { item: cluTab.index, cell: labelCell },
    { item: cluTab.index, cell: inputCell },
  ],
}, () => CLUSTER);
ok('dời được multi', multi.ok, multi.reason);
eq('hai control', multi.moved, 2);
const afterMulti = applyFor(CLUSTER, multi.edits);
ok('Label rồi Input liền cột từ toCol',
  /value="1-11: \[ma_kh\], \[ma_nvbh\]\.Label, \[ma_nvbh\]"/.test(afterMulti), afterMulti);

section('kéo ô span>1 → giữ span gốc khi đích đủ chỗ trống');
const NUDGE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="ct">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã" e="Code"/></field>',
  '    <field name="ma_thue" categoryIndex="1"><header v="Thuế" e="Tax"/></field>',
  '    <field name="thue_suat" categoryIndex="1"><header v="Suất" e="Rate"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="30, 30, 30, 30, 30, 30, 30, 30"/>',
  '    <item value="110-----: [ma_kh].Label, [ma_kh]"/>',
  '    <item value="1101----: [ma_thue].Label, [ma_thue], [thue_suat]"/>',
  '    <category index="1" header="Thuế"/>',
  '  </view>',
  '</dir>',
].join(NL);
const nudge = build(NUDGE);
const nudgeFrom = rowOf(nudge, 'ma_kh');
const nudgeTo = rowOf(nudge, 'ma_thue');
const nudgeInput = nudgeFrom.cells.findIndex((c) => c.token?.field === 'ma_kh' && c.token.kind === 'input');
eq('ma_kh input đang span 2 (pattern 110-----)', nudgeFrom.cells[nudgeInput].span, 2);
const nudged = planMoveControl(nudge,
  { item: nudgeFrom.index, cell: nudgeInput, toItem: nudgeTo.index, toCol: 4 },
  () => NUDGE);
ok('dời được (chỉ Input)', nudged.ok, nudged.reason);
eq('neo đúng cột thả', nudged.dropAnchor, 4);
const afterNudge = applyFor(NUDGE, nudged.edits);
ok('Input giữ span 2 tại cột thả; Label nguồn ở lại',
  /value="110110--: \[ma_thue\]\.Label, \[ma_thue\], \[thue_suat\], \[ma_kh\]"/.test(afterNudge)
  && /\[ma_kh\]\.Label/.test(afterNudge),
  afterNudge);

section('dời token span 7 vào 7 slot trống → giữ span 7');
const WIDE_MOVE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkh">',
  '  <fields>',
  '    <field name="ten_kh%l"><header v="Ten" e="Name"/></field>',
  '    <field name="ong_ba"><header v="Ong" e="O"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100,100,100,100,100,100,100,100"/>',
  '    <item value="1000000-: [ten_kh%l]"/>',
  '    <item value="1-------: [ong_ba]"/>',
  '  </view>',
  '</dir>',
].join(NL);
const wm = build(WIDE_MOVE);
const wmFrom = rowOf(wm, 'ten_kh%l');
const wmTo = rowOf(wm, 'ong_ba');
const wmCell = cellOf(wmFrom, 'ten_kh%l');
eq('ten_kh%l span 7', wmFrom.cells[wmCell].span, 7);
const wmPlan = planMoveControl(wm,
  { item: wmFrom.index, cell: wmCell, toItem: wmTo.index, toCol: 1 },
  () => WIDE_MOVE);
ok('dời được', wmPlan.ok, wmPlan.reason);
const afterWm = applyFor(WIDE_MOVE, wmPlan.edits);
ok('hàng ong_ba nhận ten_kh%l span 7',
  /value="11000000: \[ong_ba\], \[ten_kh%l\]"/.test(afterWm), afterWm);
ok('hàng nguồn không còn ten_kh%l',
  !/1000000-:\s*\[ten_kh%l\]/.test(afterWm), afterWm);

section('qua vùng — Label/Input tách hàng vẫn dời được từng ô');
const SPLIT_CLUSTER = CLUSTER
  .replace('<item value="11--: [ma_nvbh].Label, [ma_nvbh]"/>',
    '<item value="1---: [ma_nvbh]"/>' + NL + '    <item value="1---: [ma_nvbh].Label"/>');
const sc = build(SPLIT_CLUSTER);
const scTab = sc.rows.find((r) => r.row.tokens.some((t) => t.field === 'ma_nvbh' && t.kind === 'input'));
const scMove = planMoveControl(sc,
  { item: scTab.index, cell: cellOf(scTab, 'ma_nvbh'), toItem: rowOf(sc, 'ma_kh').index, toCol: 2 },
  () => SPLIT_CLUSTER);
ok('dời Input dù Label ở hàng khác', scMove.ok, scMove.reason);

section('trong cùng hàng — kéo một ô là một ô, span đặt = 1');
const sameRegion = planMoveControl(clu,
  { item: cluTab.index, cell: inputCell, toItem: cluTab.index, toCol: 3 }, () => CLUSTER);
ok('dời trong cùng hàng vẫn chạy', sameRegion.ok, sameRegion.reason);
eq('đúng một splice', sameRegion.edits.length, 1);

/* ══════════════════════════════════════════════════════════════════════════
 * 5. ENTITY — không còn khoá cả gói.
 * ══════════════════════════════════════════════════════════════════════════ */

section('hàng có entity trong TOKEN vẫn dời được, entity giữ nguyên văn');
const ENT_TOKEN = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [<!ENTITY k "ma_kh">]>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã" e="Code"/></field>',
  '    <field name="ten_kh"><header v="Tên" e="Name"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 100, 100, 100"/>',
  '    <item value="1---: [&k;]"/>',
  '    <item value="1---: [ten_kh]"/>',
  '  </view>',
  '</dir>',
].join(NL);
const et = build(ENT_TOKEN);
const etFrom = rowOf(et, 'ma_kh');
const etTo = rowOf(et, 'ten_kh');
const etMove = planMoveControl(et, { item: etFrom.index, cell: cellOf(etFrom, 'ma_kh'), toItem: etTo.index, toCol: 2 },
  () => ENT_TOKEN);
ok('KHÔNG còn bị từ chối vì "hàng có entity"', etMove.ok, etMove.reason);
const afterEt = applyFor(ENT_TOKEN, etMove.edits);
ok('token giữ nguyên văn &k;', afterEt.includes('[&k;]'), afterEt);
ok('không bung entity ra chữ ma_kh', !/\[ma_kh\]/.test(afterEt), afterEt);
ok('hàng đích nhận đúng token entity', /value="1-1-: \[ten_kh\], \[&k;\]"/.test(afterEt), afterEt);

section('hàng đến từ INCLUDE — splice rơi vào file Include, kèm warning cho tầng vỏ');
const INC_FILE = 'C:/P/App_Data/Controllers/Include/Rows.xml';
const INC_BODY = '<item value="1---: [ma_kh]"/>';
const ENT_ROW = [
  '<?xml version="1.0" encoding="utf-8"?>',
  `<!DOCTYPE dir [<!ENTITY Shared SYSTEM "../Include/Rows.xml">]>`,
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã" e="Code"/></field>',
  '    <field name="ten_kh"><header v="Tên" e="Name"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 100, 100, 100"/>',
  '    &Shared;',
  '    <item value="1---: [ten_kh]"/>',
  '  </view>',
  '</dir>',
].join(NL);
const inc = build(ENT_ROW, HOST, (abs) => (String(abs).replace(/\\/g, '/').endsWith('Include/Rows.xml') ? INC_BODY : null));
const incFrom = rowOf(inc, 'ma_kh');
const incTo = rowOf(inc, 'ten_kh');
ok('hàng của Include được đánh dấu foreign', incFrom.foreign === true);
const texts = new Map([[HOST.toLowerCase(), ENT_ROW]]);
const incMove = planMoveControl(inc, { item: incFrom.index, cell: cellOf(incFrom, 'ma_kh'), toItem: incTo.index, toCol: 2 },
  (f) => {
    const key = String(f).replace(/\\/g, '/').toLowerCase();
    return key.endsWith('include/rows.xml') ? INC_BODY : texts.get(key) ?? null;
  });
ok('dời được', incMove.ok, incMove.reason);
ok('có warning để tầng vỏ hỏi trước khi ghi', typeof incMove.warning === 'string' && incMove.warning.length > 0);
const incEdit = incMove.edits.find((e) => String(e.file).replace(/\\/g, '/').endsWith('Include/Rows.xml'));
ok('một splice ghi vào chính file Include', !!incEdit, JSON.stringify(incMove.edits.map((e) => e.file)));
const hostEdit = incMove.edits.find((e) => String(e.file).replace(/\\/g, '/').endsWith('Dir/Kho.xml'));
ok('một splice ghi vào controller (hàng đích)', !!hostEdit);
eq('file Include sau khi ghi: hàng rỗng nên thẻ bị bỏ',
  applySplices(INC_BODY, [{ start: incEdit.start, end: incEdit.end, text: incEdit.text }]).trim(), '');

section('moveControlFiles nói trước phải mở những file nào');
const files = moveControlFiles(inc, { item: incFrom.index, cell: cellOf(incFrom, 'ma_kh'), toItem: incTo.index, toCol: 2 });
eq('đúng hai file', files.length, 2);
ok('có file Include', files.some((f) => String(f).replace(/\\/g, '/').endsWith('Include/Rows.xml')));

/* ══════════════════════════════════════════════════════════════════════════
 * 6. ĐỔI CHỖ qua hàng khác.
 * ══════════════════════════════════════════════════════════════════════════ */

section('đổi chỗ hai control ở HAI HÀNG khác nhau — cùng span thì pattern đứng yên');
const swapTwo = build(TWO_ROWS);
const sr0 = rowOf(swapTwo, 'ma_kh');
const sr1 = rowOf(swapTwo, 'dia_chi');
const crossSwap = planSwapControl(swapTwo,
  { item: sr0.index, cell: cellOf(sr0, 'ma_kh'), toItem: sr1.index, other: cellOf(sr1, 'dia_chi') },
  () => TWO_ROWS);
ok('đổi chỗ được', crossSwap.ok, crossSwap.reason);
eq('đúng hai splice', crossSwap.edits.length, 2);
const afterSwap = applyFor(TWO_ROWS, crossSwap.edits);
ok('hàng 0 nay mang dia_chi', /value="1-1-: \[dia_chi\], \[ten_kh\]"/.test(afterSwap), afterSwap);
ok('hàng 1 nay mang ma_kh', /value="1---: \[ma_kh\]"/.test(afterSwap), afterSwap);

section('đổi chỗ khác hàng — khác span: giữ span gốc, thu về min');
const WIDE = TWO_ROWS.replace('<item value="1---: [dia_chi]"/>', '<item value="10--: [dia_chi]"/>');
const wide = build(WIDE);
const wr0 = rowOf(wide, 'ma_kh');
const wr1 = rowOf(wide, 'dia_chi');
const wideCross = planSwapControl(wide,
  { item: wr0.index, cell: cellOf(wr0, 'ma_kh'), toItem: wr1.index, other: cellOf(wr1, 'dia_chi') },
  () => WIDE);
ok('đổi chỗ được', wideCross.ok, wideCross.reason);
const afterWide = applyFor(WIDE, wideCross.edits);
ok('hàng hẹp nhận dia_chi span 1', /value="1-1-: \[dia_chi\], \[ten_kh\]"/.test(afterWide), afterWide);
ok('hàng rộng thu ma_kh về span 1', /value="1---: \[ma_kh\]"/.test(afterWide), afterWide);

/* ══════════════════════════════════════════════════════════════════════════
 * 7. Từ chối khi phép dời hất một hàng KHÁC sang vùng khác.
 * ══════════════════════════════════════════════════════════════════════════ */

section('dời làm một hàng KHÁC đổi vùng → TỪ CHỐI, không hỏng im lặng');
/*
 * `ma_nvbh` khai categoryIndex=1 và được dùng ở HAI hàng của tab. Dời một ô sang header buộc
 * phải ghi categoryIndex=0 cho nó — và cú ghi ấy sẽ kéo luôn hàng tab còn lại sang header.
 * Không ghim được (hàng kia chỉ có mỗi ma_nvbh), nên phải từ chối.
 */
const SHARED = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã" e="Code"/></field>',
  '    <field name="ma_nvbh" categoryIndex="1"><header v="NVBH" e="Sales"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 100, 100, 100"/>',
  '    <item value="1---: [ma_kh]"/>',
  '    <item value="1---: [ma_nvbh]"/>',
  '    <item value="1---: [ma_nvbh].Label"/>',
  '    <category index="1" header="Khác"/>',
  '  </view>',
  '</dir>',
].join(NL);
const sh = build(SHARED);
const shTab = sh.rows.find((r) => r.row.tokens.some((t) => t.field === 'ma_nvbh' && t.kind === 'input'));
const shRefuse = planMoveControl(sh,
  { item: shTab.index, cell: cellOf(shTab, 'ma_nvbh'), toItem: rowOf(sh, 'ma_kh').index, toCol: 2 },
  () => SHARED);
ok('từ chối', !shRefuse.ok);
ok('lý do đọc ra nghĩa', /cụm|vùng/.test(shRefuse.reason), shRefuse.reason);

section('file nguồn đã đổi thì TỪ CHỐI — phép so nguyên văn không bao giờ được bỏ');
const stale = planMoveControl(two, { item: r0.index, cell: cellOf(r0, 'ma_kh'), toItem: r1.index, toCol: 2 },
  () => TWO_ROWS.replace('[ten_kh]', '[ten_kh_x]'));
ok('từ chối', !stale.ok);
ok('nói rõ là file nguồn đã đổi', stale.reason.includes('file nguồn đã đổi'), stale.reason);
