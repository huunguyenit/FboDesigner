// filter-host.js — lệnh «Khai báo lọc nhanh cho lưới này».
//
// Vỏ mỏng quanh `core/src/filter-declare.mjs`: hỏi người dùng chọn cột, áp splice XML bằng
// WorkspaceEdit, rồi mở script SQL ra cho họ đọc. Mọi luật về FBO nằm ở core; file này chỉ biết
// về VS Code.
//
// BA QUYẾT ĐỊNH CÓ CHỦ Ý:
//
//   1. Script SQL mở ra dưới dạng document CHƯA ĐẶT TÊN, không ghi thẳng xuống đĩa. Nó chạy
//      trên database sys của khách; quyết định cất nó ở đâu — và có chạy hay không — là của
//      người dùng, không phải của designer. Untitled cũng tránh việc rải file sinh tự động vào
//      trong cây `App_Data\Controllers` của chương trình khách.
//
//   2. Vá XML và sinh SQL là HAI bước rời nhau, làm theo thứ tự đó. Vá XML mà không có dòng
//      trong `sysfilterdeclares` thì màn hình có ô lọc nhưng gõ vào không ra gì; có dòng mà
//      không vá XML thì không có ô nào để gõ. Người dùng thấy cả hai bước nên biết mình còn nợ
//      bước nào.
//
//   3. Mọi splice vào MỘT `WorkspaceEdit`. Ctrl+Z phải hoàn tác cả cụm: một file có
//      `allowFilter` mà thiếu `%Control.Filter;` là file KHÔNG PHÂN GIẢI ĐƯỢC, tức màn hình
//      trắng — tệ hơn hẳn file chưa sửa gì.

const vscode = require('vscode');
const { t, toast } = require('./locale');
const fs = require('node:fs');
const path = require('node:path');

const { isControllerDocument } = require('./render-host');
const { encodingBlocks, productFileBlocks } = require('./edit-host');
const { dialogs } = require('./dialog/dialog-service');

const readInclude = (core) => (abs) => {
  try { return fs.existsSync(abs) ? core.readSource(abs).text : null; } catch { return null; }
};

/**
 * Tên database `sys`, đọc thẳng từ `Web.config` của program — không hỏi tay.
 *
 * `Web.config` nằm ở GỐC program (`resolveProgramPaths(...).programRoot`), cùng cấp với
 * `App_Data`, không phải cạnh file controller. Ba biến thể hoa/thường của tên file, giống
 * `WebConfigReader.FindWebConfig` của DevWorkFlow — IIS trên Windows không phân biệt, nhưng đĩa
 * chứa source lại có thể phân biệt tuỳ hệ thống file.
 *
 * Không thấy file, đọc lỗi, hay `Web.config` không khai `sysConnectionString` đều trả `null` —
 * người dùng tự gõ tên database vào script, không phải lỗi phải chặn cả lệnh lại.
 */
function readSysDatabaseName(core, programRoot, output) {
  if (!programRoot) return null;
  const candidate = ['Web.config', 'web.config', 'WEB.CONFIG']
    .map((f) => path.join(programRoot, f))
    .find((p) => fs.existsSync(p));
  if (!candidate) return null;
  try {
    const text = core.readSource(candidate).text;
    const db = core.scanSysDatabaseName(text);
    if (!db) output.appendLine(`lọc nhanh: ${candidate} không khai connectionString "sysConnectionString"`);
    return db;
  } catch (err) {
    output.appendLine(`lọc nhanh: không đọc được ${candidate} — ${err.message}`);
    return null;
  }
}

function rangeOf(document, start, end) {
  return new vscode.Range(document.positionAt(start), document.positionAt(end));
}

const CONF_LABEL = {
  joined: '$(check) nguồn đọc được từ câu Finding',
  base: '$(warning) nằm trên alias gốc — kiểm lại bảng nguồn',
  expression: '$(warning) aliasName là biểu thức — bảng nguồn phải điền tay',
  'temp-table': '$(error) bảng tạm cục bộ — lọc theo cột này sẽ lỗi lúc chạy, không khai được',
  unknown: '$(error) chưa biết nguồn — phải điền tay',
};

/**
 * @param {object} core   module `core/src/index.mjs` đã nạp
 * @param {vscode.OutputChannel} output
 */
