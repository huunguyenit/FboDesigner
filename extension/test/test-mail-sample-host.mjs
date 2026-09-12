// test-mail-sample-host.mjs — luồng «Lấy từ chứng từ» của Email Designer.
//
// Core đã kiểm câu SQL (`test-mail-sample.mjs`). Ở đây kiểm TẦNG VỎ: hỏi xác nhận trước khi ghi
// dmxn, nối DB trước khi dựng SELECT (để có @@sysDatabaseName), chạy đúng thứ tự
// stub → probe → master/detail, và gom thành JSON mẫu.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ok, eq, section } from '../../core/test/harness.mjs';
import * as fakeVscode from './fake-vscode.mjs';

const require_ = createRequire(import.meta.url);
const Module = require_('node:module');

function classify(sql) {
  if (sql.includes('insert into dmxn')) return 'stub';
  if (sql.includes('from dmct9')) return 'probe';
  if (sql.includes('ReadCurrency')) return 'in_words';
  if (sql.includes('t_tien') && sql.includes('lang')) return 'footer';
  if (sql.includes('so_luong') || (sql.includes('ma_vt') && sql.includes('stt_rec'))) return 'detail';
  if (sql.includes('userinfo2') || sql.includes('ten_kh') || sql.includes('d_language')) return 'master';
  return 'other';
}

const sqlHost = {
  ran: [],
  conn: { server: 'S', database: 'fboapp' },
  sysConn: { server: 'S', database: 'fbosys' },
  probeRow: ['VND', 'm91$202609', 'd91$202609'],
  masterRows: [['so_ct', 'ten_kh', 'd_language', 'ma_nt', 't_tt_nt'], ['------', '------', '----------', '-----', '-------'], ['PN0001', 'Nguyễn', 'V', 'VND', '5000000']],
  detailRows: [
    ['ma_vt', 'so_luong', 'gia', 'tien'],
    ['-----', '--------', '---', '----'],
    ['VT01', '25.0000', '200000.0000', '5000000.0000'],
    ['field', 'format'],
    ['-----', '------'],
    ['so_luong', '# ### ### ##0.00'],
    ['gia', '### ### ### ##0'],
    ['tien', '### ### ### ### ##0'],
  ],
  footerRows: [
    ['t_tien'],
    ['------'],
    ['100'],
    ['field', 'format'],
    ['-----', '------'],
    ['t_tien', '### ### ### ### ##0'],
  ],
  inWordsRows: [['in_words'], ['--------'], ['Năm triệu đồng']],
  failLabel: null,
  mapNamedRows: null,
  splitResultsets: null,
  reset() {
    sqlHost.ran = [];
    sqlHost.failLabel = null;
    sqlHost.probeRow = ['VND', 'm91$202609', 'd91$202609'];
    sqlHost.masterRows = [['so_ct', 'ten_kh', 'd_language', 'ma_nt', 't_tt_nt'], ['------', '------', '----------', '-----', '-------'], ['PN0001', 'Nguyễn', 'V', 'VND', '5000000']];
    sqlHost.detailRows = [
      ['ma_vt', 'so_luong', 'gia', 'tien'],
      ['-----', '--------', '---', '----'],
      ['VT01', '25.0000', '200000.0000', '5000000.0000'],
      ['field', 'format'],
      ['-----', '------'],
      ['so_luong', '# ### ### ##0.00'],
      ['gia', '### ### ### ##0'],
      ['tien', '### ### ### ### ##0'],
    ];
    sqlHost.footerRows = [
      ['t_tien'], ['------'], ['100'],
      ['field', 'format'], ['-----', '------'], ['t_tien', '### ### ### ### ##0'],
    ];
    sqlHost.inWordsRows = [['in_words'], ['--------'], ['Năm triệu đồng']];
  },
  async resolveTargetConnection() { return { ok: true, conn: sqlHost.conn }; },
  readConnection(_c, _r, name) { return name === 'sysConnectionString' ? sqlHost.sysConn : sqlHost.conn; },
  async runSqlcmd(_conn, sql, opts) {
    const label = classify(sql);
    sqlHost.ran.push({ label, sql, opts });
    if (sqlHost.failLabel === label) return { ok: false, reason: `fake ${label} fail` };
    if (label === 'stub') return { ok: true, rows: [] };
    if (label === 'probe') {
      const data = sqlHost.probeRow
        ? [['ma_nt', 'mtable', 'dtable'], ['-----', '------', '------'], sqlHost.probeRow]
        : [['ma_nt', 'mtable', 'dtable'], ['-----', '------', '------']];
      return { ok: true, rows: [['~fbo-sample~'], ...data] };
    }
    if (label === 'detail') return { ok: true, rows: [['~fbo-sample~'], ...sqlHost.detailRows] };
    if (label === 'footer') return { ok: true, rows: [['~fbo-sample~'], ...sqlHost.footerRows] };
    if (label === 'master') return { ok: true, rows: [['~fbo-sample~'], ...sqlHost.masterRows] };
    if (label === 'in_words') return { ok: true, rows: [['~fbo-sample~'], ...sqlHost.inWordsRows] };
    return { ok: true, rows: [['~fbo-sample~']] };
  },
  async runSampleQueryNamed(conn, sql, wanted, opts) {
    const raw = await sqlHost.runSqlcmd(conn, sql, { ...opts, headers: true });
    if (!raw.ok) return raw;
    return { ok: true, ...sqlHost.mapNamedRows(raw.rows, wanted, opts.sentinel) };
  },
};

