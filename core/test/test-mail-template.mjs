// test-mail-template.mjs — quét action/body và dựng HTML tham khảo cho Options/Message.xml.
//
// Điểm khó nhất cố tình đưa vào fixture: CDATA của header/footer chứa nguyên văn thẻ HTML
// `<body>`/`</body>` — trùng tên với chính thẻ schema `<body>` đang tìm biên. Che sai vùng CDATA
// thì `findElement('body', …)` sẽ dừng lại ở `</body>` NẰM TRONG CDATA thay vì thẻ đóng thật.

import { section, eq, ok } from './harness.mjs';
import { expandEntities, sourceRange } from '../src/entities.mjs';
import {
  scanMailActions, renderMailPreview, isMailTemplateDoc, locateMailSection,
  analyzeMailColumns, planResizeMailColumn, listMailRows, planAddMailRow, planAddMailColumn,
  readMailReportCommands,
} from '../src/mail-template.mjs';

/** Áp các splice {start,end,text} vào `text` — CHỈ dùng trong test để kiểm kết quả một kế hoạch
 * sửa, không phải cách tầng vỏ thật áp (đó là `vscode.WorkspaceEdit`, xem `mail-preview-host.js`).
 * Áp từ CUỐI văn bản lùi về đầu để offset của splice ĐỨNG TRƯỚC không bị lệch bởi splice vừa áp. */
function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

const SOURCE = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE message [
  <!ENTITY CssClass "&lt;head&gt;&lt;style&gt;.ts{color:#444}&lt;/style&gt;&lt;/head&gt;">
]>
<message xmlns="urn:schemas-fast-com:data-message">
  <mail>
    <template>
      <action id="PurchaseRequisition" table="m91$000000" v="Phiếu nhu cầu vật tư chờ duyệt" e="Purchase requisition waiting for approval">
        <fields>
          <field name="h_so_ct">
            <header v="Số phiếu" e="Number"/>
          </field>
          <field name="h_vat_tu">
            <header v="Mã hàng" e="Item"/>
          </field>
        </fields>
        <query id="checking">
          <command id="check"><text><![CDATA[select 1]]></text></command>
        </query>
        <query id="report">
          <command id="master">
            <text><![CDATA[select bodyID = 'body', d_language, so_ct from @@table b where b.stt_rec = @@stt_rec and @@contactID = @@contactID]]></text>
          </command>
          <command id="detail">
            <text><![CDATA[select ma_vt from @@table where stt_rec = @@stt_rec]]></text>
          </command>
        </query>
        <body>
          <header>
            <text>
              <![CDATA[
<html>]]>&CssClass;<![CDATA[
<body>
<table><tr><td>{!h_so_ct}</td><td>{!so_ct}</td></tr>
<tr><td>{!h_vat_tu}</td></tr>
]]>
            </text>
          </header>
          <detail>
            <text>
              <![CDATA[
<tr><td>{!ma_vt}</td></tr>
]]>
            </text>
          </detail>
          <footer>
            <text>
              <![CDATA[
</table>
</body></html>
]]>
            </text>
          </footer>
        </body>
        <body2>
          <header>
            <text><![CDATA[<html><body>body2 variant {!h_so_ct}</body></html>]]></text>
          </header>
        </body2>
      </action>
    </template>
  </mail>
  <sms>
    <template>
      <action id="PurchaseRequisition" prefix="L" expire="5" table="">
        <fields>
          <field name="h_so_ct">
            <header v="Khong phai nhan mail" e="Not the mail header"/>
          </field>
        </fields>
        <content>
          <text><![CDATA[{!h_so_ct} {!so_ct}]]></text>
        </content>
      </action>
    </template>
  </sms>
