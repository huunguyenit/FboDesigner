// test-lint.mjs — bốn luật chẩn đoán về chất lượng bản khai.
//
// Trọng tâm của file này KHÔNG phải là "luật có bắt được lỗi không" — vế ấy dễ. Trọng tâm là
// CÁC CỬA THOÁT: mỗi luật phải im lặng khi không đủ thông tin để kết luận. Một luật kêu oan chỉ
// cần vài lần là người dùng thôi đọc cả bảng Problems, và khi ấy nó kéo theo mọi luật đúng
// xuống cùng. Nên với mỗi rule có bao nhiêu phép kiểm "bắt đúng" thì có ít nhất bấy nhiêu phép
// kiểm "biết im".

import { ok, eq, section } from './harness.mjs';
import { renderControllerHtml } from '../src/render.mjs';
import { expandEntities } from '../src/entities.mjs';
import { gridBlockPx } from '../src/lint.mjs';
import { VIEWS_CONFIG } from '../src/msg.mjs';

const NL = '\r\n';
const nrm = (p) => String(p).split(String.fromCharCode(92)).join('/');

/** Dựng như tầng vỏ dựng: bung entity rồi mới render, vì luật lint cần `segments` và `hostFile`. */
function build(text, { file = 'C:/P/App_Data/Controllers/Dir/K.xml', files = {} } = {}) {
  const ex = expandEntities(text, {
    filePath: file,
    readFile: (abs) => files[nrm(abs)] ?? null,
  });
  return renderControllerHtml(ex.clearText, { segments: ex.segments, hostFile: file });
}

const codes = (r) => r.warnings.map((w) => w.code);
const has = (r, code) => r.warnings.some((w) => w.code === code);
const of = (r, code) => r.warnings.find((w) => w.code === code);

/* ═════════════════════════════════════════════════════════════════════════
 * 1. `<field>` khai chết
 * ═════════════════════════════════════════════════════════════════════════ */
section('lint — field khai mà không chỗ nào dùng');

const DEAD = [
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kho"><header v="Mã kho" e="Code"/></field>',
  '    <field name="le_loi"><header v="Lẻ loi" e="Unused"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60"/>',
  '    <item value="11: [ma_kho].Label, [ma_kho]"/>',
  '  </view>',
  '</dir>',
].join(NL);
const dead = build(DEAD);
ok('bắt được field không ai dùng', has(dead, 'lint.field_unused'));
ok('và nêu đúng tên', of(dead, 'lint.field_unused').message.includes('le_loi'));
ok('field có dùng thì không bị kêu', !of(dead, 'lint.field_unused').message.includes('ma_kho'));
eq('đúng MỘT cảnh báo khai chết, không kêu tràn', codes(dead).filter((c) => c === 'lint.field_unused').length, 1);
// Neo vào chính thuộc tính `name` của thẻ khai, để bấm là nhảy tới đúng chỗ xoá.
eq('neo vào tên field trong thẻ khai', DEAD.slice(of(dead, 'lint.field_unused').range.start, of(dead, 'lint.field_unused').range.end), 'le_loi');

section('lint — field khai chết: bốn cửa thoát');

// Cửa 1 — tên còn xuất hiện ở chỗ khác (ở đây là `<query>`). Bộ quét không đọc SQL, và cũng
// không đọc JS ở `Include\Javascript`; thấy dấu vết là đủ để không kết luận.
const TRACE = DEAD.replace('<field name="le_loi"><header v="Lẻ loi" e="Unused"/></field>',
  '<field name="le_loi"><header v="Lẻ loi" e="Unused"/><query>select le_loi from x</query></field>');
ok('tên còn dấu vết ở chỗ khác → im', !has(build(TRACE), 'lint.field_unused'));

/*
 * Cửa 2 — field khai ở file INCLUDE. Đây là cửa quan trọng nhất của cả luật: một Include dùng
 * chung khai năm chục field cho hai chục controller, mỗi controller dùng dăm cái. Không có cửa
 * này thì mở một controller ra là bốn mươi lăm cảnh báo sai, và không ai đọc Problems nữa.
 */
const INC_FIELDS = [
  '<field name="dung_o_noi_khac"><header v="X" e="X"/></field>',
].join(NL);
const FROM_INC = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<!DOCTYPE dir [',
  '  <!ENTITY Chung SYSTEM "../Include/Chung.ent">',
  ']>',
  '<dir table="dmkho">',
  '  <fields>',
  '    <field name="ma_kho"><header v="Mã kho" e="Code"/></field>',
  '    &Chung;',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 60"/>',
  '    <item value="11: [ma_kho].Label, [ma_kho]"/>',
  '  </view>',
  '</dir>',
].join(NL);
const fromInc = build(FROM_INC, {
  files: { 'C:/P/App_Data/Controllers/Include/Chung.ent': INC_FIELDS },
});
ok('field khai ở Include dùng chung → im', !has(fromInc, 'lint.field_unused'));