const fakeDialog = {
  shown: [],
  answer: 'run',
  reset() { fakeDialog.shown = []; fakeDialog.answer = 'run'; },
  async ask(options) { fakeDialog.shown.push(options); return fakeDialog.answer; },
};

const previousLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === 'vscode') return fakeVscode;
  if (request === './sql-host') return sqlHost;
  if (request === './dialog/dialog-service') return { dialogs: () => fakeDialog };
  return previousLoad.call(this, request, ...rest);
};

const realSql = require_('../src/sql-host.js');
sqlHost.mapNamedRows = realSql.mapNamedRows;
sqlHost.splitResultsets = realSql.splitResultsets;

const { loadMailSample, rowsOfFirstTable, tablesAfterSentinel } = require_('../src/mail-sample-host.js');
const core = await import('../../core/src/index.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fbo-mail-sample-'));
const MESSAGE_XML = path.join(tmp, 'App_Data', 'Controllers', 'Options', 'Message.xml');
fs.mkdirSync(path.dirname(MESSAGE_XML), { recursive: true });
const CLEAR = `
<message xmlns="urn:schemas-fast-com:data-message">
  <mail><template>
    <action id="PurchaseRequisition" table="m91$000000">
      <query id="report">
        <command id="master"><text><![CDATA[select so_ct, ten_kh, d_language from @@sysDatabaseName..userinfo2 a, @@table b, dmxn c where a.id = @@contactID and b.stt_rec = @@stt_rec and b.stt_rec = c.stt_rec]]></text></command>
        <command id="detail"><text><![CDATA[select ma_vt, so_luong from @@table where stt_rec = @@stt_rec and @@language = @@language]]></text></command>
        <command id="footer"><text><![CDATA[select t_tien from @@table where stt_rec = @@stt_rec and lang = @@language]]></text></command>
      </query>
      <body><header><text><![CDATA[<html><body>{!so_ct}</body></html>]]></text></header></body>
    </action>
  </template></mail>
</message>`;
fs.writeFileSync(MESSAGE_XML, CLEAR, 'utf8');
const doc = fakeVscode.textDocument(fakeVscode.Uri.file(MESSAGE_XML), CLEAR);
const output = { lines: [], appendLine(l) { this.lines.push(l); } };

function reset() {
  fakeVscode.window.reset();
  sqlHost.reset();
  fakeDialog.reset();
  output.lines = [];
}

section('mail-sample-host: rowsOfFirstTable — bảng đầu sau sentinel');
{
  eq('một bảng', rowsOfFirstTable([
    ['~fbo-sample~'],
    ['a', 'b'],
    ['-', '-'],
    ['1', '2'],
  ], '~fbo-sample~'), [{ a: '1', b: '2' }]);
  eq('bỏ bảng format thứ hai', rowsOfFirstTable([
    ['~fbo-sample~'],
    ['ma_vt'],
    ['-----'],
    ['VT01'],
    ['field', 'format'],
    ['-----', '------'],
    ['x', 'N'],
  ], '~fbo-sample~'), [{ ma_vt: 'VT01' }]);
}

