// test-mail-sample.mjs — dựng SQL cho phép «Dữ liệu mẫu» (mail-sample.mjs): câu dò bảng, câu ghi
// dòng đánh dấu tạm, và ba câu master/detail/footer đã thay biến.

import { section, eq, ok } from './harness.mjs';
import {
  buildMailSampleStub, buildMailTableProbe, buildMailSampleSelect, mailSampleFromRows,
  isMailFormatTable, mailFormatMap, applyMailFieldFormats, buildMailInWordsSelect,
} from '../src/mail-sample.mjs';

const CLEAR_TEXT = `
<message xmlns="urn:schemas-fast-com:data-message">
  <mail>
    <template>
      <action id="PurchaseRequisition" table="m91$000000">
        <query id="checking">
          <command id="check"><text><![CDATA[select 1]]></text></command>
        </query>
        <query id="report">
          <command id="master">
            <text><![CDATA[select bodyID = 'body', d_language, so_ct from @@sysDatabaseName..userinfo2 a, @@table b, dmxn c where a.id = @@contactID and b.stt_rec = @@stt_rec and b.stt_rec = c.stt_rec]]></text>
          </command>
          <command id="detail">
            <text><![CDATA[select ma_vt, so_luong from @@table where stt_rec = @@stt_rec]]></text>
          </command>
        </query>
        <body>
          <header><text><![CDATA[<html><body>{!so_ct}</body></html>]]></text></header>
        </body>
      </action>
      <action id="NoReportQuery" table="m92$000000">
        <body>
          <header><text><![CDATA[<html><body>{!so_ct}</body></html>]]></text></header>
        </body>
      </action>
    </template>
  </mail>
</message>
`;

section('mail-sample: buildMailSampleStub — ghi dòng đánh dấu tạm vào dmxn');
{
  const r = buildMailSampleStub({ stt_rec: "A000000716DXA", contactID: 7 });
  ok('xoá dòng cũ trước', r.sql.includes("delete dmxn where stt_rec = 'A000000716DXA' and user_id = 7;"));
  ok('chèn dòng giả đúng giá trị gốc người dùng mô tả', r.sql.includes("insert into dmxn select 'A000000716DXA', 'ZZZZZZ', 'YYYYYY', 7, getdate();"));
}

section('mail-sample: buildMailSampleStub — stt_rec có dấu nháy không làm gãy câu lệnh');
{
  const r = buildMailSampleStub({ stt_rec: "A'; drop table dmxn --", contactID: '9' });
  ok('nháy đơn nhân đôi, không kết thúc chuỗi sớm', r.sql.includes("'A''; drop table dmxn --'"));
}

section('mail-sample: buildMailSampleStub — contactID không phải số thì ép về 0');
{
  const r = buildMailSampleStub({ stt_rec: 'X', contactID: "7 or 1=1" });
  ok('ép về 0, không lọt biểu thức lạ vào câu lệnh', r.sql.includes('= 0;') && !r.sql.includes('1=1'));
}

section('mail-sample: buildMailTableProbe — chỉ đọc, tham số hoá qua sp_executesql, không nối chuỗi trực tiếp');
{
  const r = buildMailTableProbe({ stt_rec: "A000000716DXA" });
  ok('có mốc sentinel', r.sql.includes('~fbo-sample~'));
  ok('khai @srec đúng giá trị', r.sql.includes("declare @srec varchar(32) = 'A000000716DXA';"));
  ok('dò ma_ct bằng 3 ký tự cuối stt_rec, qua biến @srec chứ không hằng số', r.sql.includes('rtrim(ma_ct) = right(@srec, 3)'));
  ok('đọc dmct9', r.sql.includes('from dmct9'));
  ok('câu động cho stt_rec dùng tham số buộc @p, không nối chuỗi giá trị', r.sql.includes("N'@p varchar(32)'"));
  ok('không còn literal stt_rec nào nối trực tiếp ngoài @srec', !r.sql.slice(r.sql.indexOf('begin')).includes('A000000716DXA'));
  ok('đọc rồi dọn bảng tạm', r.sql.includes('create table #t') && r.sql.includes('drop table #t;'));
}