// Cửa 3 — field đến từ Include vẫn im NGAY CẢ KHI nó chết thật ở đây; đó là chủ ý, không phải
// sót. Kiểm bằng cách khai đúng field ấy trong CHÍNH controller: khi ấy nó phải bị kêu.
const OWN = FROM_INC.replace('    &Chung;', '    <field name="dung_o_noi_khac"><header v="X" e="X"/></field>');
ok('cùng field ấy khai ở CHÍNH controller thì bị kêu', has(build(OWN), 'lint.field_unused'));

// Cửa 4 — field neo vùng cho hàng trống (`zzblank…`) cố tình không token nào nhận, nhưng nó
// XUẤT HIỆN trong value của hàng nên cửa "còn dấu vết" đã che. Khẳng định để khỏi ai gỡ nhầm.
const BLANK = [
  '<dir table="t">',
  '  <fields><field name="a"><header v="A" e="A"/></field>',
  '  <field name="zzblank18" categoryIndex="18"><header v="" e=""/></field></fields>',
  '  <view id="Dir">',
  '    <item value="50, 50"/>',
  '    <item value="11: [a].Label, [a]"/>',
  '    <item value="--: [zzblank18]"/>',
  '  </view>',
  '</dir>',
].join(NL);
ok('field neo vùng cho hàng trống không bị kêu khai chết', !has(build(BLANK), 'lint.field_unused'));

/*
 * Cửa 5 — lưới NHIỀU VIEW. `renderGrid` chỉ dựng MỘT view (cái đầu tiên có cột), nên tập «cột
 * đang hiện» không hề biết tới cột của view thứ hai. Không có cửa "còn dấu vết ở chỗ khác" thì
 * mọi cột chỉ dùng ở view in ấn đều bị kêu khai chết — và lưới nhiều view là chuyện thường.
 */
const TWO_VIEWS = [
  '<grid table="t" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="a" width="100"><header v="A" e="A"/></field>',
  '    <field name="chi_o_view_2" width="100"><header v="B" e="B"/></field>',
  '    <field name="that_su_chet" width="100"><header v="C" e="C"/></field>',
  '  </fields>',
  '  <views>',
  '    <view id="Grid"><field name="a"/></view>',
  '    <view id="Print"><field name="chi_o_view_2"/></view>',
  '  </views>',
  '</grid>',
].join(NL);
const twoViews = build(TWO_VIEWS, { file: 'C:/P/App_Data/Controllers/Grid/T.xml' });
const deadNames = twoViews.warnings.filter((w) => w.code === 'lint.field_unused').map((w) => w.message);
eq('đúng một field bị kêu', deadNames.length, 1);
ok('cột chỉ dùng ở view thứ hai KHÔNG bị kêu', !deadNames[0].includes('chi_o_view_2'));
ok('còn cột không view nào dùng thì bị kêu', deadNames[0].includes('that_su_chet'));

/* ═════════════════════════════════════════════════════════════════════════
 * 2 + 3. aliasName: không có trong join, và bảng tạm cục bộ
 * ═════════════════════════════════════════════════════════════════════════ */
section('lint — aliasName của cột lưới');

/** Lưới tối giản: một câu Finding có join thật, cộng danh sách cột khai được từ ngoài vào. */
function grid(columns, finding) {
  return [
    '<grid table="svtran" xmlns="urn:schemas-fast-com:data-grid">',
    '  <fields>',
    '    <field name="ma_kh" width="100"><header v="KH" e="C"/></field>',
    '    <field name="ten_kh" width="100" aliasName="b"><header v="Tên" e="N"/></field>',
    '    <field name="ten_loai_hd" width="100" aliasName="c"><header v="Loại" e="T"/></field>',
    '    <field name="la_gi" width="100" aliasName="zz"><header v="?" e="?"/></field>',
    '  </fields>',
    '  <queries>',
    `    <query event="Finding">${finding}</query>`,
    '  </queries>',
    '  <views><view id="Grid">',
    // Cột của `<view>` CHỈ có tên — `aliasName` khai ở `<fields>` bên trên, đúng như file thật.
    columns.map((c) => `    <field name="${c}"/>`).join(NL),
    '  </view></views>',
    '</grid>',
  ].join(NL);
}

// `c` join tới một bảng TẠM CỤC BỘ — ca thật của `Grid\SVTran.xml` (HOATP), rút gọn.
const FINDING_OK = "exec X 'a left join dmkh b on a.ma_kh = b.ma_kh"
  + " left join #invoiceTypeTmp c on a.loai_hd = c.loai_hd'";

const gAll = build(grid(['ma_kh', 'ten_kh', 'ten_loai_hd', 'la_gi'], FINDING_OK),
  { file: 'C:/P/App_Data/Controllers/Grid/SVTran.xml' });

ok('alias không có trong câu Finding thì bị kêu', has(gAll, 'lint.alias_not_joined'));
ok('và nêu đúng alias', of(gAll, 'lint.alias_not_joined').message.includes('zz'));
ok('alias join tới bảng tạm CỤC BỘ thì bị kêu riêng', has(gAll, 'lint.alias_local_temp'));
ok('và nêu đúng tên bảng tạm', of(gAll, 'lint.alias_local_temp').message.includes('#invoiceTypeTmp'));
// `b` join tới một bảng thật — không được kêu gì cả.
ok('alias join tới bảng thật thì im', !gAll.warnings.some((w) => w.message.includes('"b"')));

