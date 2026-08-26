// test-render.mjs — HTML sinh ra phải giữ ba luật của reference-render-pipeline.md:
// bề rộng bảng = TỔNG px, table-layout fixed, và colspan là cách duy nhất để một ô rộng hơn.
//
// Cộng thêm một mốc đo THẬT: `Dir/Site.xml` của FBISP2421 render ra bảng 550px trong panel
// 573px, hàng 1 tách thành colspan 1/3/1, ô lookup rộng 77px. Con số lấy từ HTML runtime của
// chính màn hình đó, nên đây là chỗ duy nhất trong bộ test nói được "giống thật hay không".

import { ok, eq, section } from './harness.mjs';
import { renderControllerHtml, renderRowHtml, sanitizeLabelHtml, evaluateHeight, DIALOG_CHROME_PX } from '../src/render.mjs';

const XML = [
  '<dir table="dmkh">',
  '  <fields>',
  '    <field name="ma_kh" required="true"><header v="Mã khách hàng" e="Customer code"/></field>',
  '    <field name="ten_kh"><header v="Tên khách hàng" e="Customer name"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 80, 100, 120, 200"/>',
  '    <item value="1100-: [ma_kh].Label, [ma_kh]"/>',
  '    <item value="11---: [ten_kh].Label, [ten_kh]"/>',
  '  </view>',
  '</dir>',
].join('\r\n');