</message>
`;

function build() {
  return expandEntities(SOURCE, { filePath: 'Message.xml', readFile: () => null });
}

section('mail-template: scanMailActions');
{
  const { clearText, diagnostics } = build();
  eq('không lỗi entity', diagnostics.length, 0);
  const actions = scanMailActions(clearText);
  eq('một action mail — action cùng id bên <sms> không lẫn vào', actions.length, 1);
  eq('id', actions[0].id, 'PurchaseRequisition');
  eq('v', actions[0].v, 'Phiếu nhu cầu vật tư chờ duyệt');
  eq('bodies theo đúng thứ tự', actions[0].bodies, ['body', 'body2']);
}

section('mail-template: renderMailPreview — body chính, tiếng Việt');
{
  const { clearText } = build();
  const r = renderMailPreview(clearText, { actionId: 'PurchaseRequisition', body: 'body', vi: true });
  ok('ok', r.ok === true);
  ok('CssClass bung thành thẻ <head> thật, không phải chữ &lt;head&gt;', r.html.includes('<head><style>'));
  ok('thẻ <body> của CHÍNH bức mail còn nguyên (không lẫn với schema)', r.html.includes('<body>\n<table>'));
  ok('field có khai header → thay bằng nhãn việt (của MAIL, không phải nhãn trùng tên bên <sms>)', r.html.includes('<td>Số phiếu</td>'));
  ok('không lẫn nhãn của action cùng id bên <sms>', !r.html.includes('Khong phai nhan mail'));
  ok('field có khai header thứ hai cũng thay', r.html.includes('<td>Mã hàng</td>'));
  ok('token KHÔNG khai trong <fields> giữ nguyên (dữ liệu thật lúc gửi)', r.html.includes('{!so_ct}'));
  ok('detail (dữ liệu) giữ nguyên token', r.html.includes('{!ma_vt}'));
  ok('footer nối đúng sau detail', r.html.includes('</table>\n</body></html>'));
}

section('mail-template: renderMailPreview — tiếng Anh');
{
  const { clearText } = build();
  const r = renderMailPreview(clearText, { actionId: 'PurchaseRequisition', body: 'body', vi: false });
  ok('nhãn theo header@e', r.html.includes('<td>Number</td>') && r.html.includes('<td>Item</td>'));
}

section('mail-template: renderMailPreview — body2');
{
  const { clearText } = build();
  const r = renderMailPreview(clearText, { actionId: 'PurchaseRequisition', body: 'body2', vi: true });
  ok('ok', r.ok === true);
  ok('đúng nội dung body2, không lẫn body', r.html.includes('body2 variant Số phiếu'));
}

section('mail-template: lỗi có lý do rõ');
{
  const { clearText } = build();
  const noAction = renderMailPreview(clearText, { actionId: 'KhongTonTai', body: 'body', vi: true });
  ok('action không tồn tại', noAction.ok === false && /KhongTonTai/.test(noAction.reason));
  const noBody = renderMailPreview(clearText, { actionId: 'PurchaseRequisition', body: 'body9', vi: true });
  ok('body không tồn tại', noBody.ok === false && /body9/.test(noBody.reason));
}

section('mail-template: isMailTemplateDoc');
{
  ok('nhận diện đúng file mail template', isMailTemplateDoc(SOURCE));
  ok('từ chối file khác', !isMailTemplateDoc('<dir><views/></dir>'));
}

section('mail-template: locateMailSection — cùng file, ba phần header/detail/footer');
{
  const { clearText } = build();

  const header = locateMailSection(clearText, { actionId: 'PurchaseRequisition', body: 'body', section: 'header' });
  ok('tìm được header', header !== null);
  const headerText = clearText.slice(header.start, header.end);
  ok('trọn thẻ, có mở lẫn đóng', headerText.startsWith('<header>') && headerText.endsWith('</header>'));
  ok('đúng NỘI DUNG header (chưa thay token — đây là quét trên clearText, không phải render)', headerText.includes('{!h_so_ct}'));
  ok('không lẫn sang detail', !headerText.includes('{!ma_vt}'));

  const detail = locateMailSection(clearText, { actionId: 'PurchaseRequisition', body: 'body', section: 'detail' });
  ok('tìm được detail, đúng nội dung, không lẫn header/footer', detail !== null
    && clearText.slice(detail.start, detail.end).includes('{!ma_vt}')
    && !clearText.slice(detail.start, detail.end).includes('{!h_so_ct}'));

  const footer = locateMailSection(clearText, { actionId: 'PurchaseRequisition', body: 'body', section: 'footer' });
  ok('tìm được footer, đúng nội dung', footer !== null
    && clearText.slice(footer.start, footer.end).includes('</body></html>'));

  // body2 chỉ khai <header> — không có <detail>/<footer>, locate phải báo null chứ không đoán bừa
  // sang phần tử của BODY KHÁC hay của ACTION KHÁC đứng sau trong file.
  const missingDetail = locateMailSection(clearText, { actionId: 'PurchaseRequisition', body: 'body2', section: 'detail' });
  eq('body2 không có detail → null, không tràn sang body khác', missingDetail, null);
}

section('mail-template: locateMailSection — action/body/section không tồn tại thì null, không ném lỗi');
{
  const { clearText } = build();
  eq('action lạ', locateMailSection(clearText, { actionId: 'KhongTonTai', body: 'body', section: 'header' }), null);
  eq('body lạ', locateMailSection(clearText, { actionId: 'PurchaseRequisition', body: 'body9', section: 'header' }), null);
  eq('section lạ (không phải header/detail/footer)', locateMailSection(clearText, { actionId: 'PurchaseRequisition', body: 'body', section: 'fields' }), null);
}

section('mail-template: locateMailSection — không lẫn với action id trùng tên bên <sms>');
{
  const { clearText } = build();
  // <sms> có action id="PurchaseRequisition" nhưng KHÔNG có <body>/<header> — nếu locate lỡ
  // không khoanh vùng <mail><template> thì sẽ báo null nhầm (tìm "header" bên trong action đó
  // rồi bó tay) thay vì tìm đúng bên <mail>.
  const header = locateMailSection(clearText, { actionId: 'PurchaseRequisition', body: 'body', section: 'header' });
  ok('vẫn tìm đúng bên <mail>', header !== null && clearText.slice(header.start, header.end).includes('{!h_so_ct}'));
}

section('mail-template: locateMailSection — quy về ĐÚNG FILE nguồn khi phần đó đến từ Include');
{
  // Mô phỏng đúng ca thật của corpus: một &Entity; (khai SYSTEM) tiêm nguyên khối <header> vào
  // action — «đi tới định nghĩa» phải mở Include.ent, không phải đứng lại ở Message.xml tại
  // đúng vị trí `&IncludedHeader;` (đó là nơi entity được THAM CHIẾU, không phải nơi nó được
  // KHAI).
  const SOURCE_WITH_INCLUDE = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE message [
  <!ENTITY IncludedHeader SYSTEM "Include.ent">
]>
<message xmlns="urn:schemas-fast-com:data-message">
  <mail>
    <template>
      <action id="A1" table="t1" v="Mau 1" e="Sample 1">
        <fields/>
        <body>
          &IncludedHeader;
          <detail><text><![CDATA[<tr><td>{!x}</td></tr>]]></text></detail>
          <footer><text><![CDATA[</table></body></html>]]></text></footer>
        </body>
      </action>
    </template>
  </mail>
</message>
`;
  const includeFiles = {
    'Include.ent': '<header><text><![CDATA[<html><body>from include {!h_so_ct}</body></html>]]></text></header>',
  };
  const readFile = (abs) => includeFiles[abs] ?? null;
  const { clearText, segments, diagnostics } = expandEntities(SOURCE_WITH_INCLUDE, { filePath: 'Message.xml', readFile });
  eq('bung include không lỗi', diagnostics.length, 0);

  const header = locateMailSection(clearText, { actionId: 'A1', body: 'body', section: 'header' });
  ok('tìm được header (đến từ include)', header !== null);

  const src = sourceRange(segments, header.start, header.end);
  ok('quy về file Include.ent, KHÔNG phải Message.xml', src !== null && src.file === 'Include.ent');
}

