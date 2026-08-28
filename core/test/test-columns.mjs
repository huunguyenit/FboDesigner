// test-columns.mjs — tách/gộp BIÊN CỘT của một vùng form.
//
// Đây là phép sửa duy nhất đụng tới thứ DÙNG CHUNG giữa nhiều hàng, nên bất biến phải kiểm là
// bất biến "cả chùm": list px, pattern của mọi hàng phụ thuộc, và `anchor`/`split` của mọi vùng
// phụ thuộc phải đổi CÙNG NHAU, hoặc không đổi gì cả.
//
// Bất biến thứ hai, kiểm ở mọi ca: **số token không đổi**. Tách hay gộp một biên không được
// làm mất một `[field]` nào — mất token là mất một control mà runtime không báo gì.

import { ok, eq, section } from './harness.mjs';
import {
  splitPatternAt, mergePatternAt, splitWidthsAt, mergeWidthsAt,
} from '../src/columns.mjs';
import { planRegionColumns, regionColumnFiles } from '../src/edit.mjs';
import { renderControllerHtml } from '../src/render.mjs';
import { expandEntities } from '../src/entities.mjs';
import { applySplices } from '../src/spans.mjs';
import { parseRow, parseWidths, buildCells } from '../src/item-value.mjs';

const NL = '\r\n';
const FILE = 'C:/P/App_Data/Controllers/Dir/Kho.xml';

function build(text, file = FILE, readFile = () => null) {
  const ex = expandEntities(text, { filePath: file, readFile });
  const r = renderControllerHtml(ex.clearText, { segments: ex.segments, hostFile: file });
  return { model: r.model, warnings: r.warnings, file };
}

/** Áp cả chùm splice lên đúng file của nó — nhiều file thì mỗi file một danh sách. */
function applyAll(texts, edits) {
  const byFile = new Map();
  for (const e of edits) {
    if (!byFile.has(e.file)) byFile.set(e.file, []);
    byFile.get(e.file).push({ start: e.start, end: e.end, text: e.text });
  }
  const out = { ...texts };
  for (const [file, list] of byFile) out[file] = applySplices(texts[file], list);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
section('đại số pattern — tách một cột làm hai');

eq('cột trống thì nửa mới cũng trống', splitPatternAt('1-1-', 1), '1--1-');
eq('cột đang là thân ô thì ô nở thêm một cột', splitPatternAt('100-', 1), '1000-');
eq('cột mở ô thì chèn `0`, span 1 thành 2', splitPatternAt('1---', 0), '10---');
eq('cột cuối cùng', splitPatternAt('---1', 3), '---10');
eq('pattern ngắn hơn cột đang tách → không đụng vào', splitPatternAt('11', 5), '11');
eq('`0` mồ côi vẫn là ô trống sau khi tách', splitPatternAt('-0--', 1), '-00--');

ok('tách KHÔNG BAO GIỜ đẻ thêm ký tự `1`', ['1100', '1-1-', '-01-', '----', '1']
  .every((p) => [...Array(p.length).keys()]
    .every((c) => count(splitPatternAt(p, c), '1') === count(p, '1'))));

function count(s, ch) { let n = 0; for (const c of s) if (c === ch) n++; return n; }

// ─────────────────────────────────────────────────────────────────────────────
section('đại số pattern — gộp hai cột liền kề');

eq('thân ô co lại một cột', mergePatternAt('1100', 1), { ok: true, pattern: '110' });
eq('ô nuốt cột trống bên phải', mergePatternAt('1---', 0), { ok: true, pattern: '1--' });
eq('control bên phải dời sang cột đã gộp', mergePatternAt('1-1-', 1), { ok: true, pattern: '11-' });
eq('hai cột đều trống', mergePatternAt('1---', 1), { ok: true, pattern: '1--' });
eq('`0` mồ côi nhường chỗ cho control bên phải', mergePatternAt('-01-', 1), { ok: true, pattern: '-1-' });
eq('cột phải vốn nằm ngoài pattern → không có gì để bỏ', mergePatternAt('11', 1), { ok: true, pattern: '11' });

const clash = mergePatternAt('11--', 0);
ok('hai control cạnh nhau thì TỪ CHỐI, không nuốt cái nào', clash.ok === false);
ok('nói rõ vì sao', /hai control khác nhau/.test(clash.reason), clash.reason);

const clash2 = mergePatternAt('101-', 1);
ok('thân ô đụng control kế bên cũng TỪ CHỐI', clash2.ok === false, clash2.reason);

ok('gộp KHÔNG BAO GIỜ làm mất một ký tự `1`', ['1100', '1-1-', '-01-', '----', '10-1']
  .every((p) => [...Array(p.length).keys()].every((c) => {
    const r = mergePatternAt(p, c);
    return !r.ok || count(r.pattern, '1') === count(p, '1');
  })));

// ─────────────────────────────────────────────────────────────────────────────
section('đại số list px — giữ nguyên nếp viết của file');

eq('tách giữ cách ngăn cách', splitWidthsAt('100, 60, 90', 1, 30, 30), { ok: true, value: '100, 30, 30, 90' });
eq('tách không dấu cách', splitWidthsAt('100,60,90', 1, 25, 35), { ok: true, value: '100,25,35,90' });
eq('gộp cộng hai bề rộng lại', mergeWidthsAt('100, 30, 30, 90', 1), { ok: true, value: '100, 60, 90' });
eq('mảnh rỗng không tính là cột, và không bị dọn đi', mergeWidthsAt('100,,30, 30', 1), { ok: true, value: '100,,60' });
ok('tách cột không tồn tại thì từ chối', splitWidthsAt('100, 60', 5, 10, 10).ok === false);
ok('gộp ở cột cuối thì từ chối', mergeWidthsAt('100, 60', 1).ok === false);
ok('bề rộng âm thì từ chối', splitWidthsAt('100, 60', 1, -5, 65).ok === false);

// ─────────────────────────────────────────────────────────────────────────────
section('tách cột — cả chùm splice trên một controller');

const DOC = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkho">',
  '  <!-- comment phải sống sót qua mọi phép sửa -->',
  '  <fields>',
  '    <field name="ma_kho"><header v="Mã kho" e="Code"/></field>',
  '    <field name="ten_kho"><header v="Tên kho" e="Name"/></field>',
  '    <field name="dia_chi"><header v="Địa chỉ" e="Address"/></field>',
  '  </fields>',
  '  <view id="Dir" anchor="3" split="2">',
  '    <item value="100, 60, 90, 150"/>',
  '    <item value="1100: [ma_kho].Label, [ma_kho]"/>',
  '    <item value="11--: [ten_kho].Label, [ten_kho]"/>',
  '    <item value="--11: [dia_chi].Label, [dia_chi]"/>',
  '  </view>',
  '</dir>',
].join(NL);