section('render — ba luật của bảng');
const { html, model, warnings } = renderControllerHtml(XML);
eq('không cảnh báo gì', warnings, []);
ok('bề rộng bảng = tổng px (600), không phải 100%', html.includes('width:600px'));
ok('table-layout: fixed', html.includes('table-layout:fixed'));
ok('hàng cột ẩn phát ra đủ 5 th', (html.match(/<th style="width:/g) || []).length === 5);
// Runtime CÓ `width:100%` trên td (vô hại dưới table-layout:fixed). Cái không được phép là
// bề rộng PX riêng cho một ô — đó mới là thứ phá bất biến "colspan là cách duy nhất".
ok('không ô nào có bề rộng px riêng', !/<td[^>]*style="[^"]*width:\s*\d+px/.test(html));
ok('ô Input span 3 ra colspan="3"', html.includes('colspan="3"'));

section('render — khung dialog, không phải mỗi cái bảng');
ok('panel = bảng + chrome đo được', html.includes(`width:${model.totalWidth + DIALOG_CHROME_PX}px`));
for (const cls of ['UpdateDlgPanel', 'UpdateDlgBorder', 'UpdateDlgFloor', 'UpdateDlgContainer',
  'UpdateDlgFrame', 'UpdateTaskDialog', 'UpdateDlgContent']) {
  ok(`có lớp ${cls}`, html.includes(cls));
}
// Dải nút đáy cố ý KHÔNG dựng: nút nào hiện là do ngữ cảnh runtime quyết, `<view>` không khai.
ok('không dựng dải nút đáy', !html.includes('UpdateDlgFooter') && !html.includes('<button'));
ok('mọi ô mang padding 4px của runtime', /padding:4px!important/.test(html));
ok('nội dung ô nằm trong div.FormContainer', html.includes('class="FormContainer"'));
ok('ô nhập có FormContainerInput', html.includes('FormContainerInput'));

section('render — nhãn lấy từ <field><header>');
ok('nhãn tiếng Việt', html.includes('>Mã khách hàng<'));
ok('field required nhận class riêng', html.includes('FormRequiredLabel'));
ok('runtime gắn Required lên Ô NHẬP', /class="FormCell Required"/.test(html));
const en = renderControllerHtml(XML, { vi: false });
ok('chuyển sang tiếng Anh', en.html.includes('>Customer code<'));

section('render — anchor để webview trỏ ngược về XML');
const m = /data-fbo-start="(\d+)" data-fbo-end="(\d+)"/.exec(html);
ok('hàng mang offset của value trong file gốc', m !== null);
eq('offset cắt ra đúng value gốc', XML.slice(Number(m[1]), Number(m[2])), '1100-: [ma_kh].Label, [ma_kh]');

section('render — hàng có entity được đánh dấu để designer khoá lại');
const withEntity = renderControllerHtml(XML.replace('11---: [ten_kh].Label, [ten_kh]', '1&X;: [ten_kh].Label'));
ok('đánh dấu data-fbo-entity', withEntity.html.includes('data-fbo-entity="1"'));

section('render — view không khai list px');
const noWidths = renderControllerHtml([
  '<dir><fields><field name="a"><header v="A" e="A"/></field></fields>',
  '<view id="Dir"><item value="11: [a].Label, [a]"/></view></dir>',
].join('\n'));
ok('suy số cột từ pattern, mọi cột bằng nhau', noWidths.model.inferredWidths === true);
eq('hai cột', noWidths.model.widths.length, 2);

section('render — cảnh báo chạy tới được người dùng');
const bad = renderControllerHtml([
  '<dir><fields><field name="a"><header v="A" e="A"/></field></fields>',
  '<view id="Dir"><item value="50, 50"/><item value="11: [a].Label, [khong_co]"/></view></dir>',
].join('\n'));
ok('token trỏ vào field không tồn tại thì báo', bad.warnings.some((w) => w.message.includes('khong_co')));

section('render — file không có view');
ok('nói không có view thay vì ném', renderControllerHtml('<dir/>').html.includes('Không tìm thấy'));

// ---------------------------------------------------------------------------
// Đối chiếu với HTML runtime thật của Dir/Site.xml (dialog «Thêm kho hàng»).
// ---------------------------------------------------------------------------
const SITE = [
  '<dir table="dmkho" code="ma_kho" xmlns="urn:schemas-fast-com:data-dir">',
  '  <title v="kho hàng" e="Site"></title>',
  '  <fields>',
  '    <field name="ma_dvcs" allowNulls="false"><header v="Đơn vị" e="Unit"/>',
  '      <items style="AutoComplete" controller="Unit" reference="ten_dvcs%l"/></field>',
  '    <field name="ten_dvcs%l" readOnly="true" external="true" defaultValue="\'\'"><header v="" e=""/></field>',
  '    <field name="ma_kho" allowNulls="false" dataFormatString="@upperCaseFormat"><header v="Mã kho" e="Site Code"/>',
  '      <items style="Mask"/></field>',
  '    <field name="ghi_chu" rows="2"><header v="Ghi chú" e="Note"/></field>',
  '    <field name="status" clientDefault="1" align="right" inactivate="true"><header v="Trạng thái" e="Status"/>',
  '      <footer v="1 - Còn sử dụng, 0 - Không còn sử dụng" e="1 - Active, 0 - Inactive"/><items style="Mask"/></field>',
  '  </fields>',
  '  <views><view id="Dir">',
  '    <item value="120, 25, 5, 70, 330"/>',
  '    <item value="11001: [ma_dvcs].Label, [ma_dvcs],[ten_dvcs%l]"/>',
  '    <item value="1100: [ma_kho].Label, [ma_kho]"/>',
  '    <item value="11000: [ghi_chu].Label, [ghi_chu]"/>',
  '    <item value="11010: [status].Label, [status], [status].Description"/>',
  '  </view></views>',
  '</dir>',
].join('\n');

section('đối chiếu runtime — Dir/Site.xml');
const site = renderControllerHtml(SITE);
eq('gốc tài liệu là <dir> → Form', site.mode, 'form');
eq('tổng px đúng 550 như runtime', site.model.totalWidth, 550);
ok('panel 573px đúng như style inline của runtime', site.html.includes('width:573px'));
ok('tiêu đề «Thêm kho hàng»', site.html.includes('>Thêm kho hàng<'));
ok('tiêu đề nằm trong UpdateDlgTitleText', site.html.includes('class="UpdateDlgTitleText"'));

const siteRows = site.model.rows;
eq('hàng 1 tách 1/3/1 đúng như formCell_1.1 / 1.4 / 1.5', siteRows[0].cells.map((c) => c.span), [1, 3, 1]);
eq('ô lookup trải 25+5+70 = 100px', siteRows[0].cells[1].width, 100);
ok('nên input lookup rộng 77px, khớp runtime', site.html.includes('width:77px;'));
eq('hàng status tách 1/2/2 như formCell_11.1 / 11.3 / 11.5', siteRows[3].cells.map((c) => c.span), [1, 2, 2]);
ok('ô mô tả lấy từ <footer>', site.html.includes('>1 - Còn sử dụng, 0 - Không còn sử dụng<'));
ok('ma_kho viết hoa như dataFormatString', site.html.includes('text-transform:uppercase;'));
ok('ten_dvcs%l dùng bộ class disabled của runtime', site.html.includes('class="FormInputDisabled FormTextInputDisabled"'));
// Nhãn không mang style riêng nào: runtime canh TRÁI, và canh lề là việc của CSS chứ không
// phải của HTML. Ô nhãn chỉ được có đúng bộ style chung của mọi ô.
const labelCell = /<td class="FormCell"[^>]*data-fbo-token="\[ma_kho\]\.Label"[^>]*>/.exec(site.html)
  || /<td class="FormCell" nowrap style="([^"]*)"[^>]*>/.exec(site.html);