// ── kéo giãn cột / thêm dòng / thêm cột — fixture có đủ: bảng thông tin (không phải cột), bảng
// lưới 3 cột (cột 0/1 khai width:Npx, cột 2 KHÔNG khai gì — mô phỏng ca dùng class CSS dùng
// chung), và footer có colspan để kiểm việc tự tăng theo khi thêm cột.
const TABLE_SOURCE = `<?xml version="1.0" encoding="utf-8"?>
<message xmlns="urn:schemas-fast-com:data-message">
  <mail>
    <template>
      <action id="PQApproval" table="m92$000000" v="Đề nghị báo giá" e="Price quote">
        <fields>
          <field name="h_so_ct"><header v="Số phiếu" e="Number"/></field>
          <field name="h_ma_vt"><header v="Mã hàng" e="Item"/></field>
          <field name="h_ten_vt"><header v="Tên hàng" e="Name"/></field>
          <field name="h_ghi_chu"><header v="Ghi chú" e="Note"/></field>
        </fields>
        <body>
          <header>
            <text><![CDATA[
<html><body>
<table><tr><td>{!h_so_ct}</td><td>{!so_ct}</td></tr></table>
<table><tr><td style="width:100px;">{!h_ma_vt}</td><td style="width:200px;">{!h_ten_vt}</td><td>{!h_ghi_chu}</td></tr>
]]></text>
          </header>
          <detail>
            <text><![CDATA[
<tr><td>{!ma_vt}</td><td>{!ten_vt}</td><td>{!ghi_chu}</td></tr>
]]></text>
          </detail>
          <footer>
            <text><![CDATA[
<tr><td colspan="3">{!h_t_tien}</td></tr>
</table></body></html>
]]></text>
          </footer>
        </body>
      </action>
    </template>
  </mail>
</message>
`;

