// test-grid.mjs — `<grid>` là mặt còn lại của controller, và nó không dùng `item value`.
// Fixture rút gọn từ `Grid/APDetail.f` của FBISP24: thứ tự cột, bề rộng, và ba khoá kỹ thuật
// `hidden="true"` mà runtime không vẽ.

import { ok, eq, section } from './harness.mjs';
import { renderControllerHtml } from '../src/render.mjs';
import { applyArrangement } from '../src/grid.mjs';
import { resolveLocaleName } from '../src/control.mjs';
import { scanFields, scanViews, scanRoot } from '../src/spans.mjs';

const XML = [
  '<grid table="d31$000000" type="Detail" freezeColumns="2" xmlns="urn:schemas-fast-com:data-grid">',
  '  <title v="Chi tiết" e="Detail"></title>',
  '  <fields>',
  '    <field name="tk_vt" width="80" allowNulls="false"><header v="Tk nợ" e="Debit Account"/>',
  '      <items style="AutoComplete" controller="Account" reference="ten_tk_vt%l"/></field>',
  '    <field name="ten_tk_vt%l" readOnly="true" external="true" width="300"><header v="Tên tài khoản" e="Account Description"/></field>',
  '    <field name="so_luong" type="Decimal" width="80"><header v="Số lượng" e="Quantity"/><items style="Numeric"/></field>',
  '    <field name="stt_rec" isPrimaryKey="true" readOnly="true" hidden="true" width="0"><header v="" e=""/></field>',
  '    <field name="line_nbr" type="Int32" width="0" hidden="true"><header v="" e=""/></field>',
  '  </fields>',
  '  <views><view id="Grid">',
  '    <field name="tk_vt"/>',
  '    <field name="ten_tk_vt%l"/>',
  '    <field name="so_luong"/>',
  '    <field name="stt_rec"/>',
  '    <field name="line_nbr"/>',
  '  </view></views>',
  '</grid>',
].join('\n');

section('grid — chọn kiểu render theo gốc tài liệu');
eq('<grid xmlns=…data-grid> → mode grid', scanRoot(XML).mode, 'grid');
eq('<dir> vẫn là form', scanRoot('<dir xmlns="urn:schemas-fast-com:data-dir"/>').mode, 'form');
eq('không xmlns thì rơi về tên thẻ', scanRoot('<grid/>').mode, 'grid');

section('grid — view khai cột bằng <field name>, không bằng <item value>');
const views = scanViews(XML);
eq('quét được 5 cột khai trong view', views[0].columns.map((c) => c.name),
  ['tk_vt', 'ten_tk_vt%l', 'so_luong', 'stt_rec', 'line_nbr']);
eq('view của grid không có item nào', views[0].items.length, 0);

// Field trần trong view mà lọt vào scanFields thì nó ghi đè bản khai đầy đủ ở <fields>
// (Map lấy bản sau) — mọi cột mất nhãn và mất width. Hỏng im lặng, nên phải có test riêng.
section('grid — <field> trong view KHÔNG được lẫn vào <fields>');
const fields = scanFields(XML);
eq('đúng 5 field khai báo, không nhân đôi', fields.length, 5);
eq('tk_vt vẫn giữ header', new Map(fields.map((f) => [f.name, f])).get('tk_vt').header.v, 'Tk nợ');

section('grid — cột hidden là khoá kỹ thuật: DỰNG nhưng display:none');
// Runtime vẫn emit chúng (`width:0px;display:none`). Bỏ hẳn khỏi model thì chỉ số cột lệch với
// thứ tự `<field>` khai trong view, và mọi phép sửa cột nhắm sai chỗ ngay khi có một cột ẩn.
const { model, html, mode } = renderControllerHtml(XML);
eq('mode grid', mode, 'grid');
eq('giữ đủ 5 cột theo đúng thứ tự khai', model.columns.map((c) => c.name),
  ['tk_vt', 'ten_tk_vt%l', 'so_luong', 'stt_rec', 'line_nbr']);
eq('nhưng chỉ 3 cột HIỆN', model.visibleColumns.map((c) => c.name), ['tk_vt', 'ten_tk_vt%l', 'so_luong']);
eq('tổng px = 24 (cột STT) + 80 + 300 + 80', model.totalWidth, 484);
ok('cột ẩn vẽ ra nhưng display:none', html.includes('width:0px;display:none;'));

section('grid — bề rộng nằm trên TỪNG ô, không trên bảng');
// Lưới runtime là `<table class="GridTable" cellpadding="0" cellspacing="0">` — không width,
// không table-layout. Đó cũng là cách nó cho kéo giãn cột: sửa width của td.
eq('list px gồm cả cột STT và cột ẩn', model.widths, [24, 80, 300, 80, 0, 0]);
ok('bảng KHÔNG mang width', !/<table class="GridTable"[^>]*width:/.test(html));
ok('bảng KHÔNG dùng table-layout', !html.includes('table-layout:fixed'));
ok('mỗi ô mang width riêng', html.includes('overflow:hidden;width:300px;'));
ok('ô có div container như runtime', html.includes('class="HeaderCellContainer"'));
eq('freezeColumns=2 khoá 2 cột đầu', model.columns.filter((c) => c.frozen).map((c) => c.name), ['tk_vt', 'ten_tk_vt%l']);

section('grid — header và control');
ok('nhãn cột từ <header>', html.includes('>Tk nợ<'));
ok('allowNulls=false ra Required', html.includes('HeaderCellDefault Required'));

section('grid — ô nhập dùng bộ class CỦA LƯỚI, không phải của form');
/*
 * Nguồn: `renderCell` trong `ScriptResource.axd` cộng HTML thật của lưới «Hóa đơn bán hàng».
 * Khuôn runtime chỉ có MỘT dạng: `<input class="CellInput {TextInput|CheckInput} {extra}">`.
 *
 * Ba chỗ bản trước dựng theo form và cả ba đều sai — đo được trên trang đã lưu:
 */
ok('ô chữ là CellInput TextInput', html.includes('class="CellInput TextInput"'));
ok('KHÔNG còn bộ class của form trong lưới',
  !html.includes('FormInput') && !html.includes('FormTextInput'));

// 1. Cột readOnly: lưới GIỮ NGUYÊN class, chỉ thêm thuộc tính `readonly`. Form thì đổi hẳn sang
//    `FormInputDisabled`. Trang runtime không có một `CellInputDisabled` nào.
ok('cột readOnly vẫn là CellInput TextInput, chỉ thêm readonly',
  /class="CellInput TextInput"[^>]*\breadonly\b/.test(html));
ok('không bịa ra class Disabled cho lưới', !html.includes('CellInputDisabled'));

// 2. Cột AutoComplete KHÔNG có icon kính lúp. Cả trang runtime có ĐÚNG MỘT `CellDivContainer`,
//    và nó thuộc form chứ không thuộc lưới — trong lưới, danh sách chọn hiện ra bằng menu chuột
//    phải, không bằng một cái icon đeo bên cạnh ô.
ok('cột AutoComplete trong lưới KHÔNG đeo icon', !html.includes('CellImgLookup'));
ok('và không có thẻ bọc icon nào', !html.includes('CellDivContainer'));

// 3. KHÔNG có bề rộng inline trên ô. `.TextInput{width:100%}` cho ô lấp đầy div container, mà
//    div ấy đã mang đúng bề rộng cột — ghim thêm px vào ô là hai nguồn cho một con số.
ok('ô nhập không mang width inline', !/class="CellInput TextInput"[^>]*style="[^"]*width:/.test(html));
// Div container thì VẪN mang bề rộng cột, y như runtime.
ok('div container vẫn giữ bề rộng cột', html.includes('class="RowCellContainer" style="height:14px;width:300px;'));

