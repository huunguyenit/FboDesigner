// test-outline.mjs — mục lục của một file controller (`Ctrl+Shift+O`).
//
// Hai bất biến gánh phần lớn giá trị của file này:
//
//   1. MỌI DẢI CẮT RA ĐÚNG THỨ NÓ NÓI. Mục lục sai dải thì bấm vào một mục là con trỏ nhảy sai
//      chỗ — tệ hơn không có mục lục, vì người ta tin nó.
//   2. DẢI CHỌN NẰM TRONG DẢI PHẦN TỬ. VS Code NÉM nếu không, và ném lúc mở outline thì cả cây
//      biến mất chứ không hỏng riêng một mục.
//
// Cộng một quyết định phải giữ: quét VĂN BẢN THÔ, không bung entity. Outline là mục lục của tài
// liệu đang mở.

import { ok, eq, section } from './harness.mjs';
import { buildOutline } from '../src/outline.mjs';

const NL = '\r\n';

const FORM = [
  '<?xml version="1.0"?>',
  '<!DOCTYPE dir [ <!ENTITY Rows SYSTEM "../Include/R.ent"> ]>',
  '<dir table="dmkh">',
  '  <fields>',
  '    <field name="ma_kh" width="80"><header v="Mã KH" e="Code"/></field>',
  '    <field name="ten_kh" type="String"><header v="Tên KH" e="Name"/></field>',
  '  </fields>',
  '  <view id="Dir" height="302">',
  '    <item value="100, 60, 90"/>',
  '    <item value="110: [ma_kh].Label, [ma_kh]"/>',
  '    &Rows;',
  '    <categories><category index="1" columns="300"><header v="Chi tiết" e="Detail"/></category></categories>',
  '  </view>',
  '  <toolbar><button command="New"><title v="Thêm" e="New"/></button></toolbar>',
  '</dir>',
].join(NL);

const tree = buildOutline(FORM);
const byName = (ns, n) => ns.find((x) => x.name.startsWith(n));
const flat = (ns) => ns.flatMap((n) => [n, ...flat(n.children)]);

section('outline — không có nút gốc, các mục theo đúng thứ tự trong file');
/*
 * Không bọc `<dir table="…">` ra ngoài: VS Code đã hiện tên file ngay trên cây, nên nút gốc chỉ
 * là một tầng phải bung ra mỗi lần mở, đổi lấy thông tin đã có ở nhãn tab.
 */
eq('ba mục ở tầng đầu', tree.map((n) => n.name), ['fields (2)', 'view "Dir"', 'toolbar (1)']);
ok('sắp theo vị trí trong file', tree.every((n, i) => i === 0 || tree[i - 1].start < n.start));

section('outline — mọi dải cắt ra đúng thứ nó nói');
const fields = byName(tree, 'fields');
eq('field đầu cắt ra trọn phần tử',
  FORM.slice(fields.children[0].start, fields.children[0].end),
  '<field name="ma_kh" width="80"><header v="Mã KH" e="Code"/></field>');
eq('dải CHỌN của field là đúng cái tên',
  FORM.slice(fields.children[0].selectionStart, fields.children[0].selectionEnd), 'ma_kh');
eq('nhãn kèm header và bề rộng', fields.children[0].detail, 'Mã KH · 80px');

const view = byName(tree, 'view');
eq('view cắt ra trọn khối', FORM.slice(view.start, view.end).startsWith('<view id="Dir"'), true);
ok('và kết thúc ở thẻ đóng', FORM.slice(view.start, view.end).endsWith('</view>'));
eq('dải chọn của view là id', FORM.slice(view.selectionStart, view.selectionEnd), 'Dir');
eq('detail nói chiều cao', view.detail, 'height="302"');

const toolbar = byName(tree, 'toolbar');
eq('nút cắt ra trọn phần tử',
  FORM.slice(toolbar.children[0].start, toolbar.children[0].end),
  '<button command="New"><title v="Thêm" e="New"/></button>');

section('outline — BẤT BIẾN: dải chọn luôn nằm trong dải phần tử');
/*
 * VS Code NÉM khi `selectionRange` không nằm trong `range`, và ném lúc dựng outline thì mất cả
 * cây chứ không mất riêng một mục. Kiểm trên MỌI nút, kể cả nút gộp (`fields (2)`) vốn có dải
 * ghép từ con đầu tới con cuối.
 */
for (const n of flat(tree)) {
  ok(`"${n.name}": chọn nằm trong phần tử`,
    n.selectionStart >= n.start && n.selectionEnd <= n.end && n.selectionStart <= n.selectionEnd);
  ok(`"${n.name}": dải không âm`, n.start <= n.end);
}