function buildTable() {
  return expandEntities(TABLE_SOURCE, { filePath: 'Message.xml', readFile: () => null });
}

section('mail-template: analyzeMailColumns — nhận đúng 3 cột, phân biệt cột có/không width');
{
  const { clearText } = buildTable();
  const a = analyzeMailColumns(clearText, { actionId: 'PQApproval', body: 'body' });
  ok('ok', a.ok === true);
  eq('đúng 3 cột (không lẫn hàng "Số phiếu" của bảng KHÁC)', a.columns.length, 3);
  eq('cột 1 rộng 100', a.columns[0].width, 100);
  eq('cột 2 rộng 200', a.columns[1].width, 200);
  eq('cột 3 không khai width trực tiếp → null', a.columns[2].width, null);
  ok('cột 1 có widthSpan trỏ đúng dải chữ số "100"', clearText.slice(a.columns[0].widthSpan.start, a.columns[0].widthSpan.end) === '100');
  ok('cột 3 không có widthSpan', a.columns[2].widthSpan === null);
}

section('mail-template: analyzeMailColumns — <detail> nhiều hơn/ít hơn một dòng thì báo lỗi rõ');
{
  const bad = expandEntities(TABLE_SOURCE.replace(
    '<tr><td>{!ma_vt}</td><td>{!ten_vt}</td><td>{!ghi_chu}</td></tr>',
    '<tr><td>{!ma_vt}</td></tr><tr><td>{!ten_vt}</td></tr>',
  ), { filePath: 'Message.xml', readFile: () => null });
  const a = analyzeMailColumns(bad.clearText, { actionId: 'PQApproval', body: 'body' });
  ok('không tự đoán khi detail có 2 dòng', a.ok === false && /một dòng mẫu/.test(a.reason));
}

section('mail-template: planResizeMailColumn — chỉ sửa đúng dải chữ số, không đụng gì khác');
{
  const { clearText } = buildTable();
  const plan = planResizeMailColumn(clearText, {
    actionId: 'PQApproval', body: 'body', columnIndex: 0, width: 150,
  });
  ok('ok', plan.ok === true);
  eq('đúng một splice', plan.edits.length, 1);
  const applied = applyEdits(clearText, plan.edits);
  ok('cột 1 đổi thành 150px', applied.includes('style="width:150px;">{!h_ma_vt}'));
  ok('cột 2 giữ nguyên 200px', applied.includes('style="width:200px;">{!h_ten_vt}'));
  ok('mọi thứ khác giữ nguyên ngoài đúng 3 ký tự đã đổi', applied.length === clearText.length);
}

section('mail-template: planResizeMailColumn — từ chối cột dùng class dùng chung (không width riêng)');
{
  const { clearText } = buildTable();
  const plan = planResizeMailColumn(clearText, {
    actionId: 'PQApproval', body: 'body', columnIndex: 2, width: 80,
  });
  ok('từ chối, không đoán bừa', plan.ok === false && /không tự đổi an toàn/.test(plan.reason));
}