// Cột số canh phải bằng style inline — nguyên văn runtime (`style="text-align:right;"`).
ok('cột Numeric canh phải', html.includes('class="CellInput TextInput" style="text-align:right;"'));

section('grid — cột trỏ vào field không khai thì báo, không im');
const orphan = renderControllerHtml(XML.replace('<field name="so_luong"/>', '<field name="khong_co"/>'));
ok('có cảnh báo nêu đúng tên', orphan.warnings.some((w) => w.message.includes('khong_co')));

// ─────────────────────────────────────────────────────────────────────────────
// Lưới Detail NHÚNG trong một tab của form.
//
// `<field><items style="Grid" controller="X"/></field>` — ô đó không phải một control mà là cả
// một lưới lấy từ `Grid/X`. Đây là cách tab «Mua hàng», «Liên hệ»… của danh mục khách hàng có
// lưới con. Không dựng thì tab trông rỗng trong khi file khai đầy đủ.
const DETAIL = [
  '<grid table="bidmnccbp0" type="Detail" xmlns="urn:schemas-fast-com:data-grid">',
  '  <title v="Chi tiết mua hàng" e="Purchasing detail"></title>',
  '  <fields>',
  '    <field name="ma_kh" width="0" hidden="true"><header v="" e=""/></field>',
  '    <field name="ma_bp0" width="100" allowNulls="false"><header v="Đơn vị mua" e="Purchasing Org"/></field>',
  '    <field name="ten_bp0%l" width="300" readOnly="true"><header v="Tên đơn vị mua" e="Org name"/></field>',
  '  </fields>',
  '  <views>',
  '    <view id="Grid"><field name="ma_kh"/><field name="ma_bp0"/><field name="ten_bp0%l"/></view>',
  '  </views>',
  '  <toolbar>',
  '    <button command="Insert"><title v="Toolbar.Insert" e="Toolbar.Insert"/></button>',
  '    <button command="Clone"><title v="Toolbar.Clone" e="Toolbar.Clone"/></button>',
  '    <button command="-"><title v="-" e="-"/></button>',
  '    <button command="PurOrgDeclaration"><title v="Khai báo theo đơn vị$$120" e="By org$$120"/></button>',
  '  </toolbar>',
  '</grid>',
].join('\r\n');

const HOST_GRID = [
  '<dir table="dmkh">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã khách" e="Code"/></field>',
  '    <field name="bidmnccbp0" categoryIndex="4" rows="242">',
  '      <header v="Mua hàng" e="Purchasing"/>',
  '      <items style="Grid" controller="CustomerPurchasingDetail"/>',
  '    </field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 200"/>',
  '    <item value="11: [ma_kh].Label, [ma_kh]"/>',
  '    <item value="10: [bidmnccbp0]"/>',
  '    <categories>',
  '      <category index="4" columns="769"><header v="Mua hàng" e="Purchasing"/></category>',
  '    </categories>',
  '  </view>',
  '</dir>',
].join('\r\n');

const loadDetail = (name) => (name === 'CustomerPurchasingDetail'
  ? { text: DETAIL, segments: null, file: 'C:/P/App_Data/Controllers/Grid/CustomerPurchasingDetail.f' }
  : null);

section('grid nhúng — tab có <items style="Grid"> phải ra lưới thật');
const emb = renderControllerHtml(HOST_GRID, { loadDetail });
ok('ô lưới dùng class riêng, không phải FormCell thường', emb.html.includes('class="FormCellGrid"'));
ok('có bảng lưới trong tab', emb.html.includes('GridTable'));
ok('cột lấy từ file Detail', emb.html.includes('Đơn vị mua') && emb.html.includes('Tên đơn vị mua'));
// Cột khoá kỹ thuật `hidden` không được vẽ — y như lưới đứng riêng. Kiểm bằng list px của
// CHÍNH bảng lưới (24 cột STT + 100 + 300), không grep tên field: `ma_kh` còn là field của
// form nên nó xuất hiện ở chỗ khác, và grep tên sẽ xanh nhầm.
ok('cột hidden vẫn bị loại khỏi phần NHÌN THẤY', emb.html.includes('data-fbo-col-widths="24,0,100,300"'));
// `rows` khai trên FIELD của form, không phải trong file lưới — và nó là chiều cao CẢ KHỐI:
// đo trên HTML runtime thì rows=242 cho ra thân cuộn 212 + split 8 + footer 22.
ok('thân cuộn = rows - split - footer', emb.html.includes('height:212px'));
ok('split 8px', emb.html.includes('class="SplitStyle divSplit" style="height:8px;"'));
ok('footer 22px', emb.html.includes('height:22px;'));
ok('header ở bảng RIÊNG để cuộn không mất tiêu đề', emb.html.includes('class="HeaderStyle divHeader"'));
// Padding 4px của FormCell làm lưới thụt vào một vành không có ở runtime.
ok('ô lưới bỏ padding', emb.html.includes('padding:0!important'));

section('grid nhúng — toolbar KHAI trong file, không phải đoán');
ok('khoá Toolbar.Insert dịch ra nhãn', emb.html.includes('>Thêm</div>'));
ok('khoá Toolbar.Clone dịch ra nhãn', emb.html.includes('>Nhân dòng</div>'));
// Nhãn viết thẳng thì giữ nguyên văn, và `$$120` là bề rộng chứ không phải chữ.
ok('nhãn riêng của khách giữ nguyên', emb.html.includes('>Khai báo theo đơn vị</div>'));
ok('$$120 thành max-width, không lọt vào chữ', emb.html.includes('max-width:120px') && !emb.html.includes('$$120'));
ok('dấu "-" ra vạch ngăn 1px, không ra nút', emb.html.includes('background-color:#559DFF'));

section('grid — dải nút dựng đúng cấu trúc runtime, không phải <button>');
// `fbo-toolbar.css` gắn sprite vào `.ToolbarBackgroundImage.Text<Command>`; dựng bằng <button>
// thì không nút nào có icon. Đây chính là chỗ bản trước sai.
ok('khung ToolbarStyle Green', emb.html.includes('class="ToolbarStyle Green"'));
ok('nút là div mang class Text<Command>', emb.html.includes('ToolbarBackgroundImage TextInsert ToolbarTextButton'));
ok('không dùng <button>', !/<button[^>]*ToolbarTextButton/.test(emb.html));
ok('cao 22px như runtime', emb.html.includes('height:22px;border-width:0px;'));
// Không gắn onclick: chúng gọi $find(...).executeCommand(...) của ASP.NET AJAX, không có trong
// webview. Vẽ dải nút thì được, hứa bấm ra việc thì không.
ok('không gắn onclick chết', !emb.html.includes('onclick='));

section('grid — nút group (<menuItems>) đối chiếu NGUYÊN VĂN với HTML runtime');
/*
 * Mốc so là một dòng chép từ trang runtime đã lưu (`DevWorkFlow/.temp/Hóa đơn bán hàng.html`),
 * bỏ đi `id` và hai handler `onmouseover/onmouseout` — hai thứ duy nhất designer cố ý không dựng:
 *
 *   <div class="ToolbarBackgroundImage TextGroupRetrieve ToolbarTextButton"
 *        style="height:22px;border-width:0px;max-width:120px;" title="Lấy dữ liệu">
 *     <span class="ToolbarGroupSpan">Lấy dữ liệu</span></div>
 *
 * So cả dòng chứ không so từng mảnh: ba lỗi của bản trước (thiếu mảnh `Group` trong tên class,
 * thiếu `max-width`, thiếu `<span>`) đều lọt qua một phép kiểm chỉ nhìn một mảnh.
 */