const base = build(DOC);
const read = (f) => (f === FILE ? DOC : null);

const split1 = planRegionColumns(base.model, { kind: 'splitColumn', region: 'header', col: 1 }, read);
ok('tách cột 2 của dải header — lập kế hoạch được', split1.ok, split1.reason);
eq('mọi splice nằm trong controller đang mở', [...new Set(split1.edits.map((e) => e.file))], [FILE]);
eq('không có file dùng chung nào bị đụng', split1.warning, []);
eq('sửa đúng chỗ khai list px', split1.summary.owner, '<item> list px của view');

const afterSplit = applyAll({ [FILE]: DOC }, split1.edits)[FILE];
ok('comment sống sót', afterSplit.includes('<!-- comment phải sống sót qua mọi phép sửa -->'));
ok('list px thành 5 cột, 60 chia đôi', afterSplit.includes('value="100, 30, 30, 90, 150"'), lineOf(afterSplit, 'value="100,'));
ok('hàng span 2 nở thành span 3', afterSplit.includes('value="11000: [ma_kho]'), lineOf(afterSplit, '[ma_kho]'));
ok('hàng dừng ở cột 2 nở theo', afterSplit.includes('value="110--: [ten_kho]'), lineOf(afterSplit, '[ten_kho]'));
ok('hàng ở hai cột cuối bị đẩy sang phải một nấc', afterSplit.includes('value="---11: [dia_chi]'), lineOf(afterSplit, '[dia_chi]'));
ok('anchor="3" (cột sau chỗ tách) dời thành 4', /anchor="4"/.test(afterSplit), lineOf(afterSplit, '<view'));
ok('split="2" (vạch ngay tại chỗ tách) dời thành 3', /split="3"/.test(afterSplit), lineOf(afterSplit, '<view'));

function lineOf(text, needle) {
  const i = text.indexOf(needle);
  if (i === -1) return `KHÔNG TÌM THẤY ${needle}`;
  return text.slice(text.lastIndexOf('\n', i) + 1, text.indexOf('\n', i)).trim();
}

/** Ô của từng hàng, đo lại từ văn bản đã ghi — đây mới là phép kiểm "toạ độ không lệch". */
function cellMap(text) {
  const values = [...text.matchAll(/<item value="([^"]*)"\/>/g)].map((m) => m[1]);
  const widths = parseWidths(values[0]).widths;
  return values.slice(1).map((v) => buildCells(parseRow(v), widths).cells
    .filter((c) => !c.empty)
    .map((c) => `${c.token.raw}@${c.col}+${c.span}`));
}

section('tách rồi gộp lại phải về đúng chỗ cũ');