ok('ô nhãn không mang style riêng', labelCell !== null && !/text-align/.test(labelCell[0]));

// Hàng có textarea được runtime canh lên đỉnh — cả nhãn lẫn ô.
eq('hàng ghi_chu canh top', siteRows[2].valign, 'top');
eq('hàng thường canh middle', siteRows[0].valign, 'middle');
ok('ô textarea dùng FormContainerTextArea', site.html.includes('FormContainerTextArea'));

section('đối chiếu runtime — titleMode cho Filter');
const filt = renderControllerHtml(SITE, { titleMode: 'plain' });
ok('Filter không thêm chữ «Thêm»', filt.html.includes('>kho hàng<'));

// ─────────────────────────────────────────────────────────────────────────────
// categoryIndex — vùng của form.
//
// Bẫy của định dạng: `categoryIndex` khai trên `<field>`, KHÔNG khai trên `<item>`. Hàng lấy
// vùng từ field đầu tiên trong hàng có khai. Bộ test này chốt đúng chỗ đó, cộng với chuyện
// mỗi vùng đo bằng list px riêng của nó (`<category columns>`), không phải list px của view.
const CAT = [
  '<dir table="cptran">',
  '  <fields>',
  '    <field name="ma_kh"><header v="Mã khách" e="Customer"/></field>',
  '    <field name="dien_giai"><header v="Diễn giải" e="Note"/></field>',
  '    <field name="dia_chi" categoryIndex="1"><header v="Địa chỉ" e="Address"/></field>',
  '    <field name="ma_so_thue" categoryIndex="2"><header v="Mã số thuế" e="Tax code"/></field>',
  '    <field name="t_tien" categoryIndex="-1"><header v="Tổng tiền" e="Total"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 200"/>',
  '    <item value="11: [ma_kh].Label, [ma_kh]"/>',
  '    <item value="11: [dien_giai].Label, [dien_giai]"/>',
  '    <item value="11: [dia_chi].Label, [dia_chi]"/>',
  '    <item value="11: [ma_so_thue].Label, [ma_so_thue]"/>',
  '    <item value="11: [t_tien].Label, [t_tien]"/>',
  '    <categories>',
  '      <category index="1" columns="120, 400"><header v="Địa chỉ" e="Address"/></category>',
  '      <category index="2" columns=""><header v="Thuế" e="Tax"/></category>',
  '      <category index="-1" columns="80, 90"><header v="Tổng" e="Total"/></category>',
  '    </categories>',
  '  </view>',
  '</dir>',
].join('\r\n');

section('categoryIndex — hàng vào đúng vùng');
const cat = renderControllerHtml(CAT);
eq('không cảnh báo gì', cat.warnings, []);
eq('vùng theo thứ tự header → tab (main) → footer',
  cat.model.regions.map((r) => r.id), ['header', 'cat:1', 'cat:2', 'footer']);