section('mail-sample: buildMailTableProbe — stt_rec có dấu nháy vẫn ra một khai báo hợp lệ');
{
  const r = buildMailTableProbe({ stt_rec: "A'B" });
  ok('nháy đơn nhân đôi trong @srec', r.sql.includes("declare @srec varchar(32) = 'A''B';"));
}

section('mail-sample: buildMailSampleSelect — thay đúng @@table cho master (masterTable) và detail (detailTable)');
{
  const r = buildMailSampleSelect(CLEAR_TEXT, {
    actionId: 'PurchaseRequisition',
    stt_rec: 'A000000716DXA',
    contactID: 7,
    masterTable: 'm91$202609',
    detailTable: 'd91$202609',
    params: { '@@sysDatabaseName': 'sys' },
  });
  ok('ok', r.ok === true);
  ok('master ghép RAW tên bảng master, không nháy (dùng trong FROM)', r.commands.master.sql.includes('m91$202609 b') && !r.commands.master.sql.includes("'m91$202609'"));
  ok('master thay @@contactID bằng số trần', r.commands.master.sql.includes('a.id = 7'));
  ok('master thay @@stt_rec bằng chuỗi có nháy', r.commands.master.sql.includes("b.stt_rec = 'A000000716DXA'"));
  ok('detail ghép RAW tên bảng detail, KHÁC bảng master', r.commands.detail.sql.includes('from d91$202609'));
  eq('footer vắng trong file → null, không lỗi', r.commands.footer, null);
  eq('table trả kèm theo mỗi command, đúng cái đã dùng', r.commands.master.table, 'm91$202609');
  eq('table của detail đúng cái đã dùng', r.commands.detail.table, 'd91$202609');
}

section('mail-sample: buildMailSampleSelect — biến @@… lạ chưa biết thì trả lỗi rõ, không âm thầm giữ nguyên token');
{
  const r = buildMailSampleSelect(CLEAR_TEXT, {
    actionId: 'PurchaseRequisition', stt_rec: 'X', contactID: 1, masterTable: 'm', detailTable: 'd',
    // thiếu params['@@sysDatabaseName'] — master có tham chiếu @@sysDatabaseName..userinfo2
  });
  eq('ok:false', r.ok, false);
  ok('lý do nêu đúng tên biến lạ', r.reason.includes('@@sysDatabaseName'));
}

section('mail-sample: buildMailSampleSelect — action không có <query id="report"> thì trả lỗi rõ, không ném');
{
  const r = buildMailSampleSelect(CLEAR_TEXT, {
    actionId: 'NoReportQuery', stt_rec: 'X', contactID: 1, masterTable: 'm', detailTable: 'd',
  });
  eq('ok:false', r.ok, false);
  ok('lý do nhắc rõ thiếu <query id="report">', r.reason.includes('report'));
}

section('mail-sample: buildMailSampleSelect — masterTable/detailTable không phải định danh hợp lệ thì ném lỗi, không âm thầm ghép');
{
  let threw = false;
  try {
    buildMailSampleSelect(CLEAR_TEXT, {
      actionId: 'PurchaseRequisition', stt_rec: 'X', contactID: 1, masterTable: "m; drop table dmxn --", detailTable: 'd',
    });
  } catch {
    threw = true;
  }
  ok('assertIdent chặn tên bảng dò được nhưng không phải định danh an toàn', threw);
}

