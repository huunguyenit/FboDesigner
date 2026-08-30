// add-column-host.js — lệnh «Sinh script thêm cột cho field mới».
//
// Vỏ mỏng quanh `core/src/add-column.mjs` + `sql-host.js`: dò field/độ dài qua database thật khi
// nối được, hỏi tay khi không — rồi sinh SQL, mở ra CHƯA ĐẶT TÊN cho người dùng đọc. KHÔNG tự
// chạy script, KHÔNG tự sửa XML. Cùng ba quyết định với `filter-host.js` (xem đầu file đó); ở
// đây không có bước vá XML nào cả, vì lệnh này chỉ ĐỌC controller, không sửa nó.
//
// HAI BẬC DÒ TỰ ĐỘNG (v2, 2026-08-28) — chỉ chạy khi nối được database, KHÔNG BAO GIỜ chặn cả
// lệnh nếu nối lỗi (không có Web.config, sai connectionString, sqlcmd không có trên máy, server
// không tới được…) — mọi lỗi ở đây đều rơi về hành vi v1: hiện hết field bảng chính, hỏi tay hết:
//
//   Bậc 1  "field vừa thêm" = field bảng chính CHƯA có cột trên bảng đích — dò `sys.columns`.
//   Bậc 2  độ dài cột chữ = cột CÙNG TÊN đã tồn tại (chắc chắn, một độ dài duy nhất) ở bảng khác —
//          dò `sys.columns`/`sys.types`. Nhiều độ dài khác nhau hoặc không có dòng nào thì vẫn
//          hỏi tay (Bậc 3), kèm liệt kê các độ dài dò được để người dùng tham khảo.
//
// `%Database` của `appConnectionString` (một `sys` phục vụ nhiều `app`) giải bằng cách đọc bảng
// `entity` trên `sys`, cột `cdata`, dòng đầu theo `code` — xem `sql-config.mjs`/`sql-host.js`.

const vscode = require('vscode');
const { t, toast } = require('./locale');
const fs = require('node:fs');

const { isControllerDocument } = require('./render-host');
const sqlHost = require('./sql-host');

const readInclude = (core) => (abs) => {
  try { return fs.existsSync(abs) ? core.readSource(abs).text : null; } catch { return null; }
};

const FILTER_PATH = /[\\/]App_Data[\\/]Controllers[\\/]Filter[\\/]/i;

function fboTypeLabel(field) {
  const t = String(field.attrs?.type ?? '').trim().toLowerCase();
  if (t === 'datetime') return 'DateTime → smalldatetime';
  if (t === 'decimal') return 'Decimal → numeric(19,4)';
  if (t === 'boolean') return 'Boolean → bit';
  return 'chữ → varchar(N)';
}

function isStringField(field) {
  const t = String(field.attrs?.type ?? '').trim().toLowerCase();
  return t === '' || t === 'string';
}

/**
 * Connection string của bảng ĐÍCH (`sysConnectionString` nếu `root@database="Sys"`, ngược lại
 * `appConnectionString` — giải `%Database` qua `sys.entity.cdata` nếu còn placeholder).
 *
 * KHÔNG BAO GIỜ throw — mọi nhánh lỗi trả `{ok:false, reason}` để chỗ gọi rơi về hỏi tay.
 */
async function resolveTargetConnection(core, programRoot, database, output) {
  const sysConn = sqlHost.readConnection(core, programRoot, 'sysConnectionString', output);
  if (String(database).trim().toLowerCase() === 'sys') {
    return sysConn ? { ok: true, conn: sysConn } : { ok: false, reason: 'không đọc được sysConnectionString từ Web.config' };
  }

  const appConn = sqlHost.readConnection(core, programRoot, 'appConnectionString', output);
  if (!appConn) return { ok: false, reason: 'không đọc được appConnectionString từ Web.config' };
  if (!appConn.database || !/%Database/i.test(appConn.database)) {
    return { ok: true, conn: appConn };
  }
  if (!sysConn) {
    return { ok: false, reason: 'appConnectionString còn %Database nhưng không đọc được sysConnectionString để giải' };
  }
  const resolved = await sqlHost.resolveAppDatabase(core, sysConn);
  if (!resolved.ok) return resolved;
  output.appendLine(
    `thêm cột: %Database → "${resolved.database}" (bảng entity trên sys, dòng đầu theo code`
    + `${resolved.all.length > 1 ? `; còn ${resolved.all.length - 1} app database khác, xem sys.entity nếu cần đổi` : ''})`,
  );
  return { ok: true, conn: { ...appConn, database: resolved.database } };
}

/**
 * @param {object} core   module `core/src/index.mjs` đã nạp
 * @param {vscode.OutputChannel} output
 */