// Hàng KHÔNG có field nào khai categoryIndex mới ở main. Đọc nhầm sang <item> thì cả 5 hàng
// dồn vào main và tab/footer biến mất — đúng lỗi "form có categoryIndex load chưa đúng".
eq('header giữ đúng 2 hàng không khai categoryIndex',
  cat.model.regions[0].rows.map((r) => r.row.tokens[0].field), ['ma_kh', 'dien_giai']);
eq('tab 1 nhận hàng dia_chi', cat.model.regions[1].rows.map((r) => r.row.tokens[0].field), ['dia_chi']);
eq('tab 2 nhận hàng ma_so_thue', cat.model.regions[2].rows.map((r) => r.row.tokens[0].field), ['ma_so_thue']);
eq('footer (-1) nhận hàng t_tien', cat.model.regions[3].rows.map((r) => r.row.tokens[0].field), ['t_tien']);

section('categoryIndex — mỗi vùng đo bằng list px của chính nó');
eq('header dùng list px của view', cat.model.regions[0].totalWidth, 300);
eq('tab 1 dùng <category columns> riêng', cat.model.regions[1].totalWidth, 520);
// `columns=""` không phải "vùng rộng 0" mà là "không khai" — rơi về list px của view.
eq('tab 2 khai columns rỗng thì rơi về view', cat.model.regions[2].totalWidth, 300);
eq('footer dùng columns của <category index="-1">', cat.model.regions[3].totalWidth, 170);
eq('ô trong tab 1 rộng theo cột của tab, không của view', cat.model.regions[1].rows[0].cells[1].width, 400);
// Panel phải ôm vùng RỘNG NHẤT, không riêng main — không thì bảng của tab tràn ra ngoài panel.
eq('panel ôm vùng rộng nhất (520) + chrome', cat.model.panelWidth, 520 + DIALOG_CHROME_PX);

section('categoryIndex — HTML tab khớp fbo-tabs.css');
ok('có thanh tab', cat.html.includes('class="DwfTabList" role="tablist"'));
ok('tab đầu được chọn', cat.html.includes('aria-selected="true" data-target="fbo-tab-1"'));
ok('tab sau không được chọn', cat.html.includes('aria-selected="false" data-target="fbo-tab-2"'));
ok('nhãn tab lấy từ <category><header v>', cat.html.includes('>Địa chỉ</button>'));
ok('panel đầu mở sẵn bằng DwfActive', cat.html.includes('class="DwfTabPanel DwfActive"'));
ok('panel sau đóng', cat.html.includes('id="fbo-tab-2" class="DwfTabPanel"'));
ok('footer là FormRegion riêng', cat.html.includes('data-dwf-region="footer"'));
ok('mỗi bảng khai vùng của nó', cat.html.includes('data-fbo-region-table="cat:1"'));

section('categoryIndex — form không khai gì vẫn y như cũ');
// Đây là bản hồi quy: form KHÔNG có categoryIndex trước nay load đúng, và phải tiếp tục đúng.
const plain = renderControllerHtml(XML);
eq('chỉ một vùng header', plain.model.regions.map((r) => r.id), ['header']);
eq('mọi hàng ở header', plain.model.regions[0].rows.length, plain.model.rows.length);
ok('không sinh thanh tab', !plain.html.includes('DwfTabList'));
ok('không sinh vùng footer', !plain.html.includes('data-dwf-region="footer"'));
eq('panel vẫn đo theo main', plain.model.panelWidth, plain.model.totalWidth + DIALOG_CHROME_PX);

section('categoryIndex — nhãn của hàng cũng kéo hàng theo field');
// Token đầu của hàng là `.Label` của chính field khai categoryIndex — luật "field ĐẦU TIÊN
// trong hàng có khai" phải nhìn cả token nhãn, không chỉ token input.
eq('hàng nhãn+input của dia_chi nằm nguyên trong tab 1', cat.model.regions[1].rows.length, 1);

