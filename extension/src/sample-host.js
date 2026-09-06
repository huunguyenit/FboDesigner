// sample-host.js — lệnh «Xem dữ liệu thật trên lưới».
//
// Đây là lệnh DUY NHẤT của extension ĐỌC DỮ LIỆU NGHIỆP VỤ của khách. Mọi lệnh khác chỉ đọc
// lược đồ (`sys.columns`, `sys.types`) hoặc sinh script cho người khác chạy. Nên nó có mấy luật
// riêng, và đừng gỡ chúng đi cho gọn:
//
//   1. KHÔNG BAO GIỜ TỰ CHẠY. Người dùng phải bấm lệnh. Không có nhánh nào gọi nó khi mở file,
//      khi gõ phím, hay khi vẽ lại — dữ liệu thật của khách không phải thứ tự dưng chảy về máy
//      lập trình viên.
//   2. CHE MẶC ĐỊNH BẬT (`fboDesigner.maskSampleData`). Thứ làm một cột bị cắt là ĐỘ DÀI, không
//      phải nội dung; che vẫn đo được cột, mà ảnh chụp gửi đi không kèm tên khách hàng thật.
//   3. CHỈ ĐỌC, CÓ TRẦN, CÓ HẠN GIỜ. `SELECT TOP n` do core dựng (trần 100),
//      `READ UNCOMMITTED` để không khoá ai đang làm việc thật, `sqlcmd` hạn 10 giây.
//   4. KHÔNG GIỮ LẠI. Dữ liệu nằm trong bộ nhớ của phiên VS Code (`sample-store.js`), không ghi
//      đĩa, không sống qua một lần đóng cửa sổ.
//
// Câu lệnh do `core/src/grid-sample.mjs` dựng, và luật của nó — không một mẩu SQL nào của file
// khách đi thẳng vào câu lệnh — là phần khó nhất của cả tính năng. Đọc đầu file đó trước khi
// sửa bất cứ thứ gì ở đây.

const vscode = require('vscode');
const fs = require('node:fs');

const { isControllerDocument } = require('./render-host');
const sqlHost = require('./sql-host');
const store = require('./sample-store');
const { t, toast } = require('./locale');

const readInclude = (core) => (abs) => {
  try { return fs.existsSync(abs) ? core.readSource(abs).text : null; } catch { return null; }
};

function settings() {
  const c = vscode.workspace.getConfiguration('fboDesigner');
  const rows = Number(c.get('sampleRowCount'));
  return {
    // Mặc định BẬT. Ai cần đo tới từng pixel thì tắt trong một lát — xem `maskSampleValue`.
    mask: c.get('maskSampleData') !== false,
    rows: Number.isFinite(rows) && rows > 0 ? rows : undefined,
    sqlcmdPath: c.get('sqlcmdPath') || null,
  };
}

/** Liệt kê lý do từng cột bị bỏ ra Output — chỗ duy nhất nói đủ, hộp thoại chỉ đếm. */
function reportSkipped(output, plan) {
  for (const s of plan.skipped ?? []) output.appendLine(`  bỏ cột — ${s.message}`);
  for (const n of plan.notes ?? []) output.appendLine(`  ghi chú — ${n}`);
}

async function previewData(core, output) {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || !isControllerDocument(document)) {
    vscode.window.showWarningMessage(toast('extension.sample_only_grid'));
    return;
  }

  const file = document.uri.fsPath;

  // Đang hiện dữ liệu rồi thì lệnh này TẮT nó đi. Một phím tắt bật/tắt dễ nhớ hơn hai lệnh, và
  // «tắt đi» là việc người ta muốn làm ngay sau khi đo xong cột.
  if (store.getSample(file)) {
    store.clearSample(file);
    vscode.window.showInformationMessage(toast('extension.sample_cleared'));
    return;
  }

  const expanded = core.expandEntities(document.getText(), {
    filePath: file,
    readFile: readInclude(core),
  });

  const root = core.scanRoot(expanded.clearText);
  if (root.mode !== 'grid') {
    vscode.window.showWarningMessage(toast('extension.sample_only_grid'));
    return;
  }

  const opts = settings();
  const plan = core.buildSampleSelect(expanded.clearText, { top: opts.rows });
  if (!plan.ok) {
    output.appendLine(`xem dữ liệu: không dựng được câu lệnh — ${plan.reason}`);
    reportSkipped(output, plan);
    vscode.window.showWarningMessage(toast('extension.sample_cannot_build', { reason: plan.reason }));
    return;
  }

  output.appendLine(`xem dữ liệu: ${plan.columns.length} cột, TOP ${plan.top}, bảng "${plan.table}"`);
  reportSkipped(output, plan);

  const paths = core.resolveProgramPaths(file);
  const database = String(root.attrs?.database ?? '').trim() || 'app';
  const target = await sqlHost.resolveTargetConnection(core, paths?.programRoot, database, output, 'xem dữ liệu');
  if (!target.ok) {
    output.appendLine(`xem dữ liệu: không nối được database — ${target.reason}`);
    vscode.window.showWarningMessage(toast('extension.sample_no_connection', { reason: target.reason }));
    return;
  }

  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: t('extension.sample_running') },
    () => sqlHost.runSampleQuery(
      target.conn,
      plan.sql,
      plan.columns.map((c) => c.label),
      { sqlcmdPath: opts.sqlcmdPath },
    ),
  );

  if (!result.ok) {
    // KHÔNG in `plan.sql` ra thông báo cho người dùng: nó mang tên bảng và tên cột của khách,
    // và thông báo thì hay bị chụp lại gửi đi. Output Channel là chỗ đủ riêng để chẩn đoán.
    output.appendLine(`xem dữ liệu: truy vấn lỗi — ${result.reason}`);
    output.appendLine(plan.sql);
    vscode.window.showErrorMessage(toast('extension.sample_query_failed', { reason: result.reason }));
    return;
  }

  if (result.rows.length === 0) {
    vscode.window.showInformationMessage(toast('extension.sample_no_rows', { table: plan.table }));
    return;
  }

  const rows = opts.mask ? core.maskSampleRows(result.rows) : result.rows;
  store.setSample(file, {
    rows,
    columns: plan.columns,
    skipped: plan.skipped,
    notes: plan.notes,
    masked: opts.mask,
    table: plan.table,
    top: plan.top,
  });

  output.appendLine(`xem dữ liệu: ${result.rows.length} dòng${opts.mask ? ' (đã che)' : ' (KHÔNG che)'}`);
  vscode.window.showInformationMessage(toast(
    opts.mask ? 'extension.sample_done_masked' : 'extension.sample_done_plain',
    {
      rows: result.rows.length,
      // Chỉ nhắc cột bị bỏ khi THẬT SỰ có cột bị bỏ — một mệnh đề «0 cột không lấy được» dính
      // vào mọi thông báo là tiếng ồn, và tiếng ồn thì dạy người ta thôi đọc thông báo.
      skippedNote: plan.skipped.length === 0
        ? ''
        : t('extension.sample_skipped_note', { skipped: plan.skipped.length }),
    },
  ));
}

module.exports = { previewData };
