// probe-encoding.js — SPIKE P0, CÂU HỎI 1.
//
//   "VS Code có giữ được Windows-1258 + CRLF khi ta sửa file qua TextDocument không?"
//
// Câu này quyết định kiến trúc, không phải chi tiết cài đặt:
//   giữ được  → CustomTextEditorProvider, undo/redo/save/diff của VS Code dùng được luôn;
//   không     → phải tự quản file I/O bằng core/encoding.mjs và TỰ VIẾT undo stack.
//
// Nên nó phải được trả lời bằng THỰC NGHIỆM trên máy thật, không bằng đọc changelog VS Code:
// tạo file 1258 thật, mở bằng API thật, sửa, lưu, rồi đọc lại BYTE và so.
//
// Kết quả ghi vào Output channel "FBO Designer" — dán thẳng vào docs/P0-QUESTIONS.md.

const vscode = require('vscode');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MARKER = 'Số tài khoản ngân hàng — đơn vị tính: cái/chiếc';
const INSERTED = '<!-- chèn bởi probe: Mã khách hàng ưu tiên đợt Đầu -->';

async function probeEncodingRoundTrip(core, output) {
  output.clear();
  output.show(true);
  const say = (s) => output.appendLine(s);

  say('=== SPIKE P0 câu hỏi 1: VS Code có giữ được Windows-1258 + CRLF không ===');
  say(`VS Code ${vscode.version} · Node ${process.versions.node}`);
  const filesCfg = vscode.workspace.getConfiguration('files');
  say(`files.encoding = ${JSON.stringify(filesCfg.get('encoding'))} · files.autoGuessEncoding = ${filesCfg.get('autoGuessEncoding')}`);
  say('');

  const dir = path.join(os.tmpdir(), 'fbo-designer-probe');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `probe-${Date.now()}.xml`);

  const original = Buffer.concat([
    core.encodeWindows1258('<?xml version="1.0" encoding="windows-1258"?>\r\n<dir>\r\n  <title v="'),
    core.encodeWindows1258(MARKER),
    core.encodeWindows1258('" e="Bank account"/>\r\n</dir>\r\n'),
  ]);
  fs.writeFileSync(file, original);
  say(`1. Ghi file mẫu ${original.length} byte, mã hoá bằng core.encodeWindows1258:`);
  say(`   ${file}`);
  say(`   nhận diện lại: ${JSON.stringify(pick(core.decodeSource(original)))}`);
  say('');

  const uri = vscode.Uri.file(file);
  let doc;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch (err) {
    say(`2. KHÔNG mở được bằng openTextDocument: ${err.message}`);
    say('   => phải tự quản file I/O. Kết luận: KHÔNG dùng CustomTextEditorProvider.');
    return;
  }

  say(`2. Mở bằng openTextDocument:`);
  say(`   document.encoding = ${doc.encoding ?? '(API không có trong bản VS Code này)'}`);
  say(`   document.eol      = ${doc.eol === vscode.EndOfLine.CRLF ? 'CRLF' : 'LF'}`);
  const decodedOk = doc.getText().normalize('NFC').includes(MARKER.normalize('NFC'));
  say(`   đọc đúng tiếng Việt: ${decodedOk ? 'CÓ' : 'KHÔNG — VS Code decode sai ngay từ đầu'}`);
  if (!decodedOk) say(`   thấy: ${JSON.stringify(doc.getText().slice(0, 120))}`);
  say('');

  const edit = new vscode.WorkspaceEdit();
  edit.insert(uri, new vscode.Position(1, 0), `  ${INSERTED}\r\n`);
  const applied = await vscode.workspace.applyEdit(edit);
  const saved = applied ? await doc.save() : false;
  say(`3. Chèn một dòng tiếng Việt rồi lưu: applyEdit=${applied} save=${saved}`);
  say('');

  const after = fs.readFileSync(file);
  const info = core.decodeSource(after);
  say('4. Đọc lại BYTE sau khi lưu:');
  say(`   ${JSON.stringify(pick(info))}`);

  const prefixLen = original.indexOf(core.encodeWindows1258(MARKER)[0]);
  const markerBytes = core.encodeWindows1258(MARKER);
  const markerKept = after.includes(markerBytes);
  const insertedAs1258 = after.includes(core.encodeWindows1258(INSERTED));
  const insertedAsUtf8 = after.includes(Buffer.from(INSERTED, 'utf8'));

  say('');
  say('5. Phán quyết:');
  line(say, 'phần cũ giữ nguyên byte 1258', markerKept);
  line(say, 'phần MỚI chèn cũng ra byte 1258', insertedAs1258);
  line(say, 'phần mới bị ghi thành UTF-8', insertedAsUtf8, true);
  line(say, 'CRLF còn nguyên', info.newline === 'crlf');
  say('');

  const verdict = markerKept && insertedAs1258 && info.newline === 'crlf';
  if (verdict) {
    say('=> GIỮ ĐƯỢC. Đi tiếp bằng CustomTextEditorProvider: undo/redo/save/diff dùng của VS Code.');
  } else if (markerKept && insertedAsUtf8) {
    say('=> HỎNG KIỂU LAI — file thành nửa 1258 nửa UTF-8. Đây là ca TỆ NHẤT: mở lại vẫn thấy');
    say('   bình thường ở chỗ cũ, chỉ hỏng ở chỗ vừa sửa. KHÔNG được để người dùng chạm vào.');
  } else {
    say('=> KHÔNG GIỮ ĐƯỢC. Phải tự quản file I/O bằng core/encoding.mjs và tự viết undo stack.');
    say('   Quyết định này cần một ADR mới (ADR-0002 đã cố ý không chốt tầng vỏ).');
  }
  say('');
  say(`File mẫu để soi bằng hex editor: ${file}`);

  vscode.window.showInformationMessage(
    `FBO Designer P0: ${verdict ? 'Windows-1258 giữ được' : 'Windows-1258 KHÔNG giữ được'} — xem Output.`,
  );
  void prefixLen;
}

function pick(info) {
  return { encoding: info.encoding, bom: info.bom, newline: info.newline, bytes: info.bytes };
}

function line(say, label, cond, invert = false) {
  const good = invert ? !cond : cond;
  say(`   [${good ? 'OK ' : 'XX '}] ${label}: ${cond ? 'có' : 'không'}`);
}

module.exports = { probeEncodingRoundTrip };