async function addColumns(core, output) {
  const document = vscode.window.activeTextEditor?.document;
  if (!document) {
    vscode.window.showWarningMessage(toast('extension.no_file'));
    return;
  }
  if (!isControllerDocument(document) || FILTER_PATH.test(document.uri.fsPath)) {
    vscode.window.showWarningMessage(
      'FBO Designer: thêm cột chỉ áp dụng cho controller trong App_Data\\Controllers\\{Dir,Grid} — '
      + 'field của Filter không phải cột database, xem docs/IDEAS-FUTURE-TOOLS.md §3.',
    );
    return;
  }

  const source = document.getText();
  const expanded = core.expandEntities(source, {
    filePath: document.uri.fsPath,
    readFile: readInclude(core),
  });
  for (const d of expanded.diagnostics) output.appendLine(`thêm cột [${d.severity}] ${d.message}`);

  const plan = core.planAddColumns(expanded.clearText);
  if (!plan.table) {
    vscode.window.showWarningMessage('FBO Designer: không đọc được tên bảng (root@table trống).');
    return;
  }
  if (plan.mainTableFields.length === 0) {
    vscode.window.showInformationMessage(
      'FBO Designer: file này không có field nào là cột bảng chính — mọi field đều external hoặc mang aliasName khác "a".',
    );
    return;
  }

  const paths = core.resolveProgramPaths(document.uri.fsPath);
  const target = await resolveTargetConnection(core, paths?.programRoot, plan.database, output);
  if (!target.ok) output.appendLine(`thêm cột: chưa nối được database — ${target.reason}. Hiện toàn bộ field bảng chính, tự chọn tay.`);

  // Bậc 1: dò field CHƯA có cột trên bảng đích — dò không ra thì hiện HẾT field bảng chính,
  // giống hệt hành vi v1 (người dùng tự chọn).
  let candidateFields = plan.mainTableFields;
  let autoDetected = false;
  if (target.ok) {
    const dbCols = await sqlHost.existingColumns(core, target.conn, plan.table);
    if (dbCols.ok) {
      const existing = new Set(dbCols.columns.map((c) => c.toLowerCase()));
      candidateFields = plan.mainTableFields.filter((f) => !existing.has(f.name.toLowerCase()));
      autoDetected = true;
      output.appendLine(`thêm cột: dò sys.columns "${plan.table}" — ${dbCols.columns.length} cột đã có, ${candidateFields.length} field còn thiếu.`);
    } else {
      output.appendLine(`thêm cột: dò sys.columns thất bại — ${dbCols.reason}. Hiện toàn bộ field bảng chính, tự chọn tay.`);
    }
  }
  if (autoDetected && candidateFields.length === 0) {
    vscode.window.showInformationMessage(`FBO Designer: mọi field bảng chính đã có cột trên bảng "${plan.table}" — không cần sinh script.`);
    return;
  }

  const items = candidateFields.map((field) => ({
    label: field.name,
    description: field.header?.v || field.header?.e || '',
    detail: fboTypeLabel(field),
    picked: autoDetected,
    field,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: `Thêm cột — bảng "${plan.table}"${plan.rotating ? ` (chia kỳ, prime="${plan.partition.prime}")` : ''}`,
    placeHolder: autoDetected
      ? 'Field CHƯA có cột trên database (đã dò tự động) — bỏ tick field không muốn sinh script'
      : 'Chọn field CHƯA CÓ cột trên database — chưa dò tự động được, tự kiểm tra trước khi chọn',
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked || picked.length === 0) return;

  // Bậc 2 → Bậc 3: field kiểu chữ thử dò độ dài qua cột cùng tên ở bảng khác; dò ra ĐÚNG MỘT con
  // số thì dùng thẳng, không hỏi. Không ra (không có, hoặc nhiều độ dài khác nhau) thì hỏi tay.
  const stringLengths = {};
  for (const item of picked) {
    const field = item.field;
    if (!isStringField(field)) continue;

    let resolvedLength = null;
    let hint = '';
    if (target.ok) {
      const found = await sqlHost.stringColumnLength(core, target.conn, field.name);
      if (found.ok && found.length) {
        resolvedLength = found.length;
        output.appendLine(`thêm cột: "${field.name}" dò được varchar(${resolvedLength}) từ cột cùng tên ở bảng khác.`);
      } else if (found.ok && found.candidates.length > 1) {
        hint = ` (dò được nhiều độ dài khác nhau ở bảng khác: ${found.candidates.join(', ')} — tự chọn)`;
      } else if (!found.ok) {
        output.appendLine(`thêm cột: dò độ dài "${field.name}" thất bại — ${found.reason}`);
      }
    }
    if (resolvedLength) { stringLengths[field.name] = resolvedLength; continue; }

    const input = await vscode.window.showInputBox({
      title: `Độ dài cột "${field.name}" (varchar)`,
      prompt: `${field.header?.v || field.name} — field kiểu chữ${hint}. Nhập số ký tự cho varchar(N).`,
      validateInput: (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? null : 'nhập một số nguyên dương'),
    });
    if (input === undefined) {
      output.appendLine(`thêm cột: huỷ — chưa nhập độ dài cho "${field.name}"`);
      return;
    }
    stringLengths[field.name] = Number(input);
  }

  const defs = core.buildColumnDefs(picked.map((i) => i.field), { stringLengths });
  const bad = defs.filter((d) => !d.ok);
  if (bad.length > 0) {
    vscode.window.showWarningMessage(
      `FBO Designer: ${bad.length} field chưa xác định được kiểu SQL — ${bad.map((d) => `${d.name} (${d.reason})`).join('; ')}`,
    );
    return;
  }

  let sql;
  try {
    sql = core.renderAddColumnSql(defs, {
      table: plan.table,
      partition: plan.partition,
      sourceFile: document.uri.fsPath,
      template: plan.rotating ? core.DEFAULT_PARTITION_TEMPLATE : undefined,
    });
  } catch (err) {
    vscode.window.showErrorMessage(`FBO Designer: ${err.message}`);
    return;
  }

  const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: sql });
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });

  const kind = plan.rotating ? `bảng chia kỳ (prime="${plan.partition.prime}")` : 'bảng thường';
  output.appendLine(
    `thêm cột ${plan.table}: ${defs.length} cột, ${kind}, database ${plan.database}`
    + `${autoDetected ? ' — đã dò sys.columns tự động' : ' — CHƯA dò được, tự kiểm tra lại trước khi chạy'}.`,
  );
  vscode.window.showInformationMessage(
    `Thêm cột: sinh ${defs.length} cột cho "${plan.table}". Đọc kỹ rồi tự chạy trên database ${plan.database} của khách — designer không tự chạy.`,
  );
}

module.exports = { addColumns };