section('lint — aliasName: ba cửa thoát');

// Cửa 1 — bảng tạm TOÀN CỤC (`##`) sống hết phiên kết nối, đi đường bình thường.
const GLOBAL_TMP = FINDING_OK.replace('#invoiceTypeTmp', '##invoiceTypeTmp');
ok('bảng tạm TOÀN CỤC (##) không bị kêu',
  !has(build(grid(['ten_loai_hd'], GLOBAL_TMP), { file: 'C:/P/App_Data/Controllers/Grid/S.xml' }), 'lint.alias_local_temp'));

/*
 * Cửa 2 — câu Finding bị `<Encrypted>`. Không đọc được thì KHÔNG biết alias nào hợp lệ, và kêu
 * hết mọi cột lên là biến một câu «tôi không đọc được» thành một câu «bạn sai».
 */
const enc = build(grid(['ten_kh', 'la_gi'], '<Encrypted>xxx</Encrypted>'),
  { file: 'C:/P/App_Data/Controllers/Grid/S.xml' });
ok('câu Finding mã hoá → im hoàn toàn', !has(enc, 'lint.alias_not_joined') && !has(enc, 'lint.alias_local_temp'));

// Cửa 3 — không có `<query event="Finding">` nào cả.
const NOQ = grid(['la_gi'], '').replace(/<queries>[\s\S]*?<\/queries>/, '');
ok('không có câu Finding → im', !has(build(NOQ, { file: 'C:/P/App_Data/Controllers/Grid/S.xml' }), 'lint.alias_not_joined'));

/* ═════════════════════════════════════════════════════════════════════════
 * 4. Lưới nhúng khai `rows` vượt `view@height`
 * ═════════════════════════════════════════════════════════════════════════ */
section('lint — lưới nhúng cao hơn vùng chứa nó');

/*
 * Mốc lấy nguyên từ ghi chú của `renderGridHtml`, đo trên runtime thật:
 *   toolbar 30 + rows 242 + split 8 + cuộn 22 = 302 = `view height`
 * Nên `rows=242` với `height=302` là VỪA KHÍT, và 243 là tràn đúng 1px.
 */
const CHROME = VIEWS_CONFIG.gridToolbarPx + VIEWS_CONFIG.gridSplitPx + VIEWS_CONFIG.gridFooterPx;
eq('công thức chiều cao khối khớp mốc đo được', gridBlockPx(242), 242 + CHROME);

function form(height, rows) {
  return [
    '<dir table="t">',
    '  <fields>',
    '    <field name="a"><header v="A" e="A"/></field>',
    `    <field name="ct" categoryIndex="1" rows="${rows}"><header v="CT" e="CT"/><items style="Grid" controller="X"/></field>`,
    '  </fields>',
    `  <view id="Dir" height="${height}">`,
    '    <item value="500"/>',
    '    <item value="1: [a]"/>',
    '    <item value="1: [ct]"/>',
    '    <categories><category index="1"><header v="Chi tiết" e="Detail"/></category></categories>',
    '  </view>',
    '</dir>',
  ].join(NL);
}

ok('vừa khít thì KHÔNG kêu', !has(build(form(302, 242)), 'lint.grid_overflows_view'));
const over = build(form(302, 243));
ok('vượt 1px thì kêu', has(over, 'lint.grid_overflows_view'));
ok('và nói ra tràn bao nhiêu', of(over, 'lint.grid_overflows_view').message.includes('tràn 1px'));
ok('nhỏ hơn thì im', !has(build(form(400, 242)), 'lint.grid_overflows_view'));

section('lint — chiều cao: hai cửa thoát');
// `view` không khai `height` thì vùng co theo nội dung — không có gì để mà tràn ra khỏi.
ok('không khai view@height → im', !has(build(form(302, 999).replace(' height="302"', '')), 'lint.grid_overflows_view'));
// `field` không khai `rows` thì không có con số nào để so.
ok('không khai field@rows → im', !has(build(form(302, 242).replace(' rows="242"', '')), 'lint.grid_overflows_view'));

section('lint — mọi cảnh báo mới đều có mã và mức, như mọi cảnh báo khác');
for (const r of [dead, gAll, over]) {
  ok('đủ code + severity', r.warnings.every((w) => w.code && w.severity));
}
// Bốn luật này đều là "vẽ ra được nhưng có chỗ sai" — không cái nào làm control biến mất khỏi
// màn hình, nên không cái nào được lên `error`. Xem luật chia mức ở `warn.mjs`.
const lintOnly = [...dead.warnings, ...gAll.warnings, ...over.warnings].filter((w) => w.code.startsWith('lint.'));
ok('có cảnh báo lint để mà xét', lintOnly.length > 0);
ok('không luật lint nào ở mức error', lintOnly.every((w) => w.severity === 'warning'));