section('outline — hàng: tên là DANH SÁCH TOKEN, pattern xuống detail');
const rows = view.children.filter((n) => n.kind === 'struct');
eq('một hàng control', rows.length, 1);
// Người mở mục lục đi tìm «hàng nào có ma_kh», không đi tìm «hàng nào pattern 110».
eq('tên là token', rows[0].name, '[ma_kh].Label, [ma_kh]');
eq('pattern xuống detail', rows[0].detail, '110');

const widths = view.children.find((n) => n.kind === 'array');
eq('item đầu là list px', widths.name, 'cột: 100, 60, 90');
eq('và cắt ra đúng thẻ', FORM.slice(widths.start, widths.end), '<item value="100, 60, 90"/>');

section('outline — &Name; trong view hiện ra, DOCTYPE thì không');
const refs = view.children.filter((n) => n.kind === 'reference');
eq('đúng một tham chiếu', refs.map((n) => n.name), ['&Rows;']);
eq('cắt ra đúng chỗ', FORM.slice(refs[0].start, refs[0].end), '&Rows;');
/*
 * `<!ENTITY Rows SYSTEM …>` ở internal subset là một KHAI BÁO, không phải chỗ kéo hàng vào —
 * quét cả file thì nó lọt vào mục lục của view và nói sai hẳn: view ấy không khai gì ở DOCTYPE.
 */
eq('khai báo ở DOCTYPE không bị đếm thành tham chiếu', refs.length, 1);

section('outline — tab hiện tên, không chỉ số');
const cats = byName(view.children, 'categories');
eq('nhóm categories', cats.name, 'categories (1)');
eq('tab mang cả số lẫn nhãn', cats.children[0].name, 'tab 1 — Chi tiết');
eq('và list px riêng của tab xuống detail', cats.children[0].detail, 'columns="300"');

section('outline — lưới liệt kê CỘT thay cho hàng');
const GRID = [
  '<grid table="svtran" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="ma_kh" width="80"><header v="KH" e="C"/></field>',
  '    <field name="ten_kh%l" width="150" aliasName="b"><header v="Tên" e="N"/></field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="ma_kh"/><field name="ten_kh%l"/></view></views>',
  '</grid>',
].join(NL);
const g = buildOutline(GRID);
const gview = byName(g, 'view');
eq('cột theo đúng thứ tự khai', gview.children.map((n) => n.name), ['ma_kh', 'ten_kh%l']);
// `aliasName` là thứ đáng thấy ngay trong mục lục: nó nói cột lấy dữ liệu từ đâu.
eq('aliasName xuống detail', byName(g, 'fields').children[1].detail, 'Tên · 150px');
eq('cột của view mang aliasName', gview.children[1].detail, 'aliasName="b"');

section('outline — thứ đã comment thì KHÔNG có trong mục lục');
// Cùng luật với mọi bộ quét khác: một khai báo đã comment là một khai báo KHÔNG tồn tại. Hiện
// nó trong mục lục là mời người ta đi sửa một dòng runtime không đọc.
const COMMENTED = FORM
  .replace('<field name="ten_kh" type="String"><header v="Tên KH" e="Name"/></field>',
    '<!--<field name="ten_kh" type="String"><header v="Tên KH" e="Name"/></field>-->')
  .replace('    &Rows;', '    <!-- &Rows; -->');
const c = buildOutline(COMMENTED);
eq('field đã comment biến mất', byName(c, 'fields').name, 'fields (1)');
eq('tham chiếu đã comment cũng vậy',
  byName(c, 'view').children.filter((n) => n.kind === 'reference').length, 0);

section('outline — văn bản không phải controller thì trả về rỗng');
// Trả mảng rỗng để tầng vỏ còn nhường cho provider khác của VS Code, thay vì chiếm chỗ bằng một
// cây trống.
for (const junk of ['', 'không phải xml', '<html><body>x</body></html>']) {
  eq(`"${junk.slice(0, 14)}" → rỗng`, buildOutline(junk).length, 0);
}
eq('null cũng không ném', buildOutline(null).length, 0);

section('outline — tên dài bị cắt ngắn, giữ phần đầu');
const LONG = [
  '<dir table="t">',
  '  <view id="V">',
  `    <item value="1: [${'x'.repeat(90)}]"/>`,
  '  </view>',
  '</dir>',
].join(NL);
const long = byName(buildOutline(LONG), 'view').children[0];
ok('cắt ngắn', long.name.length <= 60);
ok('và đánh dấu là đã cắt', long.name.endsWith('…'));
// Cắt ở TÊN thôi — dải vẫn phải trỏ tới trọn thẻ, không thì bấm vào là bôi đen thiếu.
eq('dải vẫn trọn thẻ', LONG.slice(long.start, long.end).endsWith('/>'), true);