async function declareFilter(core, output) {
  const document = vscode.window.activeTextEditor?.document;
  if (!document) {
    vscode.window.showWarningMessage(toast('extension.no_file'));
    return;
  }
  if (!isControllerDocument(document)) {
    vscode.window.showWarningMessage(
      'FBO Designer: lọc nhanh chỉ khai được cho controller trong App_Data\\Controllers\\Grid.',
    );
    return;
  }

  const source = document.getText();
  const expanded = core.expandEntities(source, {
    filePath: document.uri.fsPath,
    readFile: readInclude(core),
  });
  for (const d of expanded.diagnostics) output.appendLine(`entity [${d.severity}] ${d.message}`);

  const root = core.scanRoot(expanded.clearText);
  if (root.mode !== 'grid') {
    vscode.window.showWarningMessage(
      `FBO Designer: lọc nhanh chỉ hỗ trợ trên file <grid>; file này là <${root.tag ?? '?'}>.`,
    );
    return;
  }

  // Field đọc từ bản ĐÃ BUNG (nhãn, aliasName, type có thể đến từ Include); splice thì tính
  // trên VĂN BẢN GỐC. Trộn hai hệ toạ độ là ghi vào sai chỗ — luật chung của cả tầng ghi ngược.
  const fields = core.scanFields(expanded.clearText);
  if (fields.length === 0) {
    vscode.window.showWarningMessage(toast('extension.no_fields'));
    return;
  }

  const stem = path.basename(document.uri.fsPath).replace(/\.(f|xml)$/i, '');
  const draft = core.buildFilterDeclarations(expanded.clearText, {
    fields,
    columns: fields.map((f) => f.name),
    stem,
  });
  const byField = new Map(draft.rows.map((r) => [r.field, r]));

  const already = new Set(
    fields.filter((f) => String(f.attrs?.allowFilter ?? '').toLowerCase() === 'true').map((f) => f.name),
  );

  const items = fields.map((f) => {
    const row = byField.get(f.name);
    return {
      label: f.name,
      // Cột đã có `allowFilter="true"` từ trước KHÔNG được tick sẵn: người dùng phải tự chọn lại
      // từng cột muốn khai, kể cả cột cũ. Tick sẵn theo trạng thái file cũ dễ làm người dùng bấm
      // "OK" mà không nhìn kỹ, nạp lại nguyên xi những dòng đã có — kể cả dòng cần sửa.
      description: [f.header?.v || f.header?.e || '', already.has(f.name) ? '(đã khai allowFilter)' : '']
        .filter(Boolean).join(' — '),
      detail: CONF_LABEL[row?.confidence] ?? CONF_LABEL.unknown,
      picked: false,
      name: f.name,
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: `Lọc nhanh — ${draft.controller || stem}`,
    placeHolder: draft.finding.ok
      ? 'Chọn cột cho phép lọc nhanh'
      : `Chọn cột — ${draft.finding.reason}`,
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked || picked.length === 0) return;
  const columns = picked.map((p) => p.name);

  // ── Bước 1: vá XML ───────────────────────────────────────────────────────
  const plan = core.planEnableFilter(source, columns, { fields });
  if (!plan.ok) {
    vscode.window.showWarningMessage(toast('extension.patch_fail', { reason: plan.reason }));
    return;
  }
  if (plan.splices.length > 0 && !(await patchXml(document, plan, output))) return;

  // ── Bước 2: sinh script SQL ──────────────────────────────────────────────
  const built = core.buildFilterDeclarations(expanded.clearText, { fields, columns, stem });
  const paths = core.resolveProgramPaths(document.uri.fsPath);
  const sysDatabase = readSysDatabaseName(core, paths?.programRoot, output);
  const sql = core.renderFilterDeclareSql(built.rows, {
    sysDatabase,
    sourceFile: document.uri.fsPath,
    controller: built.controller,
    // Cảnh báo chung của cả lượt sinh — «không đọc được câu Finding», «chưa biết bảng inquiry
    // có cột gì» kèm câu SQL để tra. Không chuyển tiếp thì chúng chết ở đây, và người chạy
    // script chỉ thấy bảng đối chiếu từng dòng.
    notes: built.notes,
  });

  const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: sql });
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });

  const shaky = built.rows.filter((r) => r.confidence !== 'joined').length;
  output.appendLine(
    `lọc nhanh ${built.controller}: ${built.rows.length} dòng, ${shaky} dòng cần xem lại`
    + `${plan.splices.length ? `, vá ${plan.splices.length} chỗ trong XML` : ', XML đã đủ khai báo'}`
    + `, database ${sysDatabase ? `"${sysDatabase}" (đọc từ Web.config)` : 'chưa xác định — gõ tay vào script'}`,
  );
  vscode.window.showInformationMessage(
    shaky === 0
      ? `Lọc nhanh: ${built.rows.length} dòng, nguồn đọc được hết từ file. Đọc script rồi chạy trên database sys.`
      : `Lọc nhanh: ${built.rows.length} dòng, ${shaky} dòng CHƯA biết bảng nguồn — điền tay trước khi chạy.`,
  );
}

/** Áp cả cụm splice vào MỘT WorkspaceEdit rồi lưu. @returns {Promise<boolean>} */
async function patchXml(document, plan, output) {
  const product = productFileBlocks(document.uri.fsPath);
  if (product) {
    vscode.window.showWarningMessage(t('extension.prefix') + product);
    return false;
  }
  const blocked = encodingBlocks(document);
  if (blocked) {
    vscode.window.showWarningMessage(t('extension.prefix') + blocked);
    return false;
  }

  const go = await dialogs().ask({
    type: 'warning',
    title: `Sửa ${path.basename(document.uri.fsPath)}?`,
    subtitle: 'Lọc nhanh — vá XML',
    size: 'medium',
    body: [
      { type: 'list', items: [
        ...plan.notes,
        `khai allowFilter + <query> cho ${plan.splices.length} chỗ`,
      ] },
    ],
    buttons: [
      { id: 'cancel', label: t('dialog.btn.cancel'), variant: 'secondary', action: 'cancel' },
      { id: 'go', label: t('dialog.btn.edit'), variant: 'primary', action: 'confirm' },
    ],
  });
  if (go !== 'go') return false;

  const edit = new vscode.WorkspaceEdit();
  for (const s of plan.splices) {
    edit.replace(document.uri, rangeOf(document, s.start, s.end), s.text);
  }
  if (!(await vscode.workspace.applyEdit(edit))) {
    vscode.window.showWarningMessage(toast('extension.vscode_reject'));
    return false;
  }
  for (const s of plan.splices) {
    output.appendLine(`lọc nhanh: sửa [${s.start},${s.end}) → ${JSON.stringify(s.text)}`);
  }
  for (const s of plan.skipped) output.appendLine(`lọc nhanh: bỏ qua ${s}`);

  // Lưu luôn — cùng lý do với `applySplice`: chưa lưu thì file trên đĩa còn là bản cũ và
  // preview đang vẽ từ document, hai bên nói hai chuyện khác nhau.
  await document.save();
  return true;
}

module.exports = { declareFilter };