const GROUPED = [
  '<grid type="Detail">',
  '  <fields><field name="ma_vt" width="100"><header v="Mã vt" e="Item"/></field></fields>',
  '  <views><view id="Grid"><field name="ma_vt"/></view></views>',
  '  <toolbar>',
  '    <button command="Retrieve">',
  '      <title v="Toolbar.Retrieve" e="Toolbar.Retrieve"></title>',
  '      <menuItems>',
  '        <menuItem commandArgument="10"><header v="Lấy số liệu từ phiếu nhu cầu" e="From PR"/></menuItem>',
  '        <menuItem commandArgument="-"><header v="-" e="-"/></menuItem>',
  '        <menuItem commandArgument="30"><header v="Lấy số liệu từ báo giá" e="From quotation"/></menuItem>',
  '      </menuItems>',
  '    </button>',
  '    <button command="Extra">',
  '      <title v="Khác..." e="More..."></title>',
  '      <menuItems><menuItem commandArgument="05"><header v="Chèn dòng..." e="Insert above"/></menuItem></menuItems>',
  '    </button>',
  '    <button command="Freeze"><title v="Toolbar.Freeze" e="Toolbar.Freeze"/></button>',
  '  </toolbar>',
  '</grid>',
].join('\r\n');
const grouped = renderControllerHtml(GROUPED);

ok('Retrieve có menuItems → dựng NGUYÊN VĂN như runtime', grouped.html.includes(
  '<div class="ToolbarBackgroundImage TextGroupRetrieve ToolbarTextButton" data-fbo-command="Retrieve"'
  + ' style="height:22px;border-width:0px;max-width:120px;" title="Lấy dữ liệu">'
  + '<span class="ToolbarGroupSpan">Lấy dữ liệu</span></div>'));
// `TextRetrieve` là ô sprite runtime KHÔNG khai, nên nút rơi xuống rule đứng gần nhất và hiện
// icon của lệnh khác. Mảnh `Group` là thứ duy nhất chặn chuyện đó.
ok('không rơi về TextRetrieve (ô sprite runtime không khai)', !grouped.html.includes('TextRetrieve '));
// Có `max-width` riêng thì KHÔNG được gắn thêm ToolbarWidthButton — gắn cả hai là ép về 60px.
ok('không gắn kèm ToolbarWidthButton khi đã có max-width',
  !/TextGroupRetrieve ToolbarTextButton ToolbarWidthButton/.test(grouped.html));

// `<title v="Khác..."/>` không có dấu `$` nào → runtime vẽ nút CHỈ ICON, và group thì rộng 30px
// chứ không 22. Trông như một cái nhãn nhưng không phải.
ok('title không có "$" → nút chỉ icon', grouped.html.includes(
  '<div class="ToolbarBackgroundImage GroupExtra" data-fbo-command="Extra"'
  + ' style="height:22px;width:30px;border-width:0px;" title="Khác..."></div>'));
ok('nút icon KHÔNG group vẫn 22px', grouped.html.includes(
  '<div class="ToolbarBackgroundImage Freeze" data-fbo-command="Freeze"'
  + ' style="height:22px;width:22px;border-width:0px;" title="Khóa cột"></div>'));

ok('menuItems ra danh sách xổ, kể cả vạch ngăn', grouped.html.includes(
  '<ul class="ToolbarGroupMenu">'
  + '<li class="ToolbarGroupMenuItem" data-fbo-arg="10">Lấy số liệu từ phiếu nhu cầu</li>'
  + '<li class="ToolbarGroupMenuSep"></li>'
  + '<li class="ToolbarGroupMenuItem" data-fbo-arg="30">Lấy số liệu từ báo giá</li></ul>'));

section('grid — dấu phân cách trong <title> là MỘT "$", không phải hai');
/*
 * Ba dạng đều có thật trong corpus FBISP24, đếm được: `Bỏ duyệt$$75` (18 chỗ),
 * `Chọn kỳ$Chọn...` (7 chỗ), `Đồ thị$` (18 chỗ). Đọc `$$` như một dấu duy nhất thì
 * `Chọn kỳ$Chọn...` ra nhãn «Chọn kỳ$Chọn...» — chữ `$` lọt thẳng lên nút.
 */
const SEPS = [
  '<grid type="Detail">',
  '  <fields><field name="ma_vt" width="100"><header v="Mã vt" e="Item"/></field></fields>',
  '  <views><view id="Grid"><field name="ma_vt"/></view></views>',
  '  <toolbar>',
  '    <button command="Pick"><title v="Chọn kỳ$Chọn..." e="Period$Pick..."/></button>',
  '    <button command="Chart"><title v="Đồ thị$" e="Chart$"/></button>',
  '    <button command="Unappr"><title v="Bỏ duyệt$$75" e="Unapprove$$75"/></button>',
  '  </toolbar>',
  '</grid>',
].join('\r\n');
const seps = renderControllerHtml(SEPS);
ok('"tooltip$nhãn" → nhãn riêng, tooltip riêng',
  seps.html.includes('title="Chọn kỳ">Chọn...</div>'));
ok('"tooltip$" → nhãn lấy từ tooltip', seps.html.includes('title="Đồ thị">Đồ thị</div>'));
ok('"tooltip$$N" → nhãn lấy từ tooltip, N thành max-width',
  seps.html.includes('max-width:75px;" title="Bỏ duyệt">Bỏ duyệt</div>'));
// Chỉ soi ruột các NÚT: `scanTitle` lấy `<title>` đầu tiên của tài liệu, mà fixture này không
// khai `<title>` cho lưới nên caption của nó vớ luôn title của nút — chuyện riêng của fixture.
ok('không có dấu "$" nào lọt lên nút',
  !/class="ToolbarBackgroundImage[^"]*"[^>]*>[^<]*\$/.test(seps.html));
// Nhãn rỗng thì lấy tooltip CẮT TẠI dấu `(` — đó là cách «Thêm dòng (Ctrl + Insert)» ra nút
// «Thêm» mà tooltip vẫn giữ đủ phím tắt.
ok('tooltip giữ phím tắt, nhãn thì không',
  emb.html.includes('title="Thêm dòng (Ctrl + Insert)">Thêm</div>'));

section('grid — MỘT hàng mẫu, và không cuộn thừa');
// Hàng mẫu tồn tại để thấy ô nhập kiểu gì; hàng 2 và 3 là bản sao rỗng, chỉ tốn chiều cao.
eq('đúng một hàng dữ liệu mẫu', (emb.html.match(/class="GridDataRow"/g) || []).length, 1);
// `overflow-y:hidden` mà bỏ trống trục x thì CSS tự tính trục x thành `auto` — footer mọc ra
// một thanh cuộn không ai gọi, chồng lên thanh của thân lưới.
ok('footer khai overflow cho CẢ HAI trục', emb.html.includes('class="FooterStyle divFooter" style="overflow:hidden;'));
ok('thân lưới là chỗ DUY NHẤT cuộn ngang', emb.html.includes('overflow-x:auto;overflow-y:auto;'));

/*
 * Panel của tab chỉ mang `overflow` khi `view@height` ghim chiều cao — không ghim thì không có
 * gì để cuộn, và HOST_GRID cố tình không khai height. Nên phần này đo trên một bản CÓ height.
 *
 * Luật cần khoá: tab CÓ lưới thì trục ngang là `hidden`, vì lưới đã tự lo cuộn cột; tab KHÔNG
 * có lưới thì `auto`, vì bảng của vùng rộng đúng bằng `<category columns>` và có thể rộng hơn
 * form. Để cả hai cùng `auto` là hai thanh cuộn xếp chồng cho cùng một dãy cột.
 */