section('mail-template: planResizeMailColumn — từ chối bề rộng vô lý');
{
  const { clearText } = buildTable();
  ok('số 0', planResizeMailColumn(clearText, { actionId: 'PQApproval', body: 'body', columnIndex: 0, width: 0 }).ok === false);
  ok('số thập phân', planResizeMailColumn(clearText, { actionId: 'PQApproval', body: 'body', columnIndex: 0, width: 1.5 }).ok === false);
  ok('quá lớn', planResizeMailColumn(clearText, { actionId: 'PQApproval', body: 'body', columnIndex: 0, width: 99999 }).ok === false);
}

section('mail-template: listMailRows — liệt kê dòng header + footer, KHÔNG có detail');
{
  const { clearText } = buildTable();
  const rows = listMailRows(clearText, { actionId: 'PQApproval', body: 'body' });
  eq('2 dòng header (bảng thông tin + dòng tiêu đề) + 1 dòng footer', rows.length, 3);
  eq('hai dòng đầu thuộc header', rows.filter((r) => r.section === 'header').length, 2);
  eq('một dòng thuộc footer', rows.filter((r) => r.section === 'footer').length, 1);
  ok('preview đọc được nội dung dòng', rows[0].preview.includes('{!h_so_ct}'));
  ok('không có dòng nào lấy từ <detail>', !rows.some((r) => r.preview.includes('{!ma_vt}')));
}

section('mail-template: planAddMailRow — nhân bản đúng dòng đã chọn, chèn ngay sau');
{
  const { clearText } = buildTable();
  // Dòng tiêu đề cột (rowIndex=1 trong header — rowIndex=0 là dòng "Số phiếu" của bảng khác).
  const plan = planAddMailRow(clearText, {
    actionId: 'PQApproval', body: 'body', section: 'header', rowIndex: 1,
  });
  ok('ok', plan.ok === true);
  const applied = applyEdits(clearText, plan.edits);
  const count = (applied.match(/\{!h_ma_vt\}/g) || []).length;
  eq('dòng tiêu đề cột xuất hiện hai lần sau khi thêm', count, 2);
  ok('bản sao đứng NGAY SAU bản gốc (liền nhau, không xen dòng khác)', applied.includes('{!h_ghi_chu}</td></tr><tr><td style="width:100px;">{!h_ma_vt}'));
}

section('mail-template: planAddMailRow — dòng không tồn tại thì báo lỗi');
{
  const { clearText } = buildTable();
  const plan = planAddMailRow(clearText, { actionId: 'PQApproval', body: 'body', section: 'header', rowIndex: 99 });
  ok('lỗi rõ', plan.ok === false && /dòng số 100/.test(plan.reason));
}