const back = build(afterSplit);
const merge1 = planRegionColumns(back.model, { kind: 'mergeColumn', region: 'header', col: 1 },
  (f) => (f === FILE ? afterSplit : null));
ok('gộp lại được', merge1.ok, merge1.reason);
const afterMerge = applyAll({ [FILE]: afterSplit }, merge1.edits)[FILE];
eq('văn bản về đúng bản gốc từng byte', afterMerge, DOC);

section('tách KHÔNG làm lệch toạ độ ô nào');

const beforeCells = cellMap(DOC);
const splitCells = cellMap(afterSplit);
eq('số token của từng hàng không đổi', splitCells.map((r) => r.length), beforeCells.map((r) => r.length));
eq('ô của ma_kho vẫn ở cột 0, nở thêm nửa cột mới nên bề rộng không đổi',
  splitCells[0], ['[ma_kho].Label@0+1', '[ma_kho]@1+4']);
eq('ô của dia_chi đẩy sang phải một cột, bề rộng giữ nguyên', splitCells[2], ['[dia_chi].Label@3+1', '[dia_chi]@4+1']);

// ─────────────────────────────────────────────────────────────────────────────
section('gộp bị TỪ CHỐI khi hai cột đang giữ hai control');

const refuse = planRegionColumns(base.model, { kind: 'mergeColumn', region: 'header', col: 2 }, read);
ok('không cho gộp', refuse.ok === false);
ok('chỉ đích danh item nào chắn', /item 3/.test(refuse.reason), refuse.reason);

const refuseSplitMarker = planRegionColumns(base.model, { kind: 'mergeColumn', region: 'header', col: 1 }, read);
ok('gộp trúng vạch split thì TỪ CHỐI, không đoán', refuseSplitMarker.ok === false);
ok('nói rõ split là thứ chắn', /split=/.test(refuseSplitMarker.reason), refuseSplitMarker.reason);

// ─────────────────────────────────────────────────────────────────────────────
section('list px riêng của một tab — chỉ hàng của tab đó bị dồn');

const TABS = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kho"><header v="Mã kho" e="Code"/></field>',
  '    <field name="ten_kho" categoryIndex="1"><header v="Tên kho" e="Name"/></field>',
  '    <field name="ghi_chu" categoryIndex="2"><header v="Ghi chú" e="Note"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <categories>',
  '      <category index="1" columns="80, 40, 120"><header v="Chung" e="General"/></category>',
  '      <category index="2"><header v="Khác" e="Other"/></category>',
  '    </categories>',
  '    <item value="100, 60, 90"/>',
  '    <item value="1100: [ma_kho].Label, [ma_kho]"/>',
  '    <item value="110: [ten_kho].Label, [ten_kho]"/>',
  '    <item value="110: [ghi_chu].Label, [ghi_chu]"/>',
  '  </view>',
  '</dir>',
].join(NL);

const tabs = build(TABS);
const readTabs = (f) => (f === FILE ? TABS : null);

const catSplit = planRegionColumns(tabs.model, { kind: 'splitColumn', region: 'cat:1', col: 0 }, readTabs);
ok('tách cột của tab có `columns` riêng', catSplit.ok, catSplit.reason);
eq('ghi vào đúng `<category columns>`, không đụng list px của view', catSplit.summary.owner, '<category index="1" columns>');
eq('chỉ MỘT vùng dùng chung list px này', catSplit.summary.regions, ['cat:1']);
eq('chỉ dồn một hàng', catSplit.summary.rows, 1);

const afterCat = applyAll({ [FILE]: TABS }, catSplit.edits)[FILE];
ok('columns của tab 1 đổi, giữ nếp `, ` của file', afterCat.includes('columns="40, 40, 40, 120"'), lineOf(afterCat, 'columns='));
ok('list px của view KHÔNG đổi', afterCat.includes('<item value="100, 60, 90"/>'));
ok('hàng của tab 1 dồn theo — control ở cột 0 nở ra ôm cả hai nửa',
  afterCat.includes('value="1010: [ten_kho]'), lineOf(afterCat, '[ten_kho]'));
ok('hàng của tab 2 KHÔNG đụng tới', afterCat.includes('value="110: [ghi_chu]'), lineOf(afterCat, '[ghi_chu]'));
ok('hàng của dải header KHÔNG đụng tới', afterCat.includes('value="1100: [ma_kho]'), lineOf(afterCat, '[ma_kho]'));

section('tab KHÔNG khai columns thì dùng chung list px của view');

const viewSplit = planRegionColumns(tabs.model, { kind: 'splitColumn', region: 'cat:2', col: 1 }, readTabs);
ok('lập kế hoạch được', viewSplit.ok, viewSplit.reason);
eq('chỗ ghi là list px của VIEW', viewSplit.summary.owner, '<item> list px của view');
eq('mọi vùng dùng chung nó đều nằm trong phạm vi', viewSplit.summary.regions.sort(), ['cat:2', 'header']);
eq('dồn cả hàng của dải header lẫn hàng của tab 2', viewSplit.summary.rows, 2);