const TWO_TABS = HOST_GRID
  .replace('<view id="Dir">', '<view id="Dir" height="300">')
  .replace('    <field name="bidmnccbp0"', '    <field name="ghi_chu" categoryIndex="5"><header v="Ghi chú" e="Note"/></field>\r\n    <field name="bidmnccbp0"')
  .replace('    </categories>', '      <category index="5" columns="100, 400"><header v="Khác" e="Other"/></category>\r\n    </categories>');
const withHeight = renderControllerHtml(TWO_TABS, { loadDetail });
ok('panel của tab CÓ lưới: trục ngang hidden', withHeight.html.includes('overflow-y:auto;overflow-x:hidden;'));
ok('panel của tab KHÔNG lưới: trục ngang auto', withHeight.html.includes('overflow-y:auto;overflow-x:auto;'));

section('grid nhúng — thiếu file Detail thì NÓI, không vẽ ô rỗng');
// Ô rỗng nhìn y hệt "tab này vốn không có gì" — im lặng ở đây là nói dối.
const missing = renderControllerHtml(HOST_GRID, { loadDetail: () => null });
ok('báo rõ tên controller không đọc được', missing.html.includes('CustomerPurchasingDetail'));
ok('vẫn giữ ô lưới để nhìn ra chỗ nào hỏng', missing.html.includes('data-fbo-grid="CustomerPurchasingDetail"'));
// Không khai `loadDetail` (vd bộ test cũ, hoặc lời gọi thuần) cũng không được nổ.
const noLoader = renderControllerHtml(HOST_GRID);
ok('không có loader thì báo, không ném', noLoader.html.includes('Không đọc được lưới'));

section('grid đứng riêng — không bị chế độ nhúng làm lây');
const solo = renderControllerHtml(DETAIL);
eq('vẫn là mode grid', solo.mode, 'grid');
ok('giữ khung FormParent của màn hình lưới', solo.html.includes('FormParent GridTabPanel'));
ok('không mang class nhúng', !solo.html.includes('GridEmbedded'));
ok('không bị ghim chiều cao của form', !solo.html.includes('height:242px'));
ok('giữ tiêu đề riêng', solo.html.includes('Chi tiết mua hàng'));
ok('toolbar vẫn có', solo.html.includes('ToolbarTextButton'));

section('toolbar — nút không có icon thì CHỈ hiện chữ');
/*
 * Ca thật: `Grid/CustomerPurchasingDetail.f` khai `<button command="PurOrgDeclaration">` mà bản
 * chuẩn `.f` không kèm `<css>` nào khai `div.PurOrgDeclaration`.
 *
 * `.ToolbarBackgroundImage` gắn sprite cho MỌI nút mang class đó, mặc định cắt tại `0 0` — ô
 * đầu tiên, icon của lệnh «Mới». Cộng với `text-indent:22px` của `.ToolbarTextButton` (khoảng
 * chừa cho một icon không tồn tại) là ra đúng cảnh chữ đè lên một icon sai.
 */
const NOICON = [
  '<grid type="Detail">',
  '  <fields><field name="ma_vt" width="100"><header v="Mã vt" e="Item"/></field></fields>',
  '  <views><view id="Grid"><field name="ma_vt"/></view></views>',
  '  <toolbar>',
  '    <button command="Insert"><title v="Toolbar.Insert" e="Toolbar.Insert"/></button>',
  '    <button command="PurOrgDeclaration"><title v="Khai báo theo đơn vị$$120" e="By org$$120"/></button>',
  '  </toolbar>',
  '</grid>',
].join('\r\n');
const noIcon = renderControllerHtml(NOICON);
ok('lệnh lạ: không gắn ToolbarBackgroundImage',
  noIcon.html.includes('<div class="ToolbarTextButton ToolbarNoIcon" data-fbo-command="PurOrgDeclaration"'));
ok('lệnh lạ: vẫn giữ nguyên nhãn', noIcon.html.includes('>Khai báo theo đơn vị</div>'));
// Lệnh có ô sprite thì KHÔNG được đụng tới — đây mới là phần dễ hỏng khi thêm luật mới.
ok('lệnh có sprite: giữ nguyên nút có icon',
  noIcon.html.includes('ToolbarBackgroundImage TextInsert ToolbarTextButton'));