section('nhãn là innerHTML, không phải văn bản');
// Runtime nhét nguyên chuỗi `<header v>` vào DOM. Escape cả cụm thì người dùng thấy thẻ.
eq('thẻ trình bày giữ nguyên', sanitizeLabelHtml('Mã số th<u>u</u>ế'), 'Mã số th<u>u</u>ế');
eq('span kèm class/title/id giữ được — CSS của program bám vào đó',
  sanitizeLabelHtml('<span title="Xem" id="divCheck" class="CheckTaxCodeFlag"></span>'),
  '<span title="Xem" id="divCheck" class="CheckTaxCodeFlag"></span>');
// Chuỗi đến từ file của khách, mà webview có acquireVsCodeApi() — không cho qua nguyên xi.
ok('bỏ onclick', !sanitizeLabelHtml('<span onclick="getCompanyInformation(this, 1)">x</span>').includes('onclick'));
ok('bỏ script, giữ chữ', sanitizeLabelHtml('a<script>alert(1)</script>b') === 'aalert(1)b');
eq('thẻ ngoài allowlist bỏ thẻ, giữ chữ', sanitizeLabelHtml('<a href="x">Xem</a>'), 'Xem');
eq('chữ trần vẫn được escape', sanitizeLabelHtml('a & b'), 'a &amp; b');
eq('không có thẻ thì không đụng vào', sanitizeLabelHtml('Mã khách'), 'Mã khách');

const TAX = [
  '<dir table="t">',
  '  <fields><field name="mst"><header v="Mã số th&lt;u&gt;u&lt;/u&gt;ế" e="Tax"/></field></fields>',
  '  <view id="Dir"><item value="100, 200"/><item value="11: [mst].Label, [mst]"/></view>',
  '</dir>',
].join('\r\n');
const tax = renderControllerHtml(TAX);
ok('nhãn có HTML ra thẻ thật trong form', tax.html.includes('Mã số th<u>u</u>ế'));
ok('không còn thẻ dạng escape', !tax.html.includes('&lt;u&gt;'));

section('view@height ghim chiều cao vùng main');
eq('số trần', evaluateHeight('400'), 400);
eq('biểu thức số học', evaluateHeight('380 + 20'), 400);
eq('không khai → null, không bịa mặc định', evaluateHeight(null), null);
eq('chuỗi lạ → null, không đoán', evaluateHeight('400px'), null);
// Không bao giờ chạy chuỗi lấy từ file của khách.
eq('không cho lọt lời gọi hàm', evaluateHeight('alert(1)'), null);

const H = CAT.replace('<view id="Dir">', '<view id="Dir" height="400" anchor="2" split="1">');
const h = renderControllerHtml(H);
eq('model giữ chiều cao vùng main', h.model.mainHeight, 400);
ok('panel tab mang height 400px', h.html.includes('height:400px;box-sizing:border-box;'));
// height thuộc vùng main (tab), KHÔNG thuộc dải header — gắn nhầm là header cao 400px trống hoác.
const headerDiv = h.html.slice(h.html.indexOf('data-dwf-region="header"'), h.html.indexOf('data-dwf-region="main"'));
ok('dải header không bị gắn height', !headerDiv.includes('height:400px'));

section('anchor và split — chỉ số cột, đi kèm cho blueprint đọc');
eq('anchor của view về vùng header', h.model.regions[0].anchor, 2);
eq('split của view về vùng header', h.model.regions[0].split, 1);
ok('bảng header mang data-fbo-anchor', h.html.includes('data-fbo-anchor="2"'));
ok('bảng header mang data-fbo-split', h.html.includes('data-fbo-split="1"'));
eq('tab không khai thì không có', h.model.regions[1].anchor, null);
ok('form không khai anchor/split thì HTML sạch', !renderControllerHtml(CAT).html.includes('data-fbo-anchor'));
// File thật viết thẻ dưới dạng tham chiếu ký tự XML — chưa giải mã thì không có `<` để nhận ra.
eq('giải mã &lt;u&gt; rồi mới coi là HTML', sanitizeLabelHtml('Mã số &lt;u&gt;t&lt;/u&gt;huế'), 'Mã số <u>t</u>huế');
// Giải mã hai lượt thì `&amp;lt;` (cố ý muốn hiện ra chữ) hoá thành thẻ thật.
eq('giải mã đúng MỘT lượt', sanitizeLabelHtml('&amp;lt;u&amp;gt;'), '&amp;lt;u&amp;gt;');
eq('tham chiếu số', sanitizeLabelHtml('&#65;&#x42;'), 'AB');