const afterView = applyAll({ [FILE]: TABS }, viewSplit.edits)[FILE];
ok('hàng của tab 1 vẫn nguyên (nó đọc columns riêng)', afterView.includes('value="110: [ten_kho]'), lineOf(afterView, '[ten_kho]'));
ok('hàng của dải header dồn theo', afterView.includes('value="11000: [ma_kho]'), lineOf(afterView, '[ma_kho]'));
ok('hàng của tab 2 dồn theo', afterView.includes('value="1100: [ghi_chu]'), lineOf(afterView, '[ghi_chu]'));

// ─────────────────────────────────────────────────────────────────────────────
section('view không khai list px thì không có biên nào để tách');

const NOWIDTHS = [
  '<dir table="dmkho">',
  '  <fields><field name="ma_kho"><header v="Mã" e="Code"/></field></fields>',
  '  <view id="Dir">',
  '    <item value="11: [ma_kho].Label, [ma_kho]"/>',
  '  </view>',
  '</dir>',
].join(NL);
const noW = build(NOWIDTHS);
const noWPlan = planRegionColumns(noW.model, { kind: 'splitColumn', region: 'header', col: 0 },
  () => NOWIDTHS);
ok('TỪ CHỐI, không bịa ra một list px', noWPlan.ok === false);
ok('nói rõ số cột đang suy từ pattern', /suy từ pattern/.test(noWPlan.reason), noWPlan.reason);

// ─────────────────────────────────────────────────────────────────────────────
section('hàng nằm ở file Include — splice rơi đúng file đó, và được cảnh báo');

const INC = 'C:/P/App_Data/Controllers/Include/Kho.Rows';
const INC_TEXT = ['<!ENTITY Kho.Rows \'',
  '<item value="1100: [ma_kho].Label, [ma_kho]"/>',
  '<item value="--11: [ten_kho].Label, [ten_kho]"/>',
  '\'>'].join(NL);
const HOST = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [',
  '  <!ENTITY % inc SYSTEM "..\\Include\\Kho.Rows">',
  '  %inc;',
  ']>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kho"><header v="Mã kho" e="Code"/></field>',
  '    <field name="ten_kho"><header v="Tên kho" e="Name"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60, 90, 150"/>',
  '    &Kho.Rows;',
  '  </view>',
  '</dir>',
].join(NL);

const inc = build(HOST, FILE, (p) => (p.replace(/\\/g, '/').endsWith('Include/Kho.Rows') ? INC_TEXT : null));
ok('bung được entity (nếu không thì mấy ca dưới vô nghĩa)', inc.model.rows.length === 2,
  `rows=${inc.model.rows.length}`);

const incFiles = regionColumnFiles(inc.model, { kind: 'splitColumn', region: 'header', col: 1 });
eq('phải mở CẢ HAI file trước khi ghi', incFiles.map((f) => f.split('/').pop()).sort(), ['Kho.Rows', 'Kho.xml']);

const incPlan = planRegionColumns(inc.model, { kind: 'splitColumn', region: 'header', col: 1 },
  (f) => ({ [FILE]: HOST, [INC]: INC_TEXT }[f] ?? null));
ok('lập kế hoạch được', incPlan.ok, incPlan.reason);
eq('cảnh báo nêu đúng file dùng chung', incPlan.warning, [INC]);

const out = applyAll({ [FILE]: HOST, [INC]: INC_TEXT }, incPlan.edits);
ok('list px sửa trong controller', out[FILE].includes('value="100, 30, 30, 90, 150"'));
ok('pattern sửa trong Include, không nhân bản nội dung sang controller',
  out[INC].includes('value="11000: [ma_kho]') && out[INC].includes('value="---11: [ten_kho]'),
  lineOf(out[INC], '[ma_kho]'));
ok('controller vẫn giữ nguyên tham chiếu &Kho.Rows;', out[FILE].includes('&Kho.Rows;'));

// ─────────────────────────────────────────────────────────────────────────────
section('văn bản trong file đã đổi dưới chân thì TỪ CHỐI cả chùm');

// Thêm MỘT ký tự ở đầu file là mọi offset phía sau lệch một nấc — đúng cảnh người dùng vừa gõ
// tay vào XML trong lúc panel designer còn cầm model cũ.
const stale = planRegionColumns(base.model, { kind: 'splitColumn', region: 'header', col: 1 },
  () => DOC.replace('<dir table="dmkho">', '<dir table="dmkho2">'));
ok('không ghi gì', stale.ok === false);
ok('nói rõ file nguồn đã đổi', /file nguồn đã đổi/.test(stale.reason), stale.reason);