ok('lệnh có sprite: không bị gắn nhầm ToolbarNoIcon', !/TextInsert[^"]*ToolbarNoIcon/.test(noIcon.html));

// `<css>` của chính program khai icon cho nút riêng → nút đó có icon thật, giữ nguyên đường cũ.
const WITHCSS = NOICON.replace('</grid>',
  '  <css><text><![CDATA[div.TextPurOrgDeclaration{background-image:url(../Images/PurOrg.png);}]]></text></css>\r\n</grid>');
const withCss = renderControllerHtml(WITHCSS);
ok('program khai icon → giữ nút có icon',
  withCss.html.includes('ToolbarBackgroundImage TextPurOrgDeclaration ToolbarTextButton'));
ok('program khai icon → không gắn ToolbarNoIcon', !withCss.html.includes('ToolbarNoIcon'));

section('lưới — hàng tổng và cột STT là CHROME, không phải slot sửa được');
/*
 * Runtime có cả hai thật (đo trên trang đã lưu: một `FooterCellDefault` mỗi cột, cao 22px), nên
 * vẫn phải vẽ — bỏ đi là lưới hụt 22px và phép tính `rows = thân + 8 + 22` lệch theo.
 *
 * Nhưng gắn `data-fbo-*` lên chúng thì `wireSelection` bám vào, và người dùng bấm được một ô
 * rỗng: có viền chọn, không có thanh lệnh, và không nhảy tới XML được vì hai chỗ này không có
 * `data-fbo-src-start` nào để mà nhảy. Không `<field>` nào khai cột STT, còn hàng tổng thì
 * không phải một cột.
 */
const footerHtml = /<tr class="GridFooter">[\s\S]*?<\/tr>/.exec(emb.html)[0];
ok('hàng tổng vẫn được vẽ', footerHtml.includes('FooterCellDefault'));
ok('hàng tổng không mang data-fbo-*', !footerHtml.includes('data-fbo-'));
ok('cột STT không mang data-fbo-*', !/<td class="IndexCell[A-Za-z]*"[^>]*data-fbo-/.test(emb.html));
// Ô tiêu đề cột thì NGƯỢC LẠI — nó là cột thật, sửa được, và phải giữ đủ mốc để nhảy tới XML.
ok('ô tiêu đề vẫn mang data-fbo-column', /class="HeaderCellDefault[^"]*"[^>]*data-fbo-column=/.test(emb.html));


section('lưới đứng riêng kiểu danh sách — rộng bằng khung nhìn, không bằng tổng px');
/*
 * Màn hình danh sách («Hóa đơn bán hàng: thêm, sửa, xóa…») không phải một cái dialog: runtime
 * cho nó chiếm hết bề ngang cửa sổ rồi cuộn ngang phần cột thừa, và nó không có bề rộng cố định
 * nào để mà đối chiếu. Ghim `width: tổng px` như lưới Detail thì một danh sách 15 cột kéo cả
 * trang designer rộng ra hàng nghìn px.
 *
 * Phân biệt bằng `@type`, đúng như runtime phân biệt.
 */
const listGrid = (type) => renderControllerHtml([
  `<grid table="m64$000000" type="${type}" xmlns="urn:schemas-fast-com:data-grid">`,
  '  <fields>',
  '    <field name="ma_kh" width="100"><header v="Mã khách" e="Code"/></field>',
  '    <field name="ten_kh" width="300"><header v="Tên khách" e="Name"/></field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="ma_kh"/><field name="ten_kh"/></view></views>',
  '</grid>',
].join('\r\n'));

for (const type of ['Voucher', 'Report']) {
  const g = listGrid(type);
  ok(`${type}: panel rộng 100%, không ghim px`, g.html.includes('style="width:100%;overflow:hidden;"'));
  ok(`${type}: mang dấu GridFitWidth cho tầng vỏ`, g.html.includes('FormParent GridTabPanel GridFitWidth'));
  // Rộng bằng khung nhìn thì phần cột thừa phải cuộn được — nếu không thì cột bị cắt mất luôn.
  ok(`${type}: thân lưới cuộn ngang được`, g.html.includes('overflow-x:auto;overflow-y:auto;'));
  eq(`${type}: báo cờ ra cho tầng vỏ`, g.fitWidth, true);
}
// Stage của webview là `inline-block`, nên `width:100%` một mình không nới được gì — cờ này là
// thứ webview dùng để lật nó sang `block`. Thiếu nó thì panel vẫn co theo nội dung.
ok('lowercase cũng nhận', renderControllerHtml(
  '<grid type="voucher" xmlns="urn:schemas-fast-com:data-grid"><fields><field name="a" width="10"><header v="A" e="A"/></field></fields><views><view id="Grid"><field name="a"/></view></views></grid>',
).fitWidth);

// Kiểu khác giữ nguyên lối cũ: chưa đo được runtime của chúng, và đoán thêm là quay lại đúng
// thói tự chế đã phải dọn ở fbo-grid.css.
for (const type of ['Detail', 'Inquiry']) {
  const g = listGrid(type);
  ok(`${type}: vẫn ghim theo tổng px`, /style="width:\d+px;"/.test(g.html));
  ok(`${type}: không mang GridFitWidth`, !g.html.includes('GridFitWidth'));
  eq(`${type}: cờ tắt`, g.fitWidth, false);
}

// Lưới NHÚNG không bao giờ fit-width, kể cả khi ai đó khai type="Voucher" cho nó: bề rộng của
// lưới nhúng do ô chứa nó quyết, và cho nó rộng 100% khung nhìn là nó thò ra ngoài tab.
const embVoucher = renderControllerHtml(HOST_GRID, {
  loadDetail: () => ({
    text: DETAIL.replace('type="Detail"', 'type="Voucher"'),
    segments: null,
    file: 'C:/P/App_Data/Controllers/Grid/CustomerPurchasingDetail.f',
  }),
});
ok('lưới nhúng không fit-width dù khai Voucher', !embVoucher.html.includes('GridFitWidth'));
ok('lưới nhúng giữ max-width của ô chứa', embVoucher.html.includes('max-width:100%;overflow:hidden;'));


section('toolbar — màn hình danh sách dùng khoá Toolbar.Copy cho lệnh Clone');
/*
 * Cùng LỆNH `Clone` nhưng KHÁC KHOÁ, và đó không phải lỗi chính tả của ai: lưới Detail trong tab
 * dùng `Toolbar.Clone` («Nhân dòng»), còn màn hình danh sách dùng `Toolbar.Copy` («Chép dữ
 * liệu»). 109 file trong FBISP24 dùng khoá này.
 *
 * Thiếu khoá thì chuỗi rơi về nguyên văn `Toolbar.Copy`, mà chuỗi ấy không có dấu `$` nào → nút
 * thành CHỈ ICON, class `Copy`, và `.Copy` không có ô sprite nào nên nó rơi về ô số 0: icon
 * lệnh «Mới», không chữ.
 *
 * Mốc so là dòng chép từ HTML runtime của màn hình danh sách, bỏ `id` và hai handler.
 */
const listToolbar = renderControllerHtml([
  '<grid table="m64$000000" type="Voucher" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields><field name="so_ct" width="100"><header v="Số" e="No"/></field></fields>',
  '  <views><view id="Grid"><field name="so_ct"/></view></views>',
  '  <toolbar>',
  '    <button command="New"><title v="Toolbar.New" e="Toolbar.New"/></button>',
  '    <button command="Clone"><title v="Toolbar.Copy" e="Toolbar.Copy"/></button>',
  '    <button command="ImportData"><title v="Toolbar.ImportData" e="Toolbar.ImportData"/></button>',
  '  </toolbar>',
  '</grid>',
].join('\r\n')).html;

ok('Toolbar.Copy → nút CÓ CHỮ, class TextClone, rộng tối đa 90', listToolbar.includes(
  '<div class="ToolbarBackgroundImage TextClone ToolbarTextButton" data-fbo-command="Clone"'
  + ' style="height:22px;border-width:0px;max-width:90px;" title="Chép dữ liệu (Ctrl + Q)">Chép dữ liệu</div>'));
// Không được rơi về nhánh chỉ-icon: class `Copy` không có ô sprite nào.
ok('không rơi về class Copy', !listToolbar.includes('data-fbo-command="Clone"') || !/"[^"]*\bCopy\b[^"]*" data-fbo-command="Clone"/.test(listToolbar));
// Lưới Detail vẫn dùng khoá riêng của nó — hai khoá không được lẫn vào nhau.
ok('Toolbar.Clone vẫn ra «Nhân dòng»', emb.html.includes('>Nhân dòng</div>'));

// `ImportData` là nút chỉ icon (chuỗi tài nguyên không có `$`), và icon của nó KHÔNG nằm trong
// sprite chung — base pack nối riêng `fbo-upload.png`. Ở đây chỉ khẳng định phần core sinh ra.
ok('ImportData ra nút chỉ icon 22px', listToolbar.includes(
  '<div class="ToolbarBackgroundImage ImportData" data-fbo-command="ImportData"'
  + ' style="height:22px;width:22px;border-width:0px;" title="Lấy dữ liệu từ tệp..."></div>'));


section('grid — checkbox, maxlength, và mấy thứ lưới KHÔNG có');
/*
 * Khuôn runtime (`renderCell` trong `ScriptResource.axd`) chỉ sinh ra `<input>`, hai loại:
 *
 *   {11} = a ? "TextInput" : ($func.isOpr ? "CheckPadding" : "CheckInput")
 *   {6}  = a ? "text" : "checkbox"        {9} = !a & (u||ReadOnly) ? 'disabled="disabled"'
 *   {10} = MaxLength>0 && ItemStyle!="AutoComplete" ? 'maxlength="N"'
 *
 * Nên lưới KHÔNG có `<select>` và KHÔNG có `<textarea>` — kể cả khi cột khai `DropDownList`
 * hay `rows="3"`. Dựng chúng ra là bịa thêm thứ runtime không có.
 */
const CELLS = [
  '<grid type="Detail" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="co_ck" type="Boolean" width="40"><header v="CK" e="Disc"/></field>',
  '    <field name="da_duyet" type="Boolean" readOnly="true" width="40"><header v="Duyệt" e="Appr"/></field>',
  '    <field name="ma_vt" width="100" maxLength="16"><header v="Mã vt" e="Item"/></field>',
  '    <field name="ma_kh" width="100" maxLength="16"><header v="Mã kh" e="Cust"/>',
  '      <items style="AutoComplete" controller="Customer"/></field>',
  '    <field name="loai" width="80"><header v="Loại" e="Type"/>',
  '      <items style="DropDownList"><item value="1" v="Một" e="One"/></items></field>',
  '    <field name="ghi_chu" width="200" rows="3"><header v="Ghi chú" e="Note"/></field>',
  '  </fields>',
  '  <views><view id="Grid">',
  '    <field name="co_ck"/><field name="da_duyet"/><field name="ma_vt"/>',
  '    <field name="ma_kh"/><field name="loai"/><field name="ghi_chu"/>',
  '  </view></views>',
  '</grid>',
].join('\r\n');
const cells = renderControllerHtml(CELLS).html;

// Checkbox: `CellInput CheckInput`, và readOnly ra `disabled` (thuộc tính, không phải class).
ok('checkbox là CellInput CheckInput', cells.includes('type="checkbox"') && cells.includes('class="CellInput CheckInput"'));
ok('checkbox readOnly ra thuộc tính disabled',
  /class="CellInput CheckInput"[^>]*\bdisabled\b/.test(cells));

// maxlength theo runtime: có ở cột thường, BỎ QUA ở cột AutoComplete — ô ấy còn phải chứa được
// giá trị người dùng gõ dở trước khi danh sách lọc xong.
ok('cột thường có maxlength', /data-field-name="ma_vt" maxlength="16"/.test(cells));
ok('cột AutoComplete KHÔNG có maxlength', !/data-field-name="ma_kh"[^>]*maxlength/.test(cells));

// Lưới không có select và không có textarea, dù field khai DropDownList / rows="3".
ok('cột DropDownList vẫn là input, không phải select', !cells.includes('<select'));
ok('cột rows=3 vẫn là input, không phải textarea', !cells.includes('<textarea'));
eq('mỗi cột đúng một input', (cells.match(/<input /g) || []).length, 6);

// Form thì NGƯỢC LẠI — cùng mấy field ấy, form vẫn dựng select và textarea. Hai đường phải tách
// nhau, nếu không thì sửa cho lưới là hỏng form.
const asForm = renderControllerHtml([
  '<dir table="t">',
  '  <fields>',
  '    <field name="loai"><header v="Loại" e="Type"/>',
  '      <items style="DropDownList"><item value="1" v="Một" e="One"/></items></field>',
  '    <field name="ghi_chu" rows="3"><header v="Ghi chú" e="Note"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 200"/>',
  '    <item value="11: [loai].Label, [loai]"/>',
  '    <item value="11: [ghi_chu].Label, [ghi_chu]"/>',
  '  </view>',
  '</dir>',
].join('\r\n')).html;
ok('form vẫn dựng <select>', asForm.includes('<select'));
ok('form vẫn dựng <textarea>', asForm.includes('<textarea'));
ok('form vẫn dùng bộ class FormInput', asForm.includes('FormComboBox'));
ok('form KHÔNG dùng CellInput', !asForm.includes('CellInput'));


section('arrangement — chỗ đứng của cột do cấu hình ẩn chèn vào');
/*
 * Cột do `Grid/Config` mang vào mặc định nối đuôi. `arrangement` khai nó phải đứng ở đâu, và
 * ĐÂY LÀ THỨ TỰ NGƯỜI DÙNG THẤY — sai thứ tự thì preview đủ cột nhưng bố cục khác màn hình thật.
 *
 *   %a(x)  ngay SAU cột x   ·   %b(x)  ngay TRƯỚC cột x   ·   %l0  nối vào cuối
 */
const cols = (names) => names.map((n) => ({ name: n }));
const names = (list) => list.map((c) => c.name);

eq('%a — đứng ngay sau', names(applyArrangement(cols(['a', 'b', 'c']), 'c:%a(a)')), ['a', 'c', 'b']);
eq('%b — đứng ngay trước', names(applyArrangement(cols(['a', 'b', 'c']), 'a:%b(c)')), ['b', 'a', 'c']);
/*
 * `%l0` = sau cột CUỐI CÙNG KHAI TRONG FILE GRID, không phải «nối vào cuối danh sách».
 * Hai cách đọc chỉ trùng nhau khi đúng một cột được chèn thêm.
 *
 * Cột «khai trong file Grid» là cột không mang dấu nguồn (`source == null`) — `mergeGridConfig`
 * đóng dấu lên mọi cột đến từ `Grid/Config`.
 */
const own = (names_) => names_.map((n) => ({ name: n, source: null }));
const added = (names_) => names_.map((n) => ({ name: n, source: { file: 'cfg' } }));

// Không có cột nào của cấu hình: mốc là cột cuối, nên `%l0` đẩy a xuống sau c.
eq('%l0 — sau cột cuối của file Grid',
  names(applyArrangement(own(['a', 'b', 'c']), 'a:%l0')), ['b', 'c', 'a']);

// Ca thật: SOTran khai tới `ma_nt`, cấu hình chèn thêm ba cột phía sau.
const sotran = [...own(['ma_kh', 'ten_kh%l', 'ma_nt']), ...added(['dien_giai', 'status', 'u0'])];
eq('mốc là ma_nt, KHÔNG phải u0',
  names(applyArrangement(sotran, 'dien_giai:%l0')),
  ['ma_kh', 'ten_kh%l', 'ma_nt', 'dien_giai', 'status', 'u0']);

// Mốc TIẾN DẦN: hai cột cùng `%l0` giữ đúng thứ tự khai, không đảo ngược.
eq('hai luật %l0 giữ thứ tự khai',
  names(applyArrangement(sotran, 'u0:%l0;status:%l0')),
  ['ma_kh', 'ten_kh%l', 'ma_nt', 'u0', 'status', 'dien_giai']);

// Mốc ghim theo ĐỐI TƯỢNG cột, nên luật %a chạy trước có dời ma_nt thì %l0 vẫn bám đúng nó.
eq('%a dời mốc rồi thì %l0 bám theo mốc mới',
  names(applyArrangement(sotran, 'ma_nt:%b(ma_kh);dien_giai:%l0')),
  ['ma_nt', 'dien_giai', 'ma_kh', 'ten_kh%l', 'status', 'u0']);

ok('%l0 không kêu cảnh báo', (() => {
  const w = [];
  applyArrangement(own(['a', 'b']), 'a:%l0', w);
  return w.length === 0;
})());
eq('nhiều luật, phân cách bằng ";"',
  names(applyArrangement(cols(['a', 'b', 'c', 'd']), 'd:%b(b);a:%a(c)')), ['d', 'b', 'c', 'a']);

// Áp TUẦN TỰ: `c:%a(b)` neo vào chỗ b ĐANG đứng sau khi b vừa dời, không phải chỗ cũ.
eq('luật sau nhìn thấy kết quả của luật trước',
  names(applyArrangement(cols(['a', 'b', 'c', 'd']), 'b:%a(d);c:%a(b)')), ['a', 'd', 'b', 'c']);

// Tên cột chứa chính ký tự `%` (`ten_kh%l`) — dấu lệnh phải bóc bằng neo đầu chuỗi, không phải
// bằng cách tìm dấu `%` gần nhất.
eq('tên cột có "%" không làm hỏng phép bóc lệnh',
  names(applyArrangement(cols(['ten_kh%l', 'dia_chi', 'x']), 'dia_chi:%a(ten_kh%l)')),
  ['ten_kh%l', 'dia_chi', 'x']);
eq('và neo được vào cột có "%"',
  names(applyArrangement(cols(['ten_kh%l', 'x', 'dia_chi']), 'dia_chi:%b(ten_kh%l)')),
  ['dia_chi', 'ten_kh%l', 'x']);

// Neo hỏng thì để nguyên chỗ và NÓI RA — đẩy về cuối lặng lẽ là giấu một khai báo sai.
const w = [];
eq('neo vào cột không có thì giữ nguyên',
  names(applyArrangement(cols(['a', 'b']), 'a:%a(khong_co)', w)), ['a', 'b']);
ok('và ghi cảnh báo', w.some((x) => /khong_co/.test(x.message)));
eq('không khai arrangement thì giữ nguyên', names(applyArrangement(cols(['a', 'b']), '')), ['a', 'b']);

section('Grid/Config — cột ẩn được gộp vào, kèm nguồn RIÊNG của từng mảnh');
/*
 * Ca thật: `Grid/SOTran.f` khai 8 cột, nhưng màn hình chạy có 11 — ba cột «Diễn giải»,
 * «status», «Trạng thái» đến từ `<group id="001">` trong `Grid/Config/Initialize.xml`, và
 * không có một chữ nào trong file controller.
 */
const BASE = [
  '<grid type="Voucher" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="so_ct" width="100"><header v="Số" e="No"/></field>',
  '    <field name="ten_kh%l" width="300"><header v="Tên khách" e="Customer"/></field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="so_ct"/><field name="ten_kh%l"/></view></views>',
  '</grid>',
].join('\r\n');

const GROUP = [
  '<group id="001">',
  '  <fields>',
  '    <field name="dien_giai" width="300"><header v="Diễn giải" e="Memo"/></field>',
  '    <field name="u0" width="120"><header v="Trạng thái" e="Status"/></field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="dien_giai"/><field name="u0"/></view></views>',
  '</group>',
].join('\r\n');

const OWN = [
  '<grid xmlns="urn:schemas-fast-com:grid-fields">',
  '  <fields><field name="dia_chi" width="200"><header v="Địa chỉ" e="Address"/></field></fields>',
  '  <views><view id="Grid" arrangement="dia_chi:%a(ten_kh%l)"><field name="dia_chi"/></view></views>',
  '</grid>',
].join('\r\n');

const noCfg = renderControllerHtml(BASE);
eq('chưa gộp: đúng 2 cột của controller', noCfg.model.columns.map((c) => c.name), ['so_ct', 'ten_kh%l']);

const withCfg = renderControllerHtml(BASE, {
  gridConfig: [
    { text: GROUP, segments: null, file: 'C:/P/App_Data/Controllers/Grid/Config/Initialize.xml' },
    { text: OWN, segments: null, file: 'C:/P/App_Data/Controllers/Grid/Config/Fields/SOTran.xml' },
  ],
});
// Cột của group nối đuôi; `dia_chi` bị arrangement kéo về ngay sau `ten_kh%l`.
eq('gộp xong và sắp theo arrangement', withCfg.model.columns.map((c) => c.name),
  ['so_ct', 'ten_kh%l', 'dia_chi', 'dien_giai', 'u0']);
// Nhãn phải lấy từ `<field>` của chính mảnh — không có thì cột ra tên trần.
ok('nhãn của cột gộp lấy từ <field> của mảnh', withCfg.html.includes('>Diễn giải<') && withCfg.html.includes('>Địa chỉ<'));
eq('bề rộng cũng lấy từ mảnh', withCfg.model.columns.find((c) => c.name === 'u0').width, 120);

// Trùng tên thì bản của CONTROLLER thắng — cấu hình ẩn là phần bổ sung dùng chung.
const clash = renderControllerHtml(BASE, {
  gridConfig: [{
    text: GROUP.replace('name="dien_giai" width="300"', 'name="so_ct" width="999"'),
    segments: null,
    file: 'C:/P/x.xml',
  }],
});
eq('không nhân đôi cột trùng tên',
  clash.model.columns.filter((c) => c.name === 'so_ct').length, 1);
eq('và giữ bề rộng của controller', clash.model.columns.find((c) => c.name === 'so_ct').width, 100);

// Không có `segments` của mảnh thì cột gộp KHÔNG có range — thà không nhảy được còn hơn nhảy
// vào một offset của file chẳng liên quan.
eq('cột gộp không bịa range khi thiếu segments',
  withCfg.model.columns.find((c) => c.name === 'u0').range, null);


section('%l — hậu tố NGÔN NGỮ của tên field, không phải một phần của tên');
/*
 * `ten_kh%l` → tiếng Việt `ten_kh`, tiếng Anh `ten_kh2`. Tức một tên field trong XML trỏ tới
 * HAI cột database khác nhau tuỳ bản đang xem: `select ten_kh from dmkh` với bản Việt,
 * `select ten_kh2 from dmkh` với bản Anh.
 *
 * Ca biên chép từ `InformationSqlBuilder` của DWF: gốc đã kết thúc bằng `2` thì KHÔNG nối thêm.
 */
eq('vi: bỏ hậu tố', resolveLocaleName('ten_kh%l', true), 'ten_kh');
eq('en: nối "2"', resolveLocaleName('ten_kh%l', false), 'ten_kh2');
/*
 * Phép thay THUẦN, không có ca biên. `InformationSqlBuilder` của DWF khai ngược lại («gốc đã có
 * `2` thì không nối thêm»); bản ở đây theo lời chủ hệ thống. Ghi ra chỗ lệch để lần sau không ai
 * «sửa lại cho giống DWF» mà không biết là đang lật một quyết định.
 */
eq('vi: gốc đã có "2" thì giữ nguyên', resolveLocaleName('ten_kh2%l', true), 'ten_kh2');
eq('en: gốc đã có "2" vẫn nối tiếp thành "22"', resolveLocaleName('ten_kh2%l', false), 'ten_kh22');
eq('không có hậu tố thì giữ nguyên', resolveLocaleName('ma_kh', false), 'ma_kh');
// Chỉ đụng hậu tố Ở CUỐI — cắt tại dấu `%` đầu tiên là mất phần đuôi.
eq('"%" giữa tên không phải hậu tố', resolveLocaleName('a%lb', false), 'a%lb');

const LOCALE = [
  '<grid type="Detail" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields><field name="ten_kh%l" width="200"><header v="Tên khách" e="Customer"/></field></fields>',
  '  <views><view id="Grid"><field name="ten_kh%l"/></view></views>',
  '</grid>',
].join('\r\n');

const viHtml = renderControllerHtml(LOCALE, { vi: true }).html;
const enHtml = renderControllerHtml(LOCALE, { vi: false }).html;
ok('vi: ô nhập mang tên cột database bản Việt', viHtml.includes('data-field-name="ten_kh"'));
ok('en: ô nhập mang tên cột database bản Anh', enHtml.includes('data-field-name="ten_kh2"'));
ok('vi: tooltip cột nói tên đã phân giải', viHtml.includes('title="ten_kh · 200px"'));
ok('en: tooltip cột nói tên đã phân giải', enHtml.includes('title="ten_kh2 · 200px"'));

/*
 * Thuộc tính data-fbo-column thì NGUYÊN VĂN, không phân giải. Nó là khoá tầng edit tra ngược về
 * khai báo field trong XML — phân giải nó là mọi phép sửa cột tìm không ra field và im lặng
 * từ chối. Hai thuộc tính, hai việc.
 */
ok('vi: data-fbo-column giữ nguyên văn', viHtml.includes('data-fbo-column="ten_kh%l"'));
ok('en: data-fbo-column cũng giữ nguyên văn', enHtml.includes('data-fbo-column="ten_kh%l"'));

/* ══════════════════════════════════════════════════════════════════════════
 * Dải lọc nhanh — `<div class="FilterPanel">` dưới tiêu đề cột.
 *
 * Mốc đối chiếu là HAI trang runtime đã lưu (`DevWorkFlow/.temp/`), không phải suy:
 *
 *   `Danh mục khách hàng` — `Grid/Customer.f`, lưới danh mục KHÔNG khai `type`, field chỉ có
 *   `allowFilter="true"` và không có `<query>`. Runtime vẽ đủ nút + ô nhập cho cả 5 cột.
 *
 *   `Hóa đơn bán hàng` — ARTran đã customize, `type="Voucher"`, field có `allowFilter="true"`
 *   nhưng KHÔNG field nào khai `<query>`. Runtime dựng đủ 16 `<div class="FilterPanel">` (kể cả
 *   cột `stt_rec` ẩn) nhưng để RỖNG.
 * ══════════════════════════════════════════════════════════════════════════ */

section('lưới — <field><query> là bản khai lọc nhanh, quét được kèm field');
const QFIELDS = scanFields([
  '<grid xmlns="urn:schemas-fast-com:data-grid"><fields>',
  '  <field name="ma_kh" allowFilter="true"><header v="Mã khách" e="Customer"/>',
  '    <query>insert into #filter select @@fieldName, @@type, @@conditional</query></field>',
  '  <field name="so_ct" allowFilter="true"><header v="Số" e="Number"/><query></query></field>',
  '  <field name="ma_nt" allowFilter="true"><header v="Mã nt" e="Currency"/></field>',
  '</fields></grid>',
].join('\n'));
const byName = new Map(QFIELDS.map((f) => [f.name, f]));
eq('field có <query> thì giữ nguyên nội dung đã phân giải',
  byName.get('ma_kh').query, 'insert into #filter select @@fieldName, @@type, @@conditional');
// `&InsertCommandFilter;` phân giải thành rỗng khi `Include\Filter.txt` là IGNORE — đó là công
// tắc tắt lọc của cả hệ thống, phải phân biệt được với "không khai <query>".
eq('<query></query> rỗng là RỖNG, không phải null', byName.get('so_ct').query, '');
eq('không khai <query> thì null', byName.get('ma_nt').query, null);

section('lưới — lưới danh mục: allowFilter một mình là đủ để có ô lọc');
const LIST_FILTER = [
  '<grid table="dmkh" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="ma_kh" width="100" allowFilter="true"><header v="Mã khách" e="Customer ID"/></field>',
  '    <field name="dia_chi" width="300" allowFilter="true"><header v="Địa chỉ" e="Address"/></field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="ma_kh"/><field name="dia_chi"/></view></views>',
  '</grid>',
].join('\n');
const list = renderControllerHtml(LIST_FILTER);
eq('cả hai cột lọc được', list.model.filterColumns.map((c) => c.name), ['ma_kh', 'dia_chi']);
ok('hàng tiêu đề cao 60px, không phải 30', list.html.includes('<tr class="GridHeader" style="height:60px;">'));
eq('mỗi cột một dải lọc', (list.html.match(/class="FilterPanel"/g) ?? []).length, 2);
eq('mỗi dải một nút toán tử', (list.html.match(/FilterPanelBackground8/g) ?? []).length, 2);
ok('ô nhập bị khoá — designer không có dữ liệu để lọc', list.html.includes('class="FilterPanelText" value="" readonly'));
ok('container tiêu đề nhận đệm trên 8px của runtime', list.html.includes('padding-top:8px;height:17px;'));

section('lưới — Voucher: allowFilter mở DẢI, phải có <query> mới có Ô');
const VOUCHER_FILTER = [
  '<grid table="m64$000000" type="Voucher" xmlns="urn:schemas-fast-com:data-grid">',
  '  <fields>',
  '    <field name="stt_rec" isPrimaryKey="true" width="0" hidden="true"><header v="" e=""/></field>',
  '    <field name="ma_dvcs" width="100" allowFilter="true"><header v="Đơn vị" e="Unit"/>',
  '      <query>insert into #filter select @@fieldName, @@type, @@conditional</query></field>',
  '    <field name="so_ct" width="100" allowFilter="true"><header v="Số" e="Number"/></field>',
  '  </fields>',
  '  <views><view id="Grid"><field name="stt_rec"/><field name="ma_dvcs"/><field name="so_ct"/></view></views>',
  '</grid>',
].join('\n');
const vou = renderControllerHtml(VOUCHER_FILTER);
eq('chỉ cột có <query> mới lọc được', vou.model.filterColumns.map((c) => c.name), ['ma_dvcs']);
ok('nhưng dải lọc vẫn mở ra cho cả lưới', vou.model.hasFilterPanel);
// Đo trên ARTran của trang đã lưu: 16 cột, 16 dải, kể cả `stt_rec` ẩn không hề khai allowFilter.
eq('cả ba cột đều có dải — kể cả cột ẩn', (vou.html.match(/class="FilterPanel"/g) ?? []).length, 3);
eq('nhưng chỉ MỘT ô nhập', (vou.html.match(/class="FilterPanelText"/g) ?? []).length, 1);
eq('và chỉ một cột mang dấu data-fbo-filter', (vou.html.match(/data-fbo-filter="1"/g) ?? []).length, 1);

section('lưới — Filter.txt IGNORE: entity rỗng thì tắt hẳn ô lọc');
/*
 * `<query>&InsertCommandFilter;</query>` + `allowFilter="&GridVoucherAllowFilter;"` là MỘT cặp
 * công tắc: `Include\Filter.txt` chuyển sang IGNORE thì entity trên thành `false`, entity dưới
 * thành chuỗi rỗng. Đọc `<query>` thành cờ boolean lúc quét sẽ nuốt mất vế thứ hai.
 */
const OFF = VOUCHER_FILTER
  .replace(/allowFilter="true"/g, 'allowFilter="false"')
  .replace(/<query>[^<]*<\/query>/g, '<query></query>');
const off = renderControllerHtml(OFF);
ok('không cột nào lọc được', off.model.filterColumns.length === 0);
ok('dải lọc không mở', !off.model.hasFilterPanel);
ok('HTML không có dải nào', !off.html.includes('FilterPanel'));
ok('hàng tiêu đề trở lại 30px của .HeaderCellDefault', off.html.includes('<tr class="GridHeader">'));
ok('container tiêu đề không còn đệm trên', !off.html.includes('padding-top:8px'));

section('lưới — lưới NHÚNG trong tab không bao giờ có dải lọc');
/*
 * Đo trên trang `Hóa đơn bán hàng`: lưới chi tiết trong tab (`dirExtender_FormGrid…`) có hàng
 * tiêu đề cao **30px**, container không đệm trên, và KHÔNG một `<div class="FilterPanel">` nào —
 * trong khi lưới ngoài của cùng trang ấy cao 60px và có đủ 16 dải.
 */
const EMBED = [
  '<dir xmlns="urn:schemas-fast-com:data-dir">',
  '  <fields><field name="d0" rows="120"><header v="Chi tiết" e="Detail"/>',
  '    <items style="Grid" controller="Detail"/></field></fields>',
  '  <views><view id="Dir" columns="100,300"><item value="1100: [d0]"/></view></views>',
  '</dir>',
].join('\n');
const embedded = renderControllerHtml(EMBED, {
  loadDetail: (name) => (name === 'Detail'
    ? { text: LIST_FILTER, segments: null, file: 'C:/P/App_Data/Controllers/Grid/Detail.f' }
    : null),
});
// Kiểm bằng chứng cứ lưới ĐÃ dựng trước đã — thiếu vế này thì `loadDetail` trả null cũng «pass».
ok('lưới nhúng dựng được', embedded.html.includes('GridEmbedded') && embedded.html.includes('Địa chỉ'));
ok('lưới nhúng: không dải lọc dù cột khai allowFilter', !embedded.html.includes('FilterPanel'));
ok('lưới nhúng: hàng tiêu đề không bị đẩy lên 60px', !embedded.html.includes('style="height:60px;"'));