section('categories khai TRÙNG index — một tab, không phải hai');
/*
 * Có thật trong `Dir/SVTran.xml`: `index="8"`, `"14"`, `"15"` mỗi cái khai hai lần — controller
 * khai một lần rồi một Include kéo vào lần nữa. Runtime tra `<category>` theo index như tra từ
 * điển nên lần hai chỉ ghi đè lần một; đẩy từng khai báo thành một region là ra hai tab «Xác
 * thực» cạnh nhau, DÙNG CHUNG một `id` — và trùng id thì bấm tab này mở luôn tab kia.
 */
const DUP = [
  '<dir table="t">',
  '  <fields>',
  '    <field name="a" categoryIndex="8"><header v="A" e="A"/></field>',
  '    <field name="b" categoryIndex="9"><header v="B" e="B"/></field>',
  '  </fields>',
  '  <view id="Dir">',
  '    <item value="100, 200"/>',
  '    <item value="11: [a].Label, [a]"/>',
  '    <item value="11: [b].Label, [b]"/>',
  '    <categories>',
  '      <category index="8" columns="100, 200"><header v="Xác thực" e="Verify"/></category>',
  '      <category index="9" columns="100, 200"><header v="Ghi chú" e="Note"/></category>',
  '      <category index="8" columns="300"><header v="Xác thực" e="Verify"/></category>',
  '    </categories>',
  '  </view>',
  '</dir>',
].join('\r\n');
const dup = renderControllerHtml(DUP);
eq('mỗi index đúng một panel', (dup.html.match(/class="DwfTabPanel/g) || []).length, 2);
eq('mỗi index đúng một nút tab', (dup.html.match(/class="DwfTabButton"/g) || []).length, 2);
eq('không có id panel nào lặp lại', (dup.html.match(/id="fbo-tab-8"/g) || []).length, 1);
// Khai lần hai mang `columns="300"` khác hẳn lần đầu — nuốt im lặng là giấu mất một khác biệt.
ok('nói ra chỗ khai trùng', dup.warnings.some((w) => /category index="8".*nhiều lần/.test(w.message)));
// Lần khai ĐẦU thắng, nên list px của tab 8 vẫn là của lần đầu.
ok('lần khai đầu thắng', dup.html.includes('data-fbo-col-widths="100,200"'));

section('renderRowHtml — nguồn của phép render cục bộ');
/*
 * Gộp/tách ô chỉ đổi pattern của MỘT `<item value>`, nên chỉ một `<tr>` đổi theo. Bản vá phải
 * đi qua ĐÚNG hàm đã dựng bảng đầy đủ; hai đường sinh HTML song song thì trước sau gì cũng
 * trôi khỏi nhau, và triệu chứng là "gộp ô xong nhìn khác lúc mở lại file".
 */
const patchBase = renderControllerHtml(XML);
const rowHtml = renderRowHtml(patchBase.model, 1);
ok('trả về đúng một <tr>', rowHtml.startsWith('<tr class="FormRow" data-fbo-item="1"'));
ok('không kèm thẻ <table> nào', !rowHtml.includes('<table'));
// Cùng một hàm với bảng đầy đủ ⇒ chuỗi phải nằm nguyên vẹn trong HTML của cả form.
ok('trùng khít hàng trong bảng đầy đủ', patchBase.html.includes(rowHtml));
eq('hàng không tồn tại → null, để người gọi biết phải vẽ lại cả form',
  renderRowHtml(patchBase.model, 9999), null);
eq('lưới không vá hàng được', renderRowHtml({ mode: 'grid' }, 1), null);