section('mail-sample-host: huỷ ở hộp thoại → không chạy SQL');
{
  reset();
  fakeDialog.answer = null;
  const r = await loadMailSample(core, output, doc, {
    actionId: 'PurchaseRequisition', stt_rec: 'A000000716DXA', contactID: '7', clearText: CLEAR,
  });
  ok('cancelled', r.ok === false && r.cancelled === true);
  eq('không một câu SQL nào', sqlHost.ran.length, 0);
  ok('có mở hộp thoại xác nhận dmxn', fakeDialog.shown.length === 1
    && fakeDialog.shown[0].body.some((b) => String(b.content || '').includes('dmxn')));
}

section('mail-sample-host: đồng ý → stub → probe → master → footer → detail, @@language từ d_language');
{
  reset();
  const r = await loadMailSample(core, output, doc, {
    actionId: 'PurchaseRequisition', stt_rec: 'A000000716DXA', contactID: '7', clearText: CLEAR,
  });
  ok('ok', r.ok === true);
  eq('thứ tự chạy', sqlHost.ran.map((x) => x.label), ['stub', 'probe', 'master', 'footer', 'detail']);
  ok('stub ghi dmxn đúng stt_rec', sqlHost.ran[0].sql.includes("stt_rec = 'A000000716DXA'"));
  ok('master mang @@sysDatabaseName đã thay', sqlHost.ran[2].sql.includes('fbosys..userinfo2')
    && !sqlHost.ran[2].sql.includes('@@sysDatabaseName'));
  ok('footer/detail mang @@language từ d_language master', sqlHost.ran[3].sql.includes("'V'")
    && sqlHost.ran[4].sql.includes("'V'")
    && !sqlHost.ran[3].sql.includes('@@language')
    && !sqlHost.ran[4].sql.includes('@@language'));
  eq('JSON mẫu đã format từ bảng cuối', r.data, {
    so_ct: 'PN0001',
    ten_kh: 'Nguyễn',
    d_language: 'V',
    ma_nt: 'VND',
    t_tt_nt: '5000000',
    t_tien: '100',
    detail: [{
      ma_vt: 'VT01', so_luong: '25.00', gia: '200 000', tien: '5 000 000',
    }],
  });
}

section('mail-sample-host: tablesAfterSentinel — data + bảng format cuối');
{
  const parsed = tablesAfterSentinel([
    ['~fbo-sample~'],
    ['ma_vt', 'so_luong'],
    ['-----', '--------'],
    ['VT01', '25.0000'],
    ['field', 'format'],
    ['-----', '------'],
    ['so_luong', '# ### ### ##0.00'],
  ], '~fbo-sample~', core);
  eq('data', parsed.dataRows, [{ ma_vt: 'VT01', so_luong: '25.0000' }]);
  eq('format', parsed.formatRows, [{ field: 'so_luong', format: '# ### ### ##0.00' }]);
}

section('mail-sample-host: SQL lỗi → dialog error overlay');
{
  reset();
  sqlHost.failLabel = 'detail';
  const r = await loadMailSample(core, output, doc, {
    actionId: 'PurchaseRequisition', stt_rec: 'A000000716DXA', contactID: '7', clearText: CLEAR,
  });
  ok('fail', r.ok === false);
  ok('có dialog error', fakeDialog.shown.some((d) => d.type === 'error'));
}

section('mail-sample-host: {!in_words} → ReadCurrency');
{
  reset();
  const withWords = CLEAR.replace('{!so_ct}', '{!so_ct} {!in_words}');
  const r = await loadMailSample(core, output, doc, {
    actionId: 'PurchaseRequisition', stt_rec: 'A000000716DXA', contactID: '7', clearText: withWords,
  });
  ok('ok', r.ok === true);
  ok('chạy in_words sau detail', sqlHost.ran.map((x) => x.label).includes('in_words'));
  ok('ReadCurrency nhận ma_nt + t_tt_nt', sqlHost.ran.find((x) => x.label === 'in_words').sql
    .includes("ReadCurrency('VND', 5000000, 'V')"));
  eq('in_words trong JSON', r.data.in_words, 'Năm triệu đồng');
}

section('mail-sample-host: probe rỗng → dừng, không chạy SELECT');
{
  reset();
  sqlHost.probeRow = null;
  const r = await loadMailSample(core, output, doc, {
    actionId: 'PurchaseRequisition', stt_rec: 'BAD', contactID: '1', clearText: CLEAR,
  });
  ok('fail', r.ok === false);
  eq('chỉ stub + probe', sqlHost.ran.map((x) => x.label), ['stub', 'probe']);
  ok('lý do nhắc dò bảng', /dò/i.test(r.reason));
  ok('dialog error khi probe rỗng', fakeDialog.shown.some((d) => d.type === 'error'));
}