section('mail-sample: buildMailSampleSelect — only master trước, rồi footer/detail với @@language');
{
  const master = buildMailSampleSelect(CLEAR_TEXT, {
    actionId: 'PurchaseRequisition', stt_rec: 'X', contactID: 1,
    masterTable: 'm', detailTable: 'd',
    params: { '@@sysDatabaseName': 'sys' },
    only: ['master'],
  });
  ok('only master ok dù detail cần @@language', master.ok === true && master.commands.master);
  eq('detail chưa dựng', master.commands.detail, null);

  const needLang = buildMailSampleSelect(CLEAR_TEXT.replace(
    'select ma_vt, so_luong from @@table where stt_rec = @@stt_rec',
    'select ma_vt from @@table where stt_rec = @@stt_rec and lang = @@language',
  ), {
    actionId: 'PurchaseRequisition', stt_rec: 'X', contactID: 1,
    masterTable: 'm', detailTable: 'd',
    params: { '@@sysDatabaseName': 'sys' },
    only: ['detail'],
  });
  ok('detail thiếu @@language → lỗi', needLang.ok === false && needLang.reason.includes('@@language'));

  const withLang = buildMailSampleSelect(CLEAR_TEXT.replace(
    'select ma_vt, so_luong from @@table where stt_rec = @@stt_rec',
    'select ma_vt from @@table where stt_rec = @@stt_rec and lang = @@language',
  ), {
    actionId: 'PurchaseRequisition', stt_rec: 'X', contactID: 1,
    masterTable: 'm', detailTable: 'd',
    params: { '@@sysDatabaseName': 'sys', '@@language': "'V'" },
    only: ['detail'],
  });
  ok('detail có @@language → ok', withLang.ok === true && withLang.commands.detail.sql.includes("lang = 'V'"));
}

section('mail-sample: mailSampleFromRows — gom master/detail/footer thành JSON mẫu');
{
  eq('master + detail', mailSampleFromRows({
    master: { so_ct: 'PN1', bodyID: 'body' },
    detail: [{ ma_vt: 'VT01', so_luong: 2 }, { ma_vt: 'VT02', so_luong: 1 }],
    footer: { t_tien: 100 },
  }), {
    so_ct: 'PN1', bodyID: 'body', t_tien: 100,
    detail: [{ ma_vt: 'VT01', so_luong: 2 }, { ma_vt: 'VT02', so_luong: 1 }],
  });
  eq('không có detail → object phẳng', mailSampleFromRows({ master: { so_ct: 'A' } }), { so_ct: 'A' });
  ok('bỏ cột tên không hợp lệ', !Object.hasOwn(mailSampleFromRows({
    master: { 'bad name': 1, so_ct: 'X' },
  }), 'bad name'));
  eq('null → chuỗi rỗng', mailSampleFromRows({ master: { so_ct: null } }), { so_ct: '' });
  eq('footer đè master cùng tên', mailSampleFromRows({
    master: { x: 1 }, footer: { x: 2 },
  }), { x: 2 });
}

section('mail-sample: bảng format + applyMailFieldFormats');
{
  ok('nhận bảng field/format', isMailFormatTable([{ field: 'so_luong', format: '# ### ### ##0.00' }]));
  ok('từ chối bảng thường', !isMailFormatTable([{ ma_vt: 'A', so_luong: '1' }]));
  const map = mailFormatMap([
    { field: 'so_luong', format: '# ### ### ##0.00' },
    { field: 'gia', format: '### ### ### ##0' },
    { field: 'tien', format: '### ### ### ### ##0' },
  ]);
  eq('áp mặt nạ số', applyMailFieldFormats([{
    ma_vt: 'A.TR01', so_luong: '25.0000', gia: '200000.0000', tien: '5000000.0000',
  }], map), [{
    ma_vt: 'A.TR01', so_luong: '25.00', gia: '200 000', tien: '5 000 000',
  }]);
  eq('cột không có trong map giữ nguyên', applyMailFieldFormats([{
    so_luong: '1', sl_xuat: '2.0000',
  }], map), [{ so_luong: '1.00', sl_xuat: '2.0000' }]);
}

section('mail-sample: buildMailInWordsSelect — ReadCurrency');
{
  const r = buildMailInWordsSelect({ ma_nt: 'VND', t_tt_nt: '5 000 000', language: 'V' });
  ok('có ReadCurrency', r.sql.includes('dbo.FastBusiness$Function$System$ReadCurrency'));
  ok('số trần bỏ khoảng trắng', r.sql.includes("ReadCurrency('VND', 5000000, 'V')"));
  ok('có sentinel', r.sql.includes('~fbo-sample~'));
}