section('mail-template: planAddMailColumn — nhân bản ở CẢ header lẫn detail, tự tăng colspan ở footer');
{
  const { clearText } = buildTable();
  const plan = planAddMailColumn(clearText, { actionId: 'PQApproval', body: 'body', columnIndex: 0 });
  ok('ok', plan.ok === true);
  eq('ba splice: header + detail + colspan', plan.edits.length, 3);
  eq('không có ghi chú thiếu sót — colspan tìm thấy và đã tăng', plan.notes.length, 0);

  const applied = applyEdits(clearText, plan.edits);
  eq('cột 1 (width:100px, {!h_ma_vt}) xuất hiện hai lần ở header', (applied.match(/width:100px;">\{!h_ma_vt\}/g) || []).length, 2);
  eq('cột 1 ({!ma_vt}) xuất hiện hai lần ở detail', (applied.match(/<td>\{!ma_vt\}<\/td>/g) || []).length, 2);
  ok('colspan tăng từ 3 lên 4', applied.includes('colspan="4"'));
}

section('mail-template: planAddMailColumn — không có colspan trong footer thì báo trong notes, không âm thầm bỏ qua');
{
  const noColspan = expandEntities(
    TABLE_SOURCE.replace('<tr><td colspan="3">{!h_t_tien}</td></tr>', '<tr><td>{!h_t_tien}</td></tr>'),
    { filePath: 'Message.xml', readFile: () => null },
  );
  const plan = planAddMailColumn(noColspan.clearText, { actionId: 'PQApproval', body: 'body', columnIndex: 0 });
  ok('vẫn thêm được cột', plan.ok === true);
  eq('hai splice (không có splice colspan)', plan.edits.length, 2);
  eq('có đúng một ghi chú', plan.notes.length, 1);
  ok('ghi chú nói rõ vì sao', /colspan/.test(plan.notes[0]));
}

section('mail-template: planAddMailColumn — cột không tồn tại thì báo lỗi');
{
  const { clearText } = buildTable();
  const plan = planAddMailColumn(clearText, { actionId: 'PQApproval', body: 'body', columnIndex: 9 });
  ok('lỗi rõ', plan.ok === false && /cột số 10/.test(plan.reason));
}

section('mail-template: renderMailPreview — blueprint:true gắn data-fbo-col vào ĐÚNG hàng tiêu đề cột');
{
  const { clearText } = buildTable();
  const r = renderMailPreview(clearText, {
    actionId: 'PQApproval', body: 'body', vi: true, blueprint: true,
  });
  ok('ok', r.ok === true);
  ok('cột 1 (100px) có marker 0', r.html.includes('width:100px;" data-fbo-col="0">Mã hàng'));
  ok('cột 2 (200px) có marker 1', r.html.includes('width:200px;" data-fbo-col="1">Tên hàng'));
  ok('cột 3 (không width) vẫn có marker 2', r.html.includes('data-fbo-col="2">Ghi chú'));
  const markerCount = (r.html.match(/data-fbo-col="/g) || []).length;
  eq('đúng 3 marker — không lẫn vào hàng "Số phiếu" (2 ô, số không khớp) lẫn <detail> (không đánh dấu)', markerCount, 3);
  ok('detail vẫn giữ nguyên token, không bị marker chen vào', r.html.includes('<td>{!ma_vt}</td>'));
}

section('mail-template: renderMailPreview — mặc định (blueprint bỏ trống) KHÔNG có marker nào');
{
  const { clearText } = buildTable();
  const r = renderMailPreview(clearText, { actionId: 'PQApproval', body: 'body', vi: true });
  ok('không có data-fbo-col trong bản tham khảo thường', !r.html.includes('data-fbo-col'));
}

section('mail-template: renderMailPreview — blueprint:true trên mẫu không suy được cấu trúc cột thì bỏ qua, không lỗi');
{
  const bad = expandEntities(TABLE_SOURCE.replace(
    '<tr><td>{!ma_vt}</td><td>{!ten_vt}</td><td>{!ghi_chu}</td></tr>',
    '<tr><td>{!ma_vt}</td></tr><tr><td>{!ten_vt}</td></tr>',
  ), { filePath: 'Message.xml', readFile: () => null });
  const r = renderMailPreview(bad.clearText, {
    actionId: 'PQApproval', body: 'body', vi: true, blueprint: true,
  });
  ok('vẫn render được, chỉ là không có marker', r.ok === true && !r.html.includes('data-fbo-col'));
}

section('mail-template: readMailReportCommands — đọc master/detail, footer vắng thì null, không lẫn <query id="checking">');
{
  const { clearText } = build();
  const r = readMailReportCommands(clearText, 'PurchaseRequisition');
  ok('ok', r.ok === true);
  ok('master đọc đúng SQL, không lẫn command "check" của <query id="checking">', r.commands.master.includes("bodyID = 'body'") && !r.commands.master.includes('select 1'));
  ok('detail đọc đúng SQL', r.commands.detail.includes('select ma_vt from @@table'));
  eq('footer vắng → null, không ném lỗi', r.commands.footer, null);
}

section('mail-template: readMailReportCommands — action không tồn tại');
{
  const { clearText } = build();
  const r = readMailReportCommands(clearText, 'KhongCoActionNay');
  eq('ok:false', r.ok, false);
  ok('lý do nhắc rõ tên action', r.reason.includes('KhongCoActionNay'));
}

section('mail-template: readMailReportCommands — action không có <query id="report">');
{
  const { clearText } = buildTable();
  const r = readMailReportCommands(clearText, 'PQApproval');
  eq('ok:false', r.ok, false);
  ok('lý do nhắc rõ thiếu <query id="report">', r.reason.includes('report'));
}
